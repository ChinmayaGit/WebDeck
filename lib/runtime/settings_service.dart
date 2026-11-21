import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

/// User-level WebDeck settings persisted to `<WebDeck>/settings.json`.
class SettingsService extends ChangeNotifier {
  final Future<Directory> Function() _baseDir;

  SettingsService(this._baseDir);

  bool _developerMode = false;
  bool _backgroundJobs = true;
  bool _systemNotifications = true;
  bool _showFeeds = true;
  List<String> _catalogUrls = const [];
  String _storeView = 'grid';
  bool _storeSqueeze = false;
  Map<String, dynamic> _ui = {};
  bool _loaded = false;

  /// Remembered UI state (filters, views) so screens reopen the way they were left.
  T? ui<T>(String key) {
    final v = _ui[key];
    return v is T ? v : null;
  }

  Future<void> setUi(String key, Object? value) async {
    if (_ui[key] == value) return;
    if (value == null) {
      _ui.remove(key);
    } else {
      _ui[key] = value;
    }
    await _save();
  }

  /// Store layout: 'grid', 'list' or 'icons'.
  String get storeView => _storeView;

  /// Wrap store rows onto new lines instead of scrolling sideways.
  bool get storeSqueeze => _storeSqueeze;

  /// Shows sideloading (GitHub / zip / folder installs) and backend tooling.
  bool get developerMode => _developerMode;
  bool get backgroundJobs => _backgroundJobs;
  bool get systemNotifications => _systemNotifications;
  bool get showFeeds => _showFeeds;

  /// Extra remote store catalogs (JSON) merged with the built-in catalog.
  List<String> get catalogUrls => List.unmodifiable(_catalogUrls);
  bool get isLoaded => _loaded;

  Future<File> _file() async => File(p.join((await _baseDir()).path, 'settings.json'));

  Future<void> load() async {
    try {
      final file = await _file();
      if (await file.exists()) {
        final json = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
        _developerMode = json['developerMode'] as bool? ?? false;
        _backgroundJobs = json['backgroundJobs'] as bool? ?? true;
        _systemNotifications = json['systemNotifications'] as bool? ?? true;
        _showFeeds = json['showFeeds'] as bool? ?? true;
        _catalogUrls = (json['catalogUrls'] as List?)?.cast<String>() ?? const [];
        _storeView = json['storeView'] as String? ?? 'grid';
        _storeSqueeze = json['storeSqueeze'] as bool? ?? false;
        _ui = (json['ui'] as Map?)?.cast<String, dynamic>() ?? {};
      }
    } catch (_) {
      // Fall back to defaults on a corrupt file.
    }
    _loaded = true;
    notifyListeners();
  }

  Future<void> _save() async {
    final file = await _file();
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert({
        'developerMode': _developerMode,
        'backgroundJobs': _backgroundJobs,
        'systemNotifications': _systemNotifications,
        'showFeeds': _showFeeds,
        'catalogUrls': _catalogUrls,
        'storeView': _storeView,
        'storeSqueeze': _storeSqueeze,
        'ui': _ui,
      }),
      flush: true,
    );
    notifyListeners();
  }

  Future<void> setShowFeeds(bool val) async {
    _showFeeds = val;
    await _save();
  }

  Future<void> setStoreView(String v) async {
    _storeView = v;
    await _save();
  }

  Future<void> setStoreSqueeze(bool v) async {
    _storeSqueeze = v;
    await _save();
  }

  Future<void> setDeveloperMode(bool v) async {
    _developerMode = v;
    await _save();
  }

  Future<void> setBackgroundJobs(bool v) async {
    _backgroundJobs = v;
    await _save();
  }

  Future<void> setSystemNotifications(bool v) async {
    _systemNotifications = v;
    await _save();
  }

  Future<void> addCatalogUrl(String url) async {
    final trimmed = url.trim();
    final uri = Uri.tryParse(trimmed);
    if (uri == null || !(uri.scheme == 'https' || uri.scheme == 'http') || uri.host.isEmpty) {
      throw const FormatException('Enter a full http(s) URL to a catalog JSON file');
    }
    if (_catalogUrls.contains(trimmed)) return;
    _catalogUrls = [..._catalogUrls, trimmed];
    await _save();
  }

  Future<void> removeCatalogUrl(String url) async {
    _catalogUrls = _catalogUrls.where((u) => u != url).toList();
    await _save();
  }
}
