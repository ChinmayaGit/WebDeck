import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'notification_service.dart';

/// Public project settings. The publishable key is safe to ship: every table is
/// protected by Row Level Security (see supabase/migrations).
class CloudConfig {
  static const url = 'https://fltaammdosfyzblrbtqc.supabase.co';
  static const publishableKey = 'sb_publishable_T-5oFRFRfjlgSwoIumpxOw_CCVz2OsV';
}

class CloudException implements Exception {
  final String code;
  final String message;
  const CloudException(this.code, this.message);
  @override
  String toString() => message;
}

class CloudMessage {
  final String id;
  final String fromUser;
  final String app;
  final String channel;
  final Map<String, dynamic> payload;
  final DateTime at;

  CloudMessage({required this.id, required this.fromUser, required this.app, required this.channel, required this.payload, required this.at});

  Map<String, dynamic> toJson() => {
        'id': id,
        'from': fromUser,
        'channel': channel,
        'payload': payload,
        'at': at.toIso8601String(),
      };
}

/// WebDeck Cloud: an anonymous account per device, a unique caller number,
/// online presence and instant signaling between users over the internet.
class CloudService extends ChangeNotifier {
  final NotificationService _notifications;

  CloudService(this._notifications);

  static const _maxInbox = 500;
  static const _heartbeatEvery = Duration(seconds: 30);

  SupabaseClient? _client;
  RealtimeChannel? _channel;
  Timer? _heartbeat;
  Future<void>? _starting;
  final List<CloudMessage> _inbox = [];

  Map<String, dynamic>? profile;
  String? lastError;
  bool get ready => _client?.auth.currentUser != null;
  String? get userId => _client?.auth.currentUser?.id;

  /// Signed in with a real (email) account, not anonymously.
  bool get hasAccount {
    final u = _client?.auth.currentUser;
    return u != null && !u.isAnonymous;
  }

  String? get email => _client?.auth.currentUser?.email;

  Future<void>? _initializing;
  StreamSubscription<AuthState>? _authSub;
  String? _setUpFor; // user id the profile/subscription were loaded for

  /// Loads Supabase and any saved session, without signing in. Fast; used by
  /// the login gate to decide whether to show the login page.
  Future<void> init() => _initializing ??= () async {
        try {
          _client = Supabase.instance.client;
        } catch (_) {
          await Supabase.initialize(url: CloudConfig.url, publishableKey: CloudConfig.publishableKey);
          _client = Supabase.instance.client;
        }
        _authSub ??= _client!.auth.onAuthStateChange.listen((state) {
          // Another account signed in (or out): reload everything for that user.
          final id = state.session?.user.id;
          if (id != null && id != _setUpFor) unawaited(_setUpUser());
          notifyListeners();
        });
      }().catchError((Object e) {
        _initializing = null;
        throw e;
      });

  /// Connects and makes sure there is a session (anonymous if needed). Safe to call repeatedly.
  Future<void> start() => _starting ??= _start().whenComplete(() {
        if (!ready) _starting = null; // allow retry after a failure
      });

  Future<void> _start() async {
    lastError = null;
    try {
      await init();
      final auth = _client!.auth;
      if (auth.currentUser == null) {
        await auth.signInAnonymously();
      }
      await _setUpUser();
    } on AuthException catch (e) {
      lastError = e.message.contains('Anonymous')
          ? 'Cloud sign-in is turned off for this project (enable anonymous sign-ins in Supabase).'
          : 'Cloud sign-in failed: ${e.message}';
    } catch (e) {
      lastError = 'Cloud is unreachable: $e';
    }
    notifyListeners();
  }

  Future<void> _setUpUser() async {
    final id = _client?.auth.currentUser?.id;
    if (id == null) return;
    _setUpFor = id;
    profile = null;
    await _loadProfile();
    _subscribe();
    await _fetchPending();
    _heartbeat?.cancel();
    _heartbeat = Timer.periodic(_heartbeatEvery, (_) => _touch());
    unawaited(_touch());
    notifyListeners();
  }

  // ------------------------------------------------------------- accounts

  /// Signs in to an existing account.
  Future<void> signIn(String email, String password) async {
    await init();
    await _client!.auth.signInWithPassword(email: email.trim(), password: password);
    _starting = Future.value();
    await _setUpUser();
  }

