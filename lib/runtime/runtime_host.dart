import 'dart:async';
import 'dart:convert';
import 'dart:io' hide BytesBuilder;
import 'dart:math';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;
import 'package:mime/mime.dart' as mime;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shelf/shelf.dart';

import '../data/models/installed_app.dart';
import 'app_data_store.dart';
import 'job_scheduler.dart';
import 'link_service.dart';
import 'manifest.dart';
import 'notification_service.dart';
import 'settings_service.dart';
import 'tools_service.dart';

/// Shows a confirmation prompt in the host UI. Returns false when no UI is available.
typedef ConfirmPrompt = Future<bool> Function(String title, String message);

class RuntimeError implements Exception {
  final String code;
  final String message;
  final int status;
  const RuntimeError(this.code, this.message, [this.status = 400]);
  @override
  String toString() => message;
}

class _PickedFile {
  final String path;
  final String name;
  const _PickedFile(this.path, this.name);
}

/// Everything WebDeck provides to runtime apps: storage, network, files,
/// notifications, background jobs and helper tools. One instance per process;
/// [handlerFor] builds the `/__webdeck/*` handler mounted on each app's server.
class RuntimeHost {
  final AppDataStore data;
  final SettingsService settings;
  final NotificationService notifications;
  final ToolsService tools;
  final Future<Directory> Function() baseDir;
  final http.Client _http;
  late JobScheduler jobs;

  /// Device Link (LAN pairing, files, messages, clipboard); null when unavailable.
  LinkService? link;

  /// Hooks into the Flutter UI; replaced by the app at startup.
  ConfirmPrompt confirm = (_, _) async => false;
  Future<bool> Function(Uri url) openExternalUrl = (_) async => false;

  /// Overridable for tests.
  Future<List<PlatformFile>> Function({required FileType type, List<String>? allowedExtensions})
      pickFiles = ({required type, allowedExtensions}) =>
          FilePicker.pickFiles(type: type, allowedExtensions: allowedExtensions);

