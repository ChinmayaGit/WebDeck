// ignore_for_file: prefer_initializing_formals
import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

import '../data/models/installed_app.dart';
import '../data/repositories/app_repository.dart';
import 'app_icons.dart';
import 'manifest.dart';
import 'settings_service.dart';

/// One app listed in the store.
class StoreEntry {
  final WebDeckManifest manifest;
  final String catalog;

  /// Asset folder for apps bundled with WebDeck (works offline).
  final String? assetDir;

  /// Zip download for apps from remote catalogs.
  final String? downloadUrl;
  final String? sha256;
  final bool featured;

  const StoreEntry({
    required this.manifest,
    required this.catalog,
    this.assetDir,
    this.downloadUrl,
    this.sha256,
    this.featured = false,
  });

  String get id => manifest.id;
  bool get bundled => assetDir != null;
}

/// A Store category (order, icon and color come from catalog.json).
class StoreCategory {
  final String name;
  final String icon;
  final String color;
  const StoreCategory(this.name, {this.icon = 'app', this.color = '#388BFD'});

  factory StoreCategory.fromJson(Map<String, dynamic> j) => StoreCategory(
    j['name'] as String,
    icon: j['icon'] as String? ?? 'app',
    color: j['color'] as String? ?? '#388BFD',
  );
}

/// An app announced in the catalog but not available yet ("Coming soon").
class StoreUpcoming {
  final String name;
  final String category;
  final String icon;
  final String color;
  final String description;
  const StoreUpcoming({
    required this.name,
    required this.category,
    required this.icon,
    required this.color,
    required this.description,
  });

  factory StoreUpcoming.fromJson(Map<String, dynamic> j) => StoreUpcoming(
    name: j['name'] as String? ?? '',
    category: j['category'] as String? ?? '',
    icon: j['icon'] as String? ?? 'app',
    color: j['color'] as String? ?? '#64748B',
    description: j['description'] as String? ?? '',
  );
}

/// Loads the built-in catalog (assets/store) plus remote catalogs from Settings,
/// and installs runtime apps from them.
class StoreService extends ChangeNotifier {
  final AppRepository _repository;
  final SettingsService _settings;
  final http.Client _http;
  final AssetBundle _bundle;

  StoreService({
    required AppRepository repository,
    required SettingsService settings,
    http.Client? httpClient,
    AssetBundle? bundle,
  }) : _repository = repository,
       _settings = settings,
       _http = httpClient ?? http.Client(),
       _bundle = bundle ?? rootBundle {
    _settings.addListener(_onSettingsChanged);
  }

  List<StoreEntry> _entries = [];
  final List<StoreCategory> _categoryInfo = [];
  List<StoreUpcoming> _upcoming = const [];

  /// Apps announced as "Coming soon", minus any that have since shipped.
  List<StoreUpcoming> get upcoming => _upcoming
      .where((u) => !_entries.any((e) => e.manifest.name == u.name))
      .toList();
  final Map<String, String> _catalogErrors = {};
  final Set<String> _installing = {};
  bool _loading = false;
  List<String> _lastCatalogUrls = const [];

  List<StoreEntry> get entries => List.unmodifiable(_entries);
  Map<String, String> get catalogErrors => Map.unmodifiable(_catalogErrors);
  bool get loading => _loading;
  bool isInstalling(String id) => _installing.contains(id);

  /// Categories that have apps, in catalog order; unknown ones follow alphabetically.
  List<String> get categories {
    final present = _entries.map((e) => e.manifest.category).toSet();
    final ordered = _categoryInfo
        .map((c) => c.name)
        .where(present.contains)
        .toList();
    final rest = present.difference(ordered.toSet()).toList()..sort();
    return [...ordered, ...rest];
  }

  StoreCategory category(String name) => _categoryInfo.firstWhere(
    (c) => c.name == name,
    orElse: () => StoreCategory(name),
  );

  void _onSettingsChanged() {
    if (!listEquals(_lastCatalogUrls, _settings.catalogUrls)) refresh();
  }

  @override
  void dispose() {
    _settings.removeListener(_onSettingsChanged);
    _http.close();
    super.dispose();
  }

