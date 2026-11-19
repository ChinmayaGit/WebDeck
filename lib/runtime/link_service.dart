import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'notification_service.dart';

class LinkPeer {
  final String id;
  String name;
  String platform;
  String addr;
  int port;
  final String? secret; // set once paired
  DateTime? lastSeen;

  LinkPeer({required this.id, required this.name, required this.platform, required this.addr, required this.port, this.secret, this.lastSeen});

  bool get paired => secret != null;
  bool get online => lastSeen != null && DateTime.now().difference(lastSeen!) < const Duration(seconds: 20);

  Map<String, dynamic> toJson({bool includeSecret = false}) => {
        'id': id,
        'name': name,
        'platform': platform,
        'addr': addr,
        'port': port,
        'paired': paired,
        'online': online,
        if (includeSecret && secret != null) 'secret': secret,
        'lastSeen': lastSeen?.toIso8601String(),
      };

  factory LinkPeer.fromJson(Map<String, dynamic> j) => LinkPeer(
        id: j['id'] as String,
        name: j['name'] as String? ?? 'Device',
        platform: j['platform'] as String? ?? '',
        addr: j['addr'] as String? ?? '',
        port: (j['port'] as num?)?.toInt() ?? LinkService.defaultPort,
        secret: j['secret'] as String?,
      );
}

class LinkMessage {
  final String id;
  final String peerId;
  final String peerName;
  final String channel;
  final bool outgoing;
  final Map<String, dynamic> payload;
  final DateTime at;

  LinkMessage({required this.id, required this.peerId, required this.peerName, required this.channel, required this.outgoing, required this.payload, required this.at});

  Map<String, dynamic> toJson() => {
        'id': id,
        'peerId': peerId,
        'peerName': peerName,
        'channel': channel,
        'outgoing': outgoing,
        'payload': payload,
        'at': at.toIso8601String(),
      };

  factory LinkMessage.fromJson(Map<String, dynamic> j) => LinkMessage(
        id: j['id'] as String,
        peerId: j['peerId'] as String,
        peerName: j['peerName'] as String? ?? '',
        channel: j['channel'] as String,
        outgoing: j['outgoing'] as bool? ?? false,
        payload: (j['payload'] as Map).cast<String, dynamic>(),
        at: DateTime.tryParse(j['at'] as String? ?? '') ?? DateTime.now(),
      );
}

class LinkException implements Exception {
  final String message;
  const LinkException(this.message);
  @override
  String toString() => message;
}

/// Device Link: WebDeck-to-WebDeck connectivity on the local network.
///
/// * Discovery: UDP broadcast announcements on [discoveryPort].
/// * Pairing: a 6-digit code shown on one device and typed on the other; the
///   two devices then share a random secret.
/// * Everything after pairing (messages, clipboard, files) is HMAC-signed with
///   that secret and rejected otherwise. Off by default.
class LinkService extends ChangeNotifier {
  static const defaultPort = 47610;
  static const discoveryPort = 47611;
  static const _maxInbox = 1000;
  static const _maxClipboard = 100 * 1024;

  final Future<Directory> Function() _baseDir;
  final NotificationService _notifications;
  final http.Client _http;