  RuntimeHost({
    required this.data,
    required this.settings,
    required this.notifications,
    required this.tools,
    required this.baseDir,
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final Map<String, Map<String, _PickedFile>> _picked = {};
  final _random = Random.secure();

  static const _maxFetchBytes = 20 * 1024 * 1024;
  static const _maxUploadBytes = 512 * 1024 * 1024;
  static const _defaultUserAgent =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/131.0.0.0 Safari/537.36';

  // ------------------------------------------------------------------ paths

  /// `~/Downloads/WebDeck/<App Name>` (falls back to `<WebDeck>/downloads/<id>`).
  Future<Directory> downloadsDir(InstalledApp app) async {
    Directory? root;
    try {
      final d = await getDownloadsDirectory();
      if (d != null) root = Directory(p.join(d.path, 'WebDeck'));
    } catch (_) {}
    root ??= Directory(p.join((await baseDir()).path, 'downloads'));
    final safeName = app.name.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_').trim();
    final dir = Directory(p.join(root.path, safeName.isEmpty ? app.id : safeName));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  // ---------------------------------------------------------------- handler

  Handler handlerFor(InstalledApp app, WebDeckManifest manifest) {
    return (Request request) async {
      final path = request.url.path; // starts with "__webdeck/"
      try {
        if (request.method == 'GET' && path == '__webdeck/sdk.js') {
          return await _asset('assets/runtime/webdeck-sdk.js', 'application/javascript; charset=utf-8');
        }
        if (request.method == 'GET' && path == '__webdeck/ui.css') {
          return await _asset('assets/runtime/ui.css', 'text/css; charset=utf-8');
        }
        // Shared open-source libraries (pdf-lib, PDF.js, JSZip, …) so apps work offline
        // without each bundling its own copy. See assets/runtime/vendor/LICENSES.md.
        final vendor = RegExp(r'^__webdeck/vendor/([a-z0-9][a-z0-9._-]*\.js)$').firstMatch(path);
        if (request.method == 'GET' && vendor != null) {
          try {
            return await _asset('assets/runtime/vendor/${vendor.group(1)}', 'application/javascript; charset=utf-8',
                cache: true);
          } catch (_) {
            throw const RuntimeError('not_found', 'Unknown library', 404);
          }
        }

        _checkSameOrigin(request);

        if (request.method == 'GET' && path.startsWith('__webdeck/picked/')) {
          return await _servePicked(app, request);
        }
        if (request.method == 'POST' && path == '__webdeck/upload') {
          _require(manifest, RuntimePermission.files);
          return _json(await _upload(app, request));
        }
        if (request.method == 'POST' && path == '__webdeck/api') {
          if (request.headers['x-webdeck'] != '1') {
            throw const RuntimeError('forbidden', 'Missing X-WebDeck header', 403);
          }
          final body = jsonDecode(await request.readAsString());
          if (body is! Map<String, dynamic> || body['method'] is! String) {
            throw const RuntimeError('bad_request', 'Expected {"method": ..., "params": {...}}');
          }
          final params = (body['params'] as Map?)?.cast<String, dynamic>() ?? {};
          final result = await call(app, manifest, body['method'] as String, params);
          return _json({'ok': true, 'result': result});
        }
        throw const RuntimeError('not_found', 'Unknown WebDeck runtime route', 404);
      } on RuntimeError catch (e) {
        return _json({'ok': false, 'code': e.code, 'error': e.message}, status: e.status);
      } on FormatException catch (e) {
        return _json({'ok': false, 'code': 'bad_request', 'error': e.message}, status: 400);
      } catch (e) {
        return _json({'ok': false, 'code': 'internal', 'error': e.toString()}, status: 500);
      }
    };
  }

  /// Blocks other web pages (and DNS-rebinding hosts) from driving the API.
  void _checkSameOrigin(Request request) {
    final host = request.requestedUri.host;
    if (host != '127.0.0.1' && host != 'localhost') {
      throw const RuntimeError('forbidden', 'Invalid host', 403);
    }
    final origin = request.headers['origin'];
    if (origin == null) return;
    final port = request.requestedUri.port;
    if (origin != 'http://127.0.0.1:$port' && origin != 'http://localhost:$port') {
      throw const RuntimeError('forbidden', 'Cross-origin calls are not allowed', 403);
    }
  }

  static void _require(WebDeckManifest manifest, String permission) {
    if (!manifest.has(permission)) {
      throw RuntimeError(
        'permission_denied',
        'This app did not request the "$permission" permission in webdeck.json',
        403,
      );
    }
  }

  static Map<String, String> get _noCache => {'Cache-Control': 'no-store'};

  Response _json(Object body, {int status = 200}) => Response(
        status,
        body: jsonEncode(body),
        headers: {'Content-Type': 'application/json; charset=utf-8', ..._noCache},
      );

  Future<Response> _asset(String key, String contentType, {bool cache = false}) async {
    final data = await rootBundle.load(key);
    return Response.ok(
      data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
      headers: {
        'Content-Type': contentType,
        ...(cache ? {'Cache-Control': 'public, max-age=86400'} : _noCache),
      },
    );
  }

  // --------------------------------------------------------------- dispatch

  /// Executes one API method. Public so it can be unit-tested without HTTP.
  Future<Object?> call(
    InstalledApp app,
    WebDeckManifest manifest,
    String method,
    Map<String, dynamic> params,
  ) async {
    String str(String key) {
      final v = params[key];
      if (v is! String || v.isEmpty) throw RuntimeError('bad_request', '"$key" is required');
      return v;
    }

    Map<String, dynamic>? map(String key) => (params[key] as Map?)?.cast<String, dynamic>();

    switch (method) {
      case 'app.info':
        return {
          'id': app.id,
          'name': app.name,
          'version': app.version,
          'permissions': manifest.permissions.toList(),
          'runtime': kRuntimeApiVersion,
          'platform': WebDeckManifest.currentPlatformId,
        };

      // ---- storage (always granted, scoped to this app)
      case 'db.collections':
        return data.collections(app.id);
      case 'db.find':
        return data.find(
          app.id,
          str('collection'),
          where: map('where'),
          sort: params['sort'] as String?,
          limit: (params['limit'] as num?)?.toInt(),
          skip: (params['skip'] as num?)?.toInt() ?? 0,
        );
      case 'db.get':
        return data.get(app.id, str('collection'), str('id'));
      case 'db.insert':
        final doc = map('doc');
        if (doc == null) throw const RuntimeError('bad_request', '"doc" is required');
        return data.insert(app.id, str('collection'), doc);
      case 'db.update':
        return data.update(app.id, str('collection'), str('id'), map('patch') ?? {});
      case 'db.remove':
        return data.remove(app.id, str('collection'), str('id'));
      case 'db.removeWhere':
        return data.removeWhere(app.id, str('collection'), map('where'));
      case 'kv.get':
        return data.kvGet(app.id, str('key'));
      case 'kv.set':
        await data.kvSet(app.id, str('key'), params['value']);
        return true;
      case 'kv.all':
        return data.kvAll(app.id);

      // ---- network
      case 'net.fetch':
        _require(manifest, RuntimePermission.net);
        return _fetch(params, allowLocal: manifest.has(RuntimePermission.localnet));
      case 'net.download':
        _require(manifest, RuntimePermission.net);
        _require(manifest, RuntimePermission.files);
        return _startDownload(app, params);
      case 'downloads.get':
        final d = _downloads[str('id')];
        if (d == null || d.appId != app.id) throw const RuntimeError('not_found', 'Unknown download', 404);
        return d.toJson();
      case 'downloads.cancel':
        final d = _downloads[str('id')];
        if (d == null || d.appId != app.id) throw const RuntimeError('not_found', 'Unknown download', 404);
        d.cancelled = true;
        return true;

      // ---- shell (Terminal)
      case 'shell.run':
        _require(manifest, RuntimePermission.shell);
        final cwdParam = params['cwd'] as String?;
        final home = Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? (await baseDir()).path;
        final cwd = cwdParam != null && cwdParam.isNotEmpty ? cwdParam : home;
        if (!await Directory(cwd).exists()) throw RuntimeError('not_found', 'Folder not found: $cwd', 404);
        final task = await tools.runShell(appId: app.id, appName: app.name, command: str('command'), cwd: cwd);
        return task.toJson();
      case 'shell.home':
        _require(manifest, RuntimePermission.shell);
        return Platform.environment['HOME'] ?? Platform.environment['USERPROFILE'] ?? (await baseDir()).path;

      // ---- files
      case 'files.pick':
        _require(manifest, RuntimePermission.files);
        return _pick(app, params);
      case 'files.save':
        _require(manifest, RuntimePermission.files);
        return _save(app, params);
      case 'files.pickFolder':
        _require(manifest, RuntimePermission.files);
        return _pickFolder(app, params);
      case 'files.url':
        _require(manifest, RuntimePermission.files);
        final path = await _allowedPath(app, str('path'), manifest);
        final st = await FileStat.stat(path);
        return _register(app, path, p.basename(path), st.size);
      case 'files.list':
        _require(manifest, RuntimePermission.files);
        final dirPath = await _allowedPath(app, str('path'));
        return _listFiles(app, dirPath, params);
      case 'files.reveal':
      case 'files.open':
        _require(manifest, RuntimePermission.files);
        final path = await _allowedPath(app, str('path'), manifest);
        await _openPath(path, reveal: method == 'files.reveal');
        return true;
      case 'files.openFolder':
        _require(manifest, RuntimePermission.files);
        await _openPath((await downloadsDir(app)).path);
        return true;
      case 'files.downloadsDir':
        _require(manifest, RuntimePermission.files);
        return (await downloadsDir(app)).path;

      // ---- notifications & system
      case 'notify':
        _require(manifest, RuntimePermission.notify);
        final url = params['url'] as String?;
        await notifications.post(
          appId: app.id,
          appName: app.name,
          title: str('title'),
          body: params['body'] as String? ?? '',
          url: url != null && _isWebUrl(url) ? url : null,
        );
        return true;
      case 'system.openUrl':
        final url = str('url');
        if (!_isWebUrl(url)) throw const RuntimeError('bad_request', 'Only http(s) URLs can be opened');
        return openExternalUrl(Uri.parse(url));

      // ---- tools
      case 'tools.status':
        _require(manifest, RuntimePermission.tools);
        final statuses = await tools.statuses(withVersion: params['versions'] == true);
        return {
          for (final s in statuses)
            s.spec.id: {
              ...s.toJson(),
              if (tools.installState(s.spec.id) case final st?)
                'installing': {'message': st.message, 'progress': st.progress},
            },
          'supported': ToolsService.isSupportedPlatform,
        };
      case 'tools.install':
        _require(manifest, RuntimePermission.tools);
        return _installTool(app, str('tool'));
      case 'tools.run':
        _require(manifest, RuntimePermission.tools);
        final args = (params['args'] as List?)?.map((e) => e.toString()).toList() ?? const <String>[];
        var cwd = (await downloadsDir(app)).path;
        final subdir = params['subdir'];
        if (subdir is String && subdir.trim().isNotEmpty) {
          cwd = p.join(cwd, _safeFileName(subdir));
        }
        final task = await tools.run(
          appId: app.id,
          appName: app.name,
          tool: str('tool'),
          args: args,
          cwd: cwd,
        );
        return task.toJson();
      case 'tasks.get':
        if (!manifest.has(RuntimePermission.shell)) _require(manifest, RuntimePermission.tools);
        final task = tools.task(str('id'));
        if (task == null || task.appId != app.id) throw const RuntimeError('not_found', 'Unknown task', 404);
        return task.toJson(since: (params['since'] as num?)?.toInt() ?? 0);
      case 'tasks.cancel':
        if (!manifest.has(RuntimePermission.shell)) _require(manifest, RuntimePermission.tools);
        final task = tools.task(str('id'));
        if (task == null || task.appId != app.id) throw const RuntimeError('not_found', 'Unknown task', 404);
        return tools.cancel(task.id);

      // ---- Device Link
      case String m when m.startsWith('link.'):
        _require(manifest, RuntimePermission.link);
        return _linkCall(app, manifest, m, params);

      // ---- jobs
      case 'jobs.list':
        _require(manifest, RuntimePermission.jobs);
        final states = await jobs.states(app.id);
        return [
          for (final j in manifest.jobs)
            {...j.toJson(), ...(states[j.id] ?? const JobState()).toJson()},
        ];
      case 'jobs.run':
        _require(manifest, RuntimePermission.jobs);
        return (await jobs.runNow(app, str('id'))).toJson();
      case 'job.done':
      case 'job.fail':
        _require(manifest, RuntimePermission.jobs);
        return jobs.complete(
          app.id,
          str('runId'),
          ok: method == 'job.done',
          summary: (params['summary'] ?? params['error'])?.toString(),
        );
      case 'job.log':
        _require(manifest, RuntimePermission.jobs);
        jobs.log(app.id, str('runId'), params['message']?.toString() ?? '');
        return true;
    }
    throw RuntimeError('not_found', 'Unknown method "$method"', 404);
  }

  // ------------------------------------------------------------ device link

  Future<Object?> _linkCall(InstalledApp app, WebDeckManifest manifest, String method, Map<String, dynamic> params) async {
    final l = link;
    if (l == null) throw const RuntimeError('unsupported', 'Device Link is not available on this platform');
    String str(String k) {
      final v = params[k];
      if (v is! String || v.isEmpty) throw RuntimeError('bad_request', '"$k" is required');
      return v;
    }

    try {
      switch (method) {
        case 'link.status':
          return {
            'enabled': l.enabled,
            'running': l.running,
            'deviceId': l.deviceId,
            'deviceName': l.deviceName,
            'port': l.port,
            'clipboardSync': l.clipboardSync,
            'addresses': await l.localAddresses(),
            'error': l.lastError,
          };
        case 'link.enable':
          final on = params['enabled'] == true;
          if (on && !l.enabled) {
            final ok = await confirm(
              'Turn on Device Link?',
              '"${app.name}" wants to turn on Device Link.\n\nWebDeck will become visible to other WebDeck devices on this '
                  'network. Only devices you pair with a code can send you files, messages or clipboard text.',
            );
            if (!ok) throw const RuntimeError('cancelled', 'Device Link stays off');
          }
          await l.setEnabled(on);
          return true;
        case 'link.setName':
          await l.setDeviceName(str('name'));
          return true;
        case 'link.peers':
          return l.peers.map((p) => p.toJson()).toList();
        case 'link.pairCode':
          if (!l.running) throw const RuntimeError('link_off', 'Turn on Device Link first');
          final c = l.newPairCode();
          return {'code': c.code, 'expiresAt': c.expires.toIso8601String(), 'addresses': await l.localAddresses(), 'port': l.port};
        case 'link.pair':
          final peer = await l.pairWith(str('addr'), str('code'), peerPort: (params['port'] as num?)?.toInt());
          return peer.toJson();
        case 'link.unpair':
          await l.unpair(str('id'));
          return true;
        case 'link.send':
          final channel = str('channel');
          if (channel == 'clipboard' || channel == 'files') throw const RuntimeError('bad_request', 'Use link.clipboard / link.sendFile');
          final payload = (params['payload'] as Map?)?.cast<String, dynamic>() ?? {};
          if (jsonEncode(payload).length > 256 * 1024) throw const RuntimeError('too_large', 'Message is too large');
          return (await l.send(str('peer'), channel, payload)).toJson();
        case 'link.sendFile':
          final path = await _allowedPath(app, str('path'), manifest);
          return (await l.sendFile(str('peer'), path)).toJson();
        case 'link.inbox':
          final since = (params['since'] as num?)?.toInt();
          return l
              .inbox(
                channel: params['channel'] as String?,
                peerId: params['peer'] as String?,
                since: since == null ? null : DateTime.fromMillisecondsSinceEpoch(since),
              )
              .map((m) => m.toJson())
              .toList();
        case 'link.clearInbox':
          await l.clearInbox(str('channel'));
          return true;
        case 'link.clipboard':
          switch (params['action']) {
            case 'history':
              return l.clipboardHistory;
            case 'setSync':
              await l.setClipboardSync(params['enabled'] == true);
              return true;
            case 'share':
              final text = str('text');
              await l.copyToClipboard(text);
              return await l.shareClipboard(text);
            case 'copy':
              await l.copyToClipboard(str('text'));
              return true;
          }
          throw const RuntimeError('bad_request', 'Unknown clipboard action');
        case 'link.receivedDir':
          return (await l.receivedDir()).path;
      }
    } on LinkException catch (e) {
      throw RuntimeError('link', e.message, 409);
    }
    throw RuntimeError('not_found', 'Unknown method "$method"', 404);
  }

  // ---------------------------------------------------------------- network

  static bool _isWebUrl(String url) {
    final u = Uri.tryParse(url);
    return u != null && (u.scheme == 'http' || u.scheme == 'https') && u.host.isNotEmpty;
  }

  /// Loopback and link-local (cloud metadata) targets are off limits.
  static bool isBlockedHost(String host) {
    final h = host.toLowerCase().replaceAll('[', '').replaceAll(']', '');
    return h == 'localhost' ||
        h.endsWith('.localhost') ||
        h.startsWith('127.') ||
        h == '0.0.0.0' ||
        h == '::1' ||
        h == '::' ||
        h.startsWith('169.254.') ||
        h.startsWith('fe80:');
  }

  Future<Map<String, dynamic>> _fetch(Map<String, dynamic> params, {bool allowLocal = false}) async {
    final url = params['url'];
    if (url is! String || !_isWebUrl(url)) {
      throw const RuntimeError('bad_request', '"url" must be an http(s) URL');
    }
    final uri = Uri.parse(url);
    if (isBlockedHost(uri.host) && !allowLocal) {
      throw const RuntimeError('forbidden', 'Fetching local addresses needs the "localnet" permission', 403);
    }
    final method = (params['method'] as String? ?? 'GET').toUpperCase();
    final req = http.Request(method, uri)
      ..followRedirects = true
      ..maxRedirects = 8;
    if (params['rawHeaders'] != true) {
      req.headers['User-Agent'] = _defaultUserAgent;
      req.headers['Accept'] = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8';
      req.headers['Accept-Language'] = 'en-US,en;q=0.9';
    }
    if (params['followRedirects'] == false) req.followRedirects = false;
    final headers = (params['headers'] as Map?)?.cast<String, dynamic>() ?? {};
    headers.forEach((k, v) {
      if (v != null) req.headers[k] = v.toString();
    });
    final body = params['body'];
    if (body is String) req.body = body;
    if (body is Map || body is List) {
      req.body = jsonEncode(body);
      req.headers.putIfAbsent('Content-Type', () => 'application/json');
    }
    final timeoutSec = ((params['timeout'] as num?)?.toInt() ?? 30).clamp(1, 120);

    final http.StreamedResponse res;
    try {
      res = await _http.send(req).timeout(Duration(seconds: timeoutSec));
    } on TimeoutException {
      throw const RuntimeError('timeout', 'The request timed out', 504);
    } on Exception catch (e) {
      throw RuntimeError('network', 'Request failed: $e', 502);
    }

    final builder = BytesBuilder(copy: false);
    // maxBytes lets callers peek at endless streams (e.g. live TV) without waiting for a timeout.
    final maxBytes = (params['maxBytes'] as num?)?.toInt();
    var truncated = false;
    await for (final chunk in res.stream.timeout(Duration(seconds: timeoutSec))) {
      builder.add(chunk);
      if (maxBytes != null && builder.length >= maxBytes) {
        truncated = true;
        break;
      }
      if (builder.length > _maxFetchBytes) {
        throw const RuntimeError('too_large', 'Response is larger than 20 MB', 413);
      }
    }
    final bytes = builder.takeBytes();
    final asBase64 = params['as'] == 'base64';
    final contentType = res.headers['content-type'] ?? '';
    final isLatin1 = RegExp(r'charset=(iso-8859-1|latin1|windows-1252)', caseSensitive: false).hasMatch(contentType);
    final Object response = res;
    final finalUrl = response is http.BaseResponseWithUrl ? response.url.toString() : url;

    return {
      'status': res.statusCode,
      'reason': res.reasonPhrase,
      'ok': res.statusCode >= 200 && res.statusCode < 300,
      'size': bytes.length,
      'truncated': truncated,
      'url': finalUrl,
      'headers': res.headers,
      if (asBase64) 'base64': base64Encode(bytes) else 'text': isLatin1 ? latin1.decode(bytes) : utf8.decode(bytes, allowMalformed: true),
    };
  }

  // ------------------------------------------------------------------ files

  String _newId() => base64Url.encode(List.generate(12, (_) => _random.nextInt(256))).replaceAll('=', '');

  Map<String, dynamic> _register(InstalledApp app, String path, String name, int size) {
    final id = _newId();
    _picked.putIfAbsent(app.id, () => {})[id] = _PickedFile(path, name);
    return {
      'id': id,
      'name': name,
      'size': size,
      'path': path,
      'ext': p.extension(name).replaceFirst('.', '').toLowerCase(),
      'url': '/__webdeck/picked/$id/${Uri.encodeComponent(name)}',
    };
  }

  Future<List<Map<String, dynamic>>> _pick(InstalledApp app, Map<String, dynamic> params) async {
    final exts = (params['extensions'] as List?)?.map((e) => e.toString().replaceFirst('.', '')).toList();
    final type = switch (params['type']) {
      'image' => FileType.image,
      'video' => FileType.video,
      'audio' => FileType.audio,
      'media' => FileType.media,
      _ => exts != null && exts.isNotEmpty ? FileType.custom : FileType.any,
    };
    final files = await pickFiles(type: type, allowedExtensions: type == FileType.custom ? exts : null);
    final multiple = params['multiple'] == true;
    final out = <Map<String, dynamic>>[];
    for (final f in multiple ? files : files.take(1)) {
      final path = f.path;
      if (path == null) continue;
      out.add(_register(app, path, f.name, await File(path).length()));
    }
    if (params['remember'] == true) await _addGrants(app.id, out.map((f) => f['path'] as String));
    return out;
  }

  // ---- remembered access: files/folders the user picked stay readable after restarts.
  final Map<String, List<String>> _grantCache = {};

  Future<File> _grantFile(String appId) async => File(p.join((await data.appDir(appId)).path, 'grants.json'));

  Future<List<String>> _grants(String appId) async {
    final cached = _grantCache[appId];
    if (cached != null) return cached;
    var list = <String>[];
    try {
      final f = await _grantFile(appId);
      if (await f.exists()) list = (jsonDecode(await f.readAsString()) as List).cast<String>();
    } catch (_) {}
    return _grantCache[appId] = list;
  }

  Future<void> _addGrants(String appId, Iterable<String> paths) async {
    final list = await _grants(appId);
    for (final path in paths) {
      final n = p.normalize(path);
      if (!list.contains(n)) list.add(n);
    }
    await (await _grantFile(appId)).writeAsString(jsonEncode(list));
  }

  Future<Map<String, dynamic>?> _pickFolder(InstalledApp app, Map<String, dynamic> params) async {
    final dir = await pickDirectory();
    if (dir == null) return null;
    await _addGrants(app.id, [dir]);
    return {'path': dir, 'name': p.basename(dir), 'files': await _listFiles(app, dir, params)};
  }

  Future<List<Map<String, dynamic>>> _listFiles(InstalledApp app, String dirPath, Map<String, dynamic> params) async {
    final exts = (params['extensions'] as List?)?.map((e) => e.toString().toLowerCase().replaceFirst('.', '')).toSet();
    final recursive = params['recursive'] != false;
    final out = <Map<String, dynamic>>[];
    final dir = Directory(dirPath);
    if (!await dir.exists()) throw const RuntimeError('not_found', 'Folder not found', 404);
    await for (final e in dir.list(recursive: recursive, followLinks: false)) {
      if (e is! File) continue;
      final name = p.basename(e.path);
      if (name.startsWith('.')) continue;
      final ext = p.extension(name).replaceFirst('.', '').toLowerCase();
      if (exts != null && !exts.contains(ext)) continue;
      out.add(_register(app, e.path, name, await e.length()));
      if (out.length >= 5000) break;
    }
    out.sort((a, b) => (a['path'] as String).compareTo(b['path'] as String));
    return out;
  }

  /// Overridable for tests.
  Future<String?> Function() pickDirectory = () => FilePicker.getDirectoryPath();

  // ---- streamed downloads (books, music, …) straight to disk.
  final Map<String, _Download> _downloads = {};

  Future<Map<String, dynamic>> _startDownload(InstalledApp app, Map<String, dynamic> params) async {
    final url = params['url'];
    if (url is! String || !_isWebUrl(url)) throw const RuntimeError('bad_request', '"url" must be an http(s) URL');
    final uri = Uri.parse(url);
    if (isBlockedHost(uri.host)) throw const RuntimeError('forbidden', 'Downloading from local addresses is not allowed', 403);
    var dir = await downloadsDir(app);
    final sub = params['subdir'] as String?;
    if (sub != null && sub.trim().isNotEmpty) {
      final segments = sub.replaceAll('\\', '/').split('/').where((x) => x.trim().isNotEmpty).map(_safeFileName);
      dir = Directory(p.joinAll([dir.path, ...segments]));
      await dir.create(recursive: true);
    }
    final rawName = (params['name'] as String?)?.trim();
    final name = _safeFileName(rawName != null && rawName.isNotEmpty ? rawName : Uri.decodeComponent(uri.pathSegments.isNotEmpty ? uri.pathSegments.last : 'download'));
    var target = File(p.join(dir.path, name));
    final stem = p.basenameWithoutExtension(name), ext = p.extension(name);
    for (var i = 2; await target.exists(); i++) {
      target = File(p.join(dir.path, '$stem ($i)$ext'));
    }
    final d = _Download(_newId(), app.id, url, target.path);
    _downloads[d.id] = d;
    unawaited(() async {
      final part = File('${target.path}.part');
      try {
        final req = http.Request('GET', uri)..headers['User-Agent'] = _defaultUserAgent;
        final res = await _http.send(req).timeout(const Duration(seconds: 60));
        if (res.statusCode != 200) throw RuntimeError('http', 'Server returned HTTP ${res.statusCode}', 502);
        d.total = res.contentLength;
        final sink = part.openWrite();
        try {
          await for (final chunk in res.stream) {
            if (d.cancelled) throw const RuntimeError('cancelled', 'Cancelled');
            sink.add(chunk);
            d.received += chunk.length;
          }
        } finally {
          await sink.close();
        }
        await part.rename(target.path);
        d.status = 'done';
      } catch (e) {
        d.status = d.cancelled ? 'cancelled' : 'failed';
        d.error = e is RuntimeError ? e.message : '$e';
        if (await part.exists()) await part.delete();
      }
    }());
    return d.toJson();
  }

  Future<Map<String, dynamic>> _upload(InstalledApp app, Request request) async {
    final rawName = request.url.queryParameters['name'] ?? 'upload.bin';
    final name = _safeFileName(rawName);
    final dir = Directory(p.join((await data.tempDir(app.id)).path, _newId()));
    await dir.create(recursive: true);
    final file = File(p.join(dir.path, name));
    final sink = file.openWrite();
    var size = 0;
    try {
      await for (final chunk in request.read()) {
        size += chunk.length;
        if (size > _maxUploadBytes) throw const RuntimeError('too_large', 'Upload is larger than 512 MB', 413);
        sink.add(chunk);
      }
    } finally {
      await sink.close();
    }
    return {'ok': true, 'result': _register(app, file.path, name, size)};
  }

  Future<Response> _servePicked(InstalledApp app, Request request) async {
    final segments = request.url.pathSegments; // __webdeck, picked, <id>, <name>
    if (segments.length < 3) throw const RuntimeError('not_found', 'Unknown file', 404);
    final picked = _picked[app.id]?[segments[2]];
    if (picked == null) throw const RuntimeError('not_found', 'Unknown file', 404);
    final file = File(picked.path);
    if (!await file.exists()) throw const RuntimeError('not_found', 'File no longer exists', 404);
    return Response.ok(
      file.openRead(),
      headers: {
        'Content-Type': mime.lookupMimeType(picked.name) ?? 'application/octet-stream',
        'Content-Length': '${await file.length()}',
        ..._noCache,
      },
    );
  }

  static String _safeFileName(String name) {
    var base = p.basename(name.replaceAll('\\', '/')).replaceAll(RegExp(r'[\x00-\x1f/:*?"<>|]'), '_').trim();
    if (base.isEmpty || base == '.' || base == '..') base = 'file';
    if (base.length > 180) {
      final ext = p.extension(base);
      base = '${base.substring(0, 180 - ext.length)}$ext';
    }
    return base;
  }

  Future<Map<String, dynamic>> _save(InstalledApp app, Map<String, dynamic> params) async {
    final name = _safeFileName(params['name'] as String? ?? 'file');
    final List<int> bytes;
    if (params['base64'] is String) {
      final raw = params['base64'] as String;
      bytes = base64Decode(raw.contains(',') ? raw.substring(raw.indexOf(',') + 1) : raw);
    } else if (params['text'] is String) {
      bytes = utf8.encode(params['text'] as String);
    } else {
      throw const RuntimeError('bad_request', 'Provide "base64" or "text"');
    }
    var dir = await downloadsDir(app);
    final sub = params['subdir'] as String?;
    if (sub != null && sub.isNotEmpty) {
      // Nested folders are allowed ("Album/Disc 1"); every segment is sanitized,
      // so ".." or absolute paths can't escape the app's folder.
      final segments = sub.replaceAll('\\', '/').split('/').where((s) => s.trim().isNotEmpty).map(_safeFileName);
      dir = Directory(p.joinAll([dir.path, ...segments]));
      await dir.create(recursive: true);
    }
    var target = File(p.join(dir.path, name));
    final stem = p.basenameWithoutExtension(name), ext = p.extension(name);
    for (var i = 2; await target.exists() && params['overwrite'] != true; i++) {
      target = File(p.join(dir.path, '$stem ($i)$ext'));
    }
    await target.writeAsBytes(bytes, flush: true);
    return {'path': target.path, 'name': p.basename(target.path), 'size': bytes.length};
  }

  /// Apps may only open/reveal files in their downloads folder or files the user picked.
  Future<String> _allowedPath(InstalledApp app, String path, [WebDeckManifest? manifest]) async {
    final normalized = p.normalize(p.absolute(path));
    final downloads = p.normalize((await downloadsDir(app)).path);
    // Apps with Device Link may open files that were received from paired devices.
    if (manifest != null && manifest.has(RuntimePermission.link) && link != null) {
      final received = p.normalize((await link!.receivedDir()).path);
      final inside = p.isWithin(received, normalized) || p.equals(received, normalized);
      if (inside && (await File(normalized).exists() || await Directory(normalized).exists())) return normalized;
    }
    final picked = _picked[app.id]?.values.any((f) => p.equals(f.path, normalized)) ?? false;
    final granted = (await _grants(app.id)).any((g) => p.equals(g, normalized) || p.isWithin(g, normalized));
    if (!picked && !granted && !p.isWithin(downloads, normalized) && !p.equals(downloads, normalized)) {
      throw const RuntimeError('forbidden', 'Path is outside this app\'s files', 403);
    }
    if (!await File(normalized).exists() && !await Directory(normalized).exists()) {
      throw const RuntimeError('not_found', 'File not found', 404);
    }
    return normalized;
  }

  static Future<void> _openPath(String path, {bool reveal = false}) async {
    if (Platform.isMacOS) {
      await Process.run('open', [if (reveal) '-R', path]);
    } else if (Platform.isWindows) {
      await Process.run('explorer', [if (reveal) '/select,$path' else path]);
    } else if (Platform.isLinux) {
      await Process.run('xdg-open', [reveal ? p.dirname(path) : path]);
    } else {
      throw const RuntimeError('unsupported', 'Opening files is not supported on this platform');
    }
  }

  // ------------------------------------------------------------------ tools

  Future<Map<String, dynamic>> _installTool(InstalledApp app, String toolId) async {
    final spec = ToolsService.spec(toolId);
    if (spec == null) throw RuntimeError('bad_request', 'Unknown tool "$toolId"');
    if (!spec.installable) {
      throw RuntimeError('manual_install', '${spec.name} must be installed manually: ${spec.homepage}');
    }
    if (tools.installState(toolId) != null) return {'started': true};
    final ok = await confirm(
      'Install ${spec.name}?',
      '"${app.name}" needs ${spec.name}.\n\n${spec.description}\n\n'
          'WebDeck will download it from its official release page (${spec.homepage}) '
          'into its own tools folder. You can remove it later in Settings → Tools.',
    );
    if (!ok) throw const RuntimeError('cancelled', 'Installation was cancelled');
    unawaited(tools.install(toolId).catchError((Object e) {
      notifications.post(appId: app.id, appName: app.name, title: 'Could not install ${spec.name}', body: '$e');
    }));
    return {'started': true};
  }

  void dispose() => _http.close();
}

class _Download {
  final String id;
  final String appId;
  final String url;
  final String path;
  int received = 0;
  int? total;
  String status = 'running';
  String? error;
  bool cancelled = false;

  _Download(this.id, this.appId, this.url, this.path);

  Map<String, dynamic> toJson() => {
        'id': id,
        'url': url,
        'path': path,
        'name': p.basename(path),
        'received': received,
        'total': total,
        'status': status,
        'error': error,
      };
}