  Future<void> refresh() async {
    _loading = true;
    _lastCatalogUrls = _settings.catalogUrls;
    notifyListeners();
    final entries = <StoreEntry>[];
    _catalogErrors.clear();
    _categoryInfo.clear();
    try {
      entries.addAll(await _loadBundled());
    } catch (e) {
      _catalogErrors['Built-in'] = '$e';
    }
    for (final url in _settings.catalogUrls) {
      try {
        entries.addAll(await _loadRemote(url));
      } catch (e) {
        _catalogErrors[url] = '$e';
      }
    }
    // Later catalogs can't shadow built-in ids.
    final seen = <String>{};
    _entries = entries.where((e) => seen.add(e.id)).toList();
    _loading = false;
    notifyListeners();
  }

  Future<List<StoreEntry>> _loadBundled() async {
    final catalog = jsonDecode(
      await _bundle.loadString('assets/store/catalog.json'),
    ) as Map<String, dynamic>;
    final featured = ((catalog['featured'] as List?) ?? const [])
        .cast<String>()
        .toSet();
    _addCategories(catalog['categories']);
    _upcoming = ((catalog['upcoming'] as List?) ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(StoreUpcoming.fromJson)
        .toList();
    final out = <StoreEntry>[];
    for (final id in (catalog['apps'] as List).cast<String>()) {
      final dir = 'assets/store/$id';
      final manifest = WebDeckManifest.fromJson(
        jsonDecode(await _bundle.loadString('$dir/webdeck.json'))
            as Map<String, dynamic>,
      );
      out.add(
        StoreEntry(
          manifest: manifest,
          catalog: 'WebDeck',
          assetDir: dir,
          featured: featured.contains(id),
        ),
      );
    }
    return out;
  }

  /// Remote catalog format: {"name": "...", "apps": [{...webdeck.json fields, "download": url, "sha256": hex}]}
  Future<List<StoreEntry>> _loadRemote(String url) async {
    final res = await _http
        .get(Uri.parse(url))
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) throw HttpException('HTTP ${res.statusCode}');
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final name = json['name'] as String? ?? Uri.parse(url).host;
    _addCategories(json['categories']);
    final out = <StoreEntry>[];
    for (final raw in (json['apps'] as List).cast<Map<String, dynamic>>()) {
      final download = raw['download'] as String?;
      if (download == null) continue;
      out.add(
        StoreEntry(
          manifest: WebDeckManifest.fromJson(raw),
          catalog: name,
          downloadUrl: Uri.parse(url).resolve(download).toString(),
          sha256: raw['sha256'] as String?,
          featured: raw['featured'] as bool? ?? false,
        ),
      );
    }
    return out;
  }

  void _addCategories(Object? raw) {
    if (raw is! List) return;
    for (final c in raw.whereType<Map<String, dynamic>>()) {
      if (c['name'] is! String) continue;
      if (_categoryInfo.any((x) => x.name == c['name'])) continue;
      _categoryInfo.add(StoreCategory.fromJson(c));
    }
  }

  /// Installs or updates an app. Existing app data (db/kv) is kept on update.
  Future<InstalledApp> install(StoreEntry entry) async {
    if (!entry.manifest.supportsCurrentPlatform) {
      throw UnsupportedError(
        '${entry.manifest.name} is not available on this platform',
      );
    }
    _installing.add(entry.id);
    notifyListeners();
    try {
      final files = entry.bundled
          ? await _bundledFiles(entry)
          : await _downloadFiles(entry);
      for (final r in entry.manifest.resources) {
        files.addAll(await _fetchResource(r));
      }
      final icon = await AppGlyphs.renderPng(
        entry.manifest.icon,
        entry.manifest.color,
      );
      return await _repository.installRuntimeBundle(
        files: files,
        iconPng: icon,
        source: 'store',
      );
    } finally {
      _installing.remove(entry.id);
      notifyListeners();
    }
  }