  LinkService(this._baseDir, this._notifications, {http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final _random = Random.secure();
  String deviceId = '';
  String deviceName = '';
  bool enabled = false;
  bool clipboardSync = true;
  int port = defaultPort;
  final Map<String, LinkPeer> _peers = {}; // paired + discovered
  final List<LinkMessage> _inbox = [];
  final List<Map<String, dynamic>> clipboardHistory = [];

  HttpServer? _server;
  RawDatagramSocket? _udp;
  Timer? _announceTimer;
  Timer? _clipTimer;
  String? _pairCode;
  DateTime? _pairCodeExpires;
  int _pairAttempts = 0;
  String? _lastClipboard;
  String? lastError;

  /// Hook to read/write the system clipboard (overridable in tests).
  Future<String?> Function() readClipboard = () async => (await Clipboard.getData(Clipboard.kTextPlain))?.text;
  Future<void> Function(String) writeClipboard = (t) => Clipboard.setData(ClipboardData(text: t));

  bool get running => _server != null;
  List<LinkPeer> get peers => _peers.values.toList()..sort((a, b) => (b.paired ? 1 : 0) - (a.paired ? 1 : 0));
  List<LinkPeer> get pairedPeers => _peers.values.where((p) => p.paired).toList();
  String get platform => Platform.operatingSystem;

  // ------------------------------------------------------------ persistence

  Future<File> _stateFile() async => File(p.join((await _baseDir()).path, 'link.json'));
  Future<File> _inboxFile() async => File(p.join((await _baseDir()).path, 'link_inbox.json'));

  Future<void> load() async {
    try {
      final f = await _stateFile();
      if (await f.exists()) {
        final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
        deviceId = j['deviceId'] as String? ?? '';
        deviceName = j['deviceName'] as String? ?? '';
        enabled = j['enabled'] as bool? ?? false;
        clipboardSync = j['clipboardSync'] as bool? ?? true;
        for (final pj in (j['peers'] as List? ?? const [])) {
          final peer = LinkPeer.fromJson((pj as Map).cast<String, dynamic>());
          _peers[peer.id] = peer;
        }
      }
      final ib = await _inboxFile();
      if (await ib.exists()) {
        _inbox.addAll((jsonDecode(await ib.readAsString()) as List).map((e) => LinkMessage.fromJson((e as Map).cast<String, dynamic>())));
      }
    } catch (_) {}
    if (deviceId.isEmpty) deviceId = _token(12);
    if (deviceName.isEmpty) deviceName = _defaultName();
    await _save();
    if (enabled) await start();
  }

  String _defaultName() {
    var host = '';
    try {
      host = Platform.localHostname.replaceAll(RegExp(r'\.local$'), '');
    } catch (_) {}
    final kind = Platform.isAndroid ? 'Android' : Platform.isIOS ? 'iPhone' : Platform.isMacOS ? 'Mac' : Platform.isWindows ? 'PC' : 'Computer';
    return host.isEmpty || host == 'localhost' ? 'My $kind' : host;
  }

  Future<void> _save() async {
    await (await _stateFile()).writeAsString(jsonEncode({
      'deviceId': deviceId,
      'deviceName': deviceName,
      'enabled': enabled,
      'clipboardSync': clipboardSync,
      'peers': pairedPeers.map((p) => p.toJson(includeSecret: true)).toList(),
    }));
  }

  Future<void> _saveInbox() async {
    if (_inbox.length > _maxInbox) _inbox.removeRange(0, _inbox.length - _maxInbox);
    await (await _inboxFile()).writeAsString(jsonEncode(_inbox.map((m) => m.toJson()).toList()));
  }

  String _token(int bytes) => base64Url.encode(List.generate(bytes, (_) => _random.nextInt(256))).replaceAll('=', '');

  // --------------------------------------------------------------- lifecycle

  Future<void> setEnabled(bool on) async {
    enabled = on;
    await _save();
    if (on) {
      await start();
    } else {
      await stop();
    }
    notifyListeners();
  }

  Future<void> setDeviceName(String name) async {
    deviceName = name.trim().isEmpty ? _defaultName() : name.trim();
    await _save();
    notifyListeners();
  }

  Future<void> setClipboardSync(bool on) async {
    clipboardSync = on;
    await _save();
    _restartClipboardWatch();
    notifyListeners();
  }

  Future<void> start() async {
    if (_server != null) return;
    lastError = null;
    try {
      _server = await HttpServer.bind(InternetAddress.anyIPv4, defaultPort, shared: false);
    } catch (_) {
      try {
        _server = await HttpServer.bind(InternetAddress.anyIPv4, 0);
      } catch (e) {
        lastError = 'Could not open the link port: $e';
        notifyListeners();
        return;
      }
    }
    port = _server!.port;
    _server!.listen(_handle, onError: (_) {});
    try {
      _udp = await RawDatagramSocket.bind(InternetAddress.anyIPv4, discoveryPort, reuseAddress: true);
      _udp!.broadcastEnabled = true;
      _udp!.listen((event) {
        if (event != RawSocketEvent.read) return;
        final dg = _udp?.receive();
        if (dg != null) _onAnnouncement(dg);
      });
      _announce();
      _announceTimer = Timer.periodic(const Duration(seconds: 5), (_) => _announce());
    } catch (e) {
      lastError = 'Discovery is unavailable on this network ($e). You can still pair by IP address.';
    }
    _restartClipboardWatch();
    notifyListeners();
  }

  Future<void> stop() async {
    _announceTimer?.cancel();
    _clipTimer?.cancel();
    _udp?.close();
    _udp = null;
    await _server?.close(force: true);
    _server = null;
    _peers.removeWhere((_, p) => !p.paired);
    notifyListeners();
  }

  @override
  void dispose() {
    stop();
    _http.close();
    super.dispose();
  }

  /// IPv4 addresses other devices can use to reach this one.
  Future<List<String>> localAddresses() async {
    final out = <String>[];
    try {
      for (final i in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
        for (final a in i.addresses) {
          if (!a.isLoopback && !a.address.startsWith('169.254.')) out.add(a.address);
        }
      }
    } catch (_) {}
    return out;
  }

  // --------------------------------------------------------------- discovery

  void _announce() {
    final msg = utf8.encode(jsonEncode({'t': 'webdeck-link', 'v': 1, 'id': deviceId, 'name': deviceName, 'platform': platform, 'port': port}));
    try {
      _udp?.send(msg, InternetAddress('255.255.255.255'), discoveryPort);
    } catch (_) {}
    notifyListeners(); // refresh "online" states
  }

  void _onAnnouncement(Datagram dg) {
    try {
      final j = jsonDecode(utf8.decode(dg.data)) as Map<String, dynamic>;
      if (j['t'] != 'webdeck-link' || j['id'] == deviceId) return;
      final id = j['id'] as String;
      final existing = _peers[id];
      if (existing != null) {
        existing
          ..name = j['name'] as String? ?? existing.name
          ..platform = j['platform'] as String? ?? existing.platform
          ..addr = dg.address.address
          ..port = (j['port'] as num?)?.toInt() ?? existing.port
          ..lastSeen = DateTime.now();
      } else {
        _peers[id] = LinkPeer(
          id: id,
          name: j['name'] as String? ?? 'Device',
          platform: j['platform'] as String? ?? '',
          addr: dg.address.address,
          port: (j['port'] as num?)?.toInt() ?? defaultPort,
          lastSeen: DateTime.now(),
        );
      }
      notifyListeners();
    } catch (_) {}
  }

  // ------------------------------------------------------------------ pairing

  /// A short-lived code to type on the other device.
  ({String code, DateTime expires}) newPairCode() {
    _pairCode = (100000 + _random.nextInt(900000)).toString();
    _pairCodeExpires = DateTime.now().add(const Duration(minutes: 5));
    _pairAttempts = 0;
    notifyListeners();
    return (code: _pairCode!, expires: _pairCodeExpires!);
  }

  /// Pairs with the device at [addr] that is currently showing [code].
  Future<LinkPeer> pairWith(String addr, String code, {int? peerPort}) async {
    if (!running) throw const LinkException('Turn on Device Link first');
    final target = Uri(scheme: 'http', host: addr.trim(), port: peerPort ?? defaultPort, path: '/link/pair');
    final http.Response res;
    try {
      res = await _http
          .post(target, headers: {'content-type': 'application/json'}, body: jsonEncode({'code': code.trim(), 'id': deviceId, 'name': deviceName, 'platform': platform, 'port': port}))
          .timeout(const Duration(seconds: 8));
    } catch (e) {
      throw LinkException('Could not reach $addr. Is Device Link on there, and are both devices on the same Wi-Fi?');
    }
    if (res.statusCode == 403) throw const LinkException('Wrong or expired code');
    if (res.statusCode != 200) throw LinkException('Pairing failed (HTTP ${res.statusCode})');
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final peer = LinkPeer(id: j['id'] as String, name: j['name'] as String, platform: j['platform'] as String? ?? '', addr: addr.trim(), port: (j['port'] as num?)?.toInt() ?? target.port, secret: j['secret'] as String, lastSeen: DateTime.now());
    _peers[peer.id] = peer;
    await _save();
    notifyListeners();
    return peer;
  }

  Future<void> unpair(String id) async {
    _peers.remove(id);
    await _save();
    notifyListeners();
  }

  // ---------------------------------------------------------------- signing

  static String _sign(String secret, String data) => Hmac(sha256, base64Url.decode(base64Url.normalize(secret))).convert(utf8.encode(data)).toString();

  static bool _constantTimeEquals(String a, String b) {
    if (a.length != b.length) return false;
    var r = 0;
    for (var i = 0; i < a.length; i++) {
      r |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return r == 0;
  }

  Map<String, String> _authHeaders(LinkPeer peer, String path, String extra) {
    final ts = DateTime.now().millisecondsSinceEpoch.toString();
    return {'x-link-id': deviceId, 'x-link-ts': ts, 'x-link-sig': _sign(peer.secret!, '$ts\nPOST\n$path\n$extra')};
  }

  LinkPeer? _verify(HttpRequest req, String extra) {
    final peer = _peers[req.headers.value('x-link-id') ?? ''];
    final ts = int.tryParse(req.headers.value('x-link-ts') ?? '');
    final sig = req.headers.value('x-link-sig') ?? '';
    if (peer == null || !peer.paired || ts == null) return null;
    if ((DateTime.now().millisecondsSinceEpoch - ts).abs() > 120000) return null;
    final expected = _sign(peer.secret!, '$ts\nPOST\n${req.uri.path}\n$extra');
    if (!_constantTimeEquals(expected, sig)) return null;
    peer
      ..addr = req.connectionInfo?.remoteAddress.address ?? peer.addr
      ..lastSeen = DateTime.now();
    return peer;
  }

  // ----------------------------------------------------------------- server

  Future<void> _handle(HttpRequest req) async {
    final res = req.response;
    Future<void> json(int status, Object body) async {
      res.statusCode = status;
      res.headers.contentType = ContentType.json;
      res.write(jsonEncode(body));
      await res.close();
    }

    try {
      final path = req.uri.path;
      if (req.method == 'GET' && path == '/link/hello') {
        return await json(200, {'app': 'webdeck', 'id': deviceId, 'name': deviceName, 'platform': platform, 'port': port});
      }
      if (req.method == 'POST' && path == '/link/pair') {
        final body = jsonDecode(await utf8.decodeStream(req).timeout(const Duration(seconds: 10))) as Map<String, dynamic>;
        final ok = _pairCode != null && _pairCodeExpires!.isAfter(DateTime.now()) && _pairAttempts < 5 && body['code'] == _pairCode;
        _pairAttempts++;
        if (!ok) return await json(403, {'error': 'bad code'});
        final secret = _token(32);
        final peer = LinkPeer(
          id: body['id'] as String,
          name: body['name'] as String? ?? 'Device',
          platform: body['platform'] as String? ?? '',
          addr: req.connectionInfo?.remoteAddress.address ?? '',
          port: (body['port'] as num?)?.toInt() ?? defaultPort,
          secret: secret,
          lastSeen: DateTime.now(),
        );
        _peers[peer.id] = peer;
        _pairCode = null;
        await _save();
        notifyListeners();
        unawaited(_notifications.post(appId: 'webdeck', appName: 'Device Link', title: 'Paired with ${peer.name}', body: 'You can now share files, messages and your clipboard.'));
        return await json(200, {'id': deviceId, 'name': deviceName, 'platform': platform, 'port': port, 'secret': secret});
      }
      if (req.method == 'POST' && path == '/link/msg') {
        final raw = await utf8.decodeStream(req).timeout(const Duration(seconds: 15));
        if (raw.length > 1024 * 1024) return await json(413, {'error': 'too large'});
        final peer = _verify(req, sha256.convert(utf8.encode(raw)).toString());
        if (peer == null) return await json(401, {'error': 'unauthorized'});
        final body = jsonDecode(raw) as Map<String, dynamic>;
        await _receive(peer, body['channel'] as String, (body['payload'] as Map).cast<String, dynamic>());
        return await json(200, {'ok': true});
      }
      if (req.method == 'POST' && path == '/link/file') {
        final name = Uri.decodeComponent(req.headers.value('x-link-name') ?? 'file');
        final size = req.headers.value('x-link-size') ?? '';
        final peer = _verify(req, '$name\n$size');
        if (peer == null) return await json(401, {'error': 'unauthorized'});
        final saved = await _receiveFile(req, name);
        await _receive(peer, 'files', {'name': p.basename(saved.path), 'size': await saved.length(), 'path': saved.path});
        return await json(200, {'ok': true});
      }
      return await json(404, {'error': 'not found'});
    } catch (e) {
      try {
        await json(500, {'error': '$e'});
      } catch (_) {}
    }
  }

  /// `~/Downloads/WebDeck/Received` (or the WebDeck folder when there's no Downloads).
  Future<Directory> receivedDir() async {
    Directory? root;
    try {
      final d = await getDownloadsDirectory();
      if (d != null) root = Directory(p.join(d.path, 'WebDeck'));
    } catch (_) {}
    root ??= Directory(p.join((await _baseDir()).path, 'downloads'));
    final dir = Directory(p.join(root.path, 'Received'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<File> _receiveFile(HttpRequest req, String rawName) async {
    var name = p.basename(rawName.replaceAll('\\', '/')).replaceAll(RegExp(r'[\x00-\x1f/:*?"<>|]'), '_').trim();
    if (name.isEmpty || name == '.' || name == '..') name = 'file';
    final dir = await receivedDir();
    var target = File(p.join(dir.path, name));
    final stem = p.basenameWithoutExtension(name), ext = p.extension(name);
    for (var i = 2; await target.exists(); i++) {
      target = File(p.join(dir.path, '$stem ($i)$ext'));
    }
    final part = File('${target.path}.part');
    final sink = part.openWrite();
    try {
      await sink.addStream(req);
    } finally {
      await sink.close();
    }
    return part.rename(target.path);
  }

  Future<void> _receive(LinkPeer peer, String channel, Map<String, dynamic> payload) async {
    if (channel == 'clipboard') {
      final text = payload['text'] as String? ?? '';
      if (text.isEmpty || text.length > _maxClipboard) return;
      _lastClipboard = text;
      _addClipboard(text, peer.name);
      if (clipboardSync) {
        try {
          await writeClipboard(text);
        } catch (_) {}
      }
      notifyListeners();
      return;
    }
    final m = LinkMessage(id: _token(9), peerId: peer.id, peerName: peer.name, channel: channel, outgoing: false, payload: payload, at: DateTime.now());
    _inbox.add(m);
    await _saveInbox();
    notifyListeners();
    if (channel == 'chat') {
      unawaited(_notifications.post(appId: 'messages', appName: 'Messages', title: peer.name, body: '${payload['text'] ?? ''}'));
    } else if (channel == 'files') {
      unawaited(_notifications.post(appId: 'nearby-share', appName: 'Nearby Share', title: 'Received ${payload['name']}', body: 'From ${peer.name}. Saved to Downloads/WebDeck/Received.'));
    }
  }

  // ----------------------------------------------------------------- sending

  LinkPeer _peer(String id) {
    final peer = _peers[id];
    if (peer == null || !peer.paired) throw const LinkException('Unknown or unpaired device');
    if (!running) throw const LinkException('Device Link is off');
    return peer;
  }

  Future<LinkMessage> send(String peerId, String channel, Map<String, dynamic> payload) async {
    final peer = _peer(peerId);
    final raw = jsonEncode({'channel': channel, 'payload': payload});
    final headers = {..._authHeaders(peer, '/link/msg', sha256.convert(utf8.encode(raw)).toString()), 'content-type': 'application/json'};
    try {
      final res = await _http.post(Uri(scheme: 'http', host: peer.addr, port: peer.port, path: '/link/msg'), headers: headers, body: raw).timeout(const Duration(seconds: 8));
      if (res.statusCode == 401) throw LinkException('${peer.name} no longer recognizes this device. Pair again.');
      if (res.statusCode != 200) throw LinkException('${peer.name} returned HTTP ${res.statusCode}');
    } on LinkException {
      rethrow;
    } catch (_) {
      throw LinkException('${peer.name} is not reachable right now');
    }
    peer.lastSeen = DateTime.now();
    final m = LinkMessage(id: _token(9), peerId: peer.id, peerName: peer.name, channel: channel, outgoing: true, payload: payload, at: DateTime.now());
    if (channel != 'clipboard') {
      _inbox.add(m);
      await _saveInbox();
    }
    notifyListeners();
    return m;
  }

  Future<LinkMessage> sendFile(String peerId, String path, {void Function(int sent, int total)? onProgress}) async {
    final peer = _peer(peerId);
    final file = File(path);
    final size = await file.length();
    final name = p.basename(path);
    final req = http.StreamedRequest('POST', Uri(scheme: 'http', host: peer.addr, port: peer.port, path: '/link/file'))
      ..headers.addAll({..._authHeaders(peer, '/link/file', '$name\n$size'), 'x-link-name': Uri.encodeComponent(name), 'x-link-size': '$size'})
      ..contentLength = size;
    final done = _http.send(req);
    var sent = 0;
    try {
      await for (final chunk in file.openRead()) {
        req.sink.add(chunk);
        sent += chunk.length;
        onProgress?.call(sent, size);
      }
      await req.sink.close();
      final res = await done.timeout(const Duration(minutes: 2));
      if (res.statusCode != 200) throw LinkException('${peer.name} refused the file (HTTP ${res.statusCode})');
    } on LinkException {
      rethrow;
    } catch (e) {
      throw LinkException('Sending to ${peer.name} failed: $e');
    }
    final m = LinkMessage(id: _token(9), peerId: peer.id, peerName: peer.name, channel: 'files', outgoing: true, payload: {'name': name, 'size': size, 'path': path}, at: DateTime.now());
    _inbox.add(m);
    await _saveInbox();
    notifyListeners();
    return m;
  }

  List<LinkMessage> inbox({String? channel, DateTime? since, String? peerId}) => _inbox
      .where((m) => (channel == null || m.channel == channel) && (since == null || m.at.isAfter(since)) && (peerId == null || m.peerId == peerId))
      .toList();

  Future<void> clearInbox(String channel) async {
    _inbox.removeWhere((m) => m.channel == channel);
    await _saveInbox();
    notifyListeners();
  }

  // --------------------------------------------------------------- clipboard

  void _restartClipboardWatch() {
    _clipTimer?.cancel();
    if (!running || !clipboardSync) return;
    _clipTimer = Timer.periodic(const Duration(milliseconds: 1500), (_) => _pollClipboard());
  }

  Future<void> _pollClipboard() async {
    String? text;
    try {
      text = await readClipboard();
    } catch (_) {
      return;
    }
    if (text == null || text.isEmpty || text == _lastClipboard) return;
    _lastClipboard = text;
    if (text.length > _maxClipboard) return;
    _addClipboard(text, deviceName);
    await shareClipboard(text);
  }

  /// Sends text to every online paired device's clipboard.
  Future<int> shareClipboard(String text) async {
    var n = 0;
    for (final peer in pairedPeers.where((p) => p.online)) {
      try {
        await send(peer.id, 'clipboard', {'text': text});
        n++;
      } catch (_) {}
    }
    return n;
  }

  void _addClipboard(String text, String from) {
    clipboardHistory.removeWhere((c) => c['text'] == text);
    clipboardHistory.insert(0, {'text': text, 'from': from, 'at': DateTime.now().toIso8601String()});
    if (clipboardHistory.length > 50) clipboardHistory.removeLast();
    notifyListeners();
  }

  Future<void> copyToClipboard(String text) async {
    _lastClipboard = text;
    await writeClipboard(text);
  }
}
