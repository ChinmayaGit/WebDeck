import 'dart:async';
import 'dart:io';

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

  /// Connects and signs in (once). Safe to call repeatedly.
  Future<void> start() => _starting ??= _start().whenComplete(() {
        if (!ready) _starting = null; // allow retry after a failure
      });

  Future<void> _start() async {
    lastError = null;
    try {
      try {
        _client = Supabase.instance.client;
      } catch (_) {
        await Supabase.initialize(url: CloudConfig.url, publishableKey: CloudConfig.publishableKey);
        _client = Supabase.instance.client;
      }
      final auth = _client!.auth;
      if (auth.currentUser == null) {
        await auth.signInAnonymously();
      }
      await _loadProfile();
      _subscribe();
      await _fetchPending();
      _heartbeat?.cancel();
      _heartbeat = Timer.periodic(_heartbeatEvery, (_) => _touch());
      unawaited(_touch());
    } on AuthException catch (e) {
      lastError = e.message.contains('Anonymous')
          ? 'Cloud sign-in is turned off for this project (enable anonymous sign-ins in Supabase).'
          : 'Cloud sign-in failed: ${e.message}';
    } catch (e) {
      lastError = 'Cloud is unreachable: $e';
    }
    notifyListeners();
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
    _heartbeat?.cancel();
    final ch = _channel;
    if (ch != null) unawaited(_client?.removeChannel(ch));
    super.dispose();
  }
}