  /// Creates an account. When the device is signed in anonymously, the anonymous
  /// account is upgraded in place so its number and data carry over.
  /// Returns true when the account is ready, false when the email must be confirmed first.
  Future<bool> signUp(String email, String password) async {
    await init();
    final auth = _client!.auth;
    final current = auth.currentUser;
    if (current != null && current.isAnonymous) {
      final res = await auth.updateUser(UserAttributes(email: email.trim(), password: password));
      final upgraded = res.user != null && !res.user!.isAnonymous && res.user!.email == email.trim();
      notifyListeners();
      return upgraded;
    }
    final res = await auth.signUp(email: email.trim(), password: password);
    if (res.session == null) return false; // confirmation email sent
    _starting = Future.value();
    await _setUpUser();
    return true;
  }

  Future<void> resetPassword(String email) async {
    await init();
    await _client!.auth.resetPasswordForEmail(email.trim());
  }

  /// Signs out of the account; the device continues anonymously.
  Future<void> signOut() async {
    await init();
    await _client!.auth.signOut();
    profile = null;
    _setUpFor = null;
    _starting = null;
    notifyListeners();
    await start();
  }

  SupabaseClient _require() {
    final c = _client;
    if (c == null || c.auth.currentUser == null) {
      throw CloudException('cloud_offline', lastError ?? 'WebDeck Cloud is not connected');
    }
    return c;
  }

  Map<String, dynamic> status() => {
        'connected': ready,
        'userId': userId,
        'profile': profile,
        'error': lastError,
      };

  // ----------------------------------------------------------------- profile

  static String numberKey(String n) => n.replaceAll(RegExp(r'[^0-9]'), '');

  Future<void> _loadProfile() async {
    final c = _require();
    profile = await c.from('profiles').select().eq('user_id', c.auth.currentUser!.id).maybeSingle();
  }

  Future<bool> numberAvailable(String number) async {
    final key = numberKey(number);
    if (key.length < 4 || key.length > 20) return false;
    final c = _require();
    return await c.rpc('number_available', params: {'p_number': number}) == true;
  }

  /// Claims [number] for this device. Throws `number_taken` when someone else has it.
  Future<Map<String, dynamic>> setProfile({required String name, required String number}) async {
    final c = _require();
    final key = numberKey(number);
    if (key.length < 4 || key.length > 20) {
      throw const CloudException('bad_request', 'A number needs 4 to 20 digits');
    }
    try {
      final row = await c
          .from('profiles')
          .upsert({
            'user_id': c.auth.currentUser!.id,
            'number': number.trim(),
            'number_key': key,
            'name': name.trim().isEmpty ? 'WebDeck' : name.trim().substring(0, name.trim().length.clamp(0, 60)),
            'platform': Platform.operatingSystem,
            'last_seen': DateTime.now().toUtc().toIso8601String(),
          })
          .select()
          .single();
      profile = row;
      notifyListeners();
      return row;
    } on PostgrestException catch (e) {
      if (e.code == '23505') {
        throw const CloudException('number_taken', 'That number is already taken');
      }
      rethrow;
    }
  }

  Future<void> _touch() async {
    final c = _client;
    if (c == null || profile == null || c.auth.currentUser == null) return;
    try {
      await c.from('profiles').update({'last_seen': DateTime.now().toUtc().toIso8601String()}).eq('user_id', c.auth.currentUser!.id);
    } catch (_) {}
  }

  /// Finds another user by exact number (no directory listing is possible).
  Future<Map<String, dynamic>?> lookup(String number) async {
    final c = _require();
    final rows = await c.rpc('lookup_number', params: {'p_number': number}) as List;
    return rows.isEmpty ? null : (rows.first as Map).cast<String, dynamic>();
  }

  // ------------------------------------------------------------- ICE / TURN

  Map<String, dynamic>? _ice;
  DateTime? _iceExpires;

  /// STUN/TURN servers for WebRTC. TURN credentials come from the
  /// `turn-credentials` Edge Function and are cached until shortly before expiry.
  Future<Map<String, dynamic>> iceServers() async {
    if (_ice != null && _iceExpires != null && DateTime.now().isBefore(_iceExpires!)) return _ice!;
    final c = _require();
    final res = await c.functions.invoke('turn-credentials');
    final data = (res.data as Map).cast<String, dynamic>();
    _ice = data;
    final ttl = (data['ttl'] as num?)?.toInt() ?? 0;
    _iceExpires = DateTime.now().add(Duration(seconds: data['relay'] == true ? (ttl - 600).clamp(60, 86400) : 300));
    return data;
  }

  // ----------------------------------------------------- community store

  static const _bucket = 'submissions';