  Future<Map<String, Uint8List>> _bundledFiles(StoreEntry entry) async {
    final manifest = await AssetManifest.loadFromAssetBundle(_bundle);
    final prefix = '${entry.assetDir}/';
    final files = <String, Uint8List>{};
    for (final key in manifest.listAssets().where(
      (k) => k.startsWith(prefix),
    )) {
      final data = await _bundle.load(key);
      files[key.substring(prefix.length)] = data.buffer.asUint8List(
        data.offsetInBytes,
        data.lengthInBytes,
      );
    }
    if (!files.containsKey(WebDeckManifest.fileName)) {
      throw StateError('Bundled app ${entry.id} is missing webdeck.json');
    }
    return files;
  }

  Future<Map<String, Uint8List>> _downloadFiles(StoreEntry entry) async {
    final res = await _http
        .get(Uri.parse(entry.downloadUrl!))
        .timeout(const Duration(minutes: 5));
    if (res.statusCode != 200) {
      throw HttpException('Download failed: HTTP ${res.statusCode}');
    }
    final bytes = res.bodyBytes;
    final expected = entry.sha256?.toLowerCase();
    if (expected != null && expected.isNotEmpty) {
      final actual = sha256.convert(bytes).toString();
      if (actual != expected) {
        throw StateError('Checksum mismatch for ${entry.manifest.name}');
      }
    }
    return unpackZip(bytes);
  }

  /// Downloads, verifies and unpacks an install-time resource into `target/…`.
  Future<Map<String, Uint8List>> _fetchResource(AppResource r) async {
    final res = await _http
        .get(Uri.parse(r.url))
        .timeout(const Duration(minutes: 5));
    if (res.statusCode != 200) {
      throw HttpException(
        'Could not download ${r.url} (HTTP ${res.statusCode})',
      );
    }
    final bytes = res.bodyBytes;
    if (r.sha256 != null &&
        sha256.convert(bytes).toString() != r.sha256!.toLowerCase()) {
      throw StateError('Checksum mismatch for ${r.url}');
    }
    return unpackResource(r, bytes);
  }

  static Map<String, Uint8List> unpackResource(AppResource r, Uint8List bytes) {
    final name = Uri.parse(r.url).path.toLowerCase();
    final Archive archive;
    if (name.endsWith('.zip')) {
      archive = ZipDecoder().decodeBytes(bytes);
    } else if (name.endsWith('.tgz') || name.endsWith('.tar.gz')) {
      archive = TarDecoder().decodeBytes(GZipDecoder().decodeBytes(bytes));
    } else {
      return {'${r.target}/${p.basename(name)}': bytes};
    }
    final include = r.include != null ? RegExp(r.include!) : null;
    final out = <String, Uint8List>{};
    for (final f in archive) {
      if (!f.isFile) continue;
      final path = f.name.replaceAll('\\', '/');
      if (include != null && !include.hasMatch(path)) continue;
      var rel = r.strip != null && path.startsWith(r.strip!)
          ? path.substring(r.strip!.length)
          : path;
      if (rel.isEmpty || rel.split('/').contains('..')) continue;
      out['${r.target}/$rel'] = Uint8List.fromList(f.content as List<int>);
    }
    if (out.isEmpty) {
      throw StateError('Resource ${r.url} contained no matching files');
    }
    return out;
  }

  /// Unzips a bundle, stripping a single top-level folder if webdeck.json lives inside it.
  static Map<String, Uint8List> unpackZip(Uint8List bytes) {
    final archive = ZipDecoder().decodeBytes(bytes);
    final files = <String, Uint8List>{};
    for (final f in archive) {
      if (!f.isFile) continue;
      final name = f.name.replaceAll('\\', '/');
      if (name.startsWith('__MACOSX/') || p.basename(name) == '.DS_Store') {
        continue;
      }
      files[name] = Uint8List.fromList(f.content as List<int>);
    }
    if (!files.containsKey(WebDeckManifest.fileName)) {
      final nested = files.keys.where(
        (k) =>
            p.basename(k) == WebDeckManifest.fileName &&
            k.split('/').length == 2,
      );
      if (nested.length == 1) {
        final root = '${nested.first.split('/').first}/';
        return {
          for (final e in files.entries)
            if (e.key.startsWith(root)) e.key.substring(root.length): e.value,
        };
      }
      throw StateError('Bundle does not contain webdeck.json');
    }
    return files;
  }
}
