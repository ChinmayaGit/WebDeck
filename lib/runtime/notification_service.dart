import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

import 'settings_service.dart';

class AppNotification {
  final String id;
  final String appId;
  final String appName;
  final String title;
  final String body;
  final String? url;
  final DateTime at;
  final bool read;

  const AppNotification({
    required this.id,
    required this.appId,
    required this.appName,
    required this.title,
    required this.body,
    this.url,
    required this.at,
    this.read = false,
  });

  AppNotification markRead() => AppNotification(
        id: id,
        appId: appId,
        appName: appName,
        title: title,
        body: body,
        url: url,
        at: at,
        read: true,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'appId': appId,
        'appName': appName,
        'title': title,
        'body': body,
        'url': url,
        'at': at.toIso8601String(),
        'read': read,
      };

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['id'] as String,
        appId: j['appId'] as String,
        appName: j['appName'] as String? ?? j['appId'] as String,
        title: j['title'] as String? ?? '',
        body: j['body'] as String? ?? '',
        url: j['url'] as String?,
        at: DateTime.tryParse(j['at'] as String? ?? '') ?? DateTime.now(),
        read: j['read'] as bool? ?? false,
      );
}

/// In-app notification inbox plus best-effort OS notifications on desktop.
class NotificationService extends ChangeNotifier {
  final Future<Directory> Function() _baseDir;
  final SettingsService _settings;

  NotificationService(this._baseDir, this._settings);

  static const _maxItems = 200;
  List<AppNotification> _items = [];

  List<AppNotification> get items => List.unmodifiable(_items);
  int get unreadCount => _items.where((n) => !n.read).length;

  Future<File> _file() async => File(p.join((await _baseDir()).path, 'notifications.json'));

  Future<void> load() async {
    try {
      final file = await _file();
      if (await file.exists()) {
        _items = (jsonDecode(await file.readAsString()) as List)
            .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
            .toList();
      }
    } catch (_) {}
    notifyListeners();
  }

  Future<void> _save() async {
    try {
      await (await _file()).writeAsString(jsonEncode(_items.map((n) => n.toJson()).toList()));
    } catch (_) {}
  }

  Future<AppNotification> post({
    required String appId,
    required String appName,
    required String title,
    String body = '',
    String? url,
  }) async {
    final n = AppNotification(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      appId: appId,
      appName: appName,
      title: _clip(title, 200),
      body: _clip(body, 1000),
      url: url,
      at: DateTime.now(),
    );
    _items = [n, ..._items].take(_maxItems).toList();
    notifyListeners();
    await _save();
    if (_settings.systemNotifications) {
      await _showSystemNotification('${n.appName}: ${n.title}', n.body);
    }
    return n;
  }

  Future<void> markAllRead() async {
    _items = _items.map((n) => n.read ? n : n.markRead()).toList();
    notifyListeners();
    await _save();
  }

  Future<void> clear() async {
    _items = [];
    notifyListeners();
    await _save();
  }

  static String _clip(String s, int max) => s.length <= max ? s : '${s.substring(0, max - 1)}…';

  /// Uses built-in OS tooling so no native plugin is required.
  /// Arguments are passed as argv (never interpolated into a script).
  Future<void> _showSystemNotification(String title, String body) async {
    try {
      if (Platform.isMacOS) {
        await Process.run('osascript', [
          '-e', 'on run argv',
          '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
          '-e', 'end run',
          title,
          body.isEmpty ? ' ' : body,
        ]);
      } else if (Platform.isLinux) {
        await Process.run('notify-send', [title, body]);
      }
      // Windows / mobile: in-app inbox only for now.
    } catch (_) {}
  }
}