  /// Uploads an extension zip for review. It is listed only after the owner
  /// approves it in the Supabase dashboard.
  Future<Map<String, dynamic>> submitExtension({
    required Uint8List zip,
    required Map<String, dynamic> manifest,
  }) async {
    final c = _require();
    final id = manifest['id'] as String;
    final version = manifest['version'] as String;
    final path = '${c.auth.currentUser!.id}/$id-$version-${DateTime.now().millisecondsSinceEpoch}.zip';
    await c.storage.from(_bucket).uploadBinary(
          path,
          zip,
          fileOptions: const FileOptions(contentType: 'application/zip', upsert: false),
        );
    try {
      return await c
          .from('store_submissions')
          .insert({
            'app_id': id,
            'name': manifest['name'],
            'version': version,
            'manifest': manifest,
            'file_path': path,
            'sha256': sha256.convert(zip).toString(),
            'size_bytes': zip.length,
          })
          .select()
          .single();
    } on PostgrestException catch (e) {
      throw CloudException(e.code == '23505' ? 'id_taken' : 'submit_failed', e.message);
    }
  }

  Future<List<Map<String, dynamic>>> mySubmissions() async {
    final c = _require();
    final rows = await c.from('store_submissions').select().order('created_at', ascending: false).limit(50);
    return rows.cast<Map<String, dynamic>>();
  }

  /// Approved community extensions (newest version of each).
  Future<List<Map<String, dynamic>>> communityListings() async {
    final c = _require();
    final rows = await c.rpc('community_listings') as List;
    return rows.cast<Map>().map((r) => r.cast<String, dynamic>()).toList();
  }

  Future<Uint8List> downloadSubmission(String path) => _require().storage.from(_bucket).download(path);

  // --------------------------------------------------------------- signaling

  Future<void> send({required String toUser, required String app, required String channel, required Map<String, dynamic> payload}) async {
    final c = _require();
    await c.from('signals').insert({'to_user': toUser, 'app': app, 'channel': channel, 'payload': payload});
  }

  List<CloudMessage> inbox({required String app, String? channel, DateTime? since}) => _inbox
      .where((m) => m.app == app && (channel == null || m.channel == channel) && (since == null || m.at.isAfter(since)))
      .toList();

  void _subscribe() {
    final c = _require();
    final me = c.auth.currentUser!.id;
    if (_channel != null) unawaited(c.removeChannel(_channel!));
    _channel = c
        .channel('signals:$me')
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: 'public',
          table: 'signals',
          filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'to_user', value: me),
          callback: (change) => _onRow(change.newRecord),
        )
        .subscribe((status, [error]) {
          // Catch anything sent while we were (re)connecting.
          if (status == RealtimeSubscribeStatus.subscribed) unawaited(_fetchPending());
        });
  }

  Future<void> _fetchPending() async {
    final c = _client;
    if (c == null || c.auth.currentUser == null) return;
    try {
      final rows = await c
          .from('signals')
          .select()
          .eq('to_user', c.auth.currentUser!.id)
          .gt('created_at', DateTime.now().toUtc().subtract(const Duration(minutes: 2)).toIso8601String())
          .order('created_at');
      for (final r in rows) {
        _onRow(r);
      }
    } catch (_) {}
  }

  final Set<String> _seen = {};

  void _onRow(Map<String, dynamic> r) {
    final id = '${r['id']}';
    if (!_seen.add(id)) return;
    if (_seen.length > 2000) _seen.remove(_seen.first);
    final m = CloudMessage(
      id: id,
      fromUser: r['from_user'] as String,
      app: r['app'] as String,
      channel: r['channel'] as String,
      payload: (r['payload'] as Map?)?.cast<String, dynamic>() ?? {},
      // Local receive time keeps `since` filters consistent with the app's clock.
      at: DateTime.now(),
    );
    _inbox.add(m);
    if (_inbox.length > _maxInbox) _inbox.removeRange(0, _inbox.length - _maxInbox);
    // Delivered: remove it from the server.
    unawaited(_client?.from('signals').delete().eq('id', r['id']).then((_) {}, onError: (_) {}));

    if (m.app == 'calls' && m.channel == 'call_signal' && m.payload['type'] == 'invite') {
      final kind = m.payload['isVideo'] == true ? 'video' : 'voice';
      unawaited(_notifications.post(
        appId: 'calls',
        appName: 'Calls',
        title: 'Incoming $kind call',
        body: 'From ${m.payload['callerName'] ?? 'a WebDeck user'}. Open Calls to answer.',
      ));
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _heartbeat?.cancel();
    final ch = _channel;
    if (ch != null) unawaited(_client?.removeChannel(ch));
    super.dispose();
  }
}
