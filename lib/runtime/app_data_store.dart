import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:path/path.dart' as p;

/// Per-app storage backing `webdeck.db` (document collections) and `webdeck.kv`.
///
/// Every app gets its own folder under `<WebDeck>/appdata/<appId>/`, so apps never
/// need a database server. Collections are JSON files written atomically.
class AppDataStore {
  final Future<Directory> Function() _baseDir;

  AppDataStore(this._baseDir);

  // Futures (not values) so concurrent first reads share one load instead of
  // racing and overwriting each other's cache.
  final Map<String, Future<List<Map<String, dynamic>>>> _collections = {};
  final Map<String, Future<Map<String, dynamic>>> _kv = {};
  final Map<String, Future<void>> _locks = {};
  final _random = Random.secure();

  Future<Directory> appDir(String appId) async {
    final base = await _baseDir();
    final dir = Directory(p.join(base.path, 'appdata', _safe(appId)));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  Future<Directory> tempDir(String appId) async {
    final dir = Directory(p.join((await appDir(appId)).path, 'tmp'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// Deletes everything an app stored (used on uninstall).
  Future<void> deleteAppData(String appId) async {
    _collections.removeWhere((k, _) => k.startsWith('${_safe(appId)}/'));
    _kv.remove(_safe(appId));
    final base = await _baseDir();
    final dir = Directory(p.join(base.path, 'appdata', _safe(appId)));
    if (await dir.exists()) await dir.delete(recursive: true);
  }

  Future<int> sizeBytes(String appId) async {
    final dir = await appDir(appId);
    var total = 0;
    await for (final e in dir.list(recursive: true)) {
      if (e is File) total += await e.length();
    }
    return total;
  }

  // ---------------------------------------------------------------- collections

  Future<List<String>> collections(String appId) async {
    final dir = Directory(p.join((await appDir(appId)).path, 'db'));
    if (!await dir.exists()) return [];
    return dir
        .list()
        .where((e) => e is File && e.path.endsWith('.json'))
        .map((e) => p.basenameWithoutExtension(e.path))
        .toList();
  }

  Future<List<Map<String, dynamic>>> find(
    String appId,
    String collection, {
    Map<String, dynamic>? where,
    String? sort,
    int? limit,
    int skip = 0,
  }) async {
    final docs = await _load(appId, collection);
    var result = docs.where((d) => matches(d, where)).toList();
    if (sort != null && sort.isNotEmpty) {
      final desc = sort.startsWith('-');
      final field = desc ? sort.substring(1) : sort;
      result.sort((a, b) {
        final c = _compare(a[field], b[field]);
        return desc ? -c : c;
      });
    }
    if (skip > 0) result = result.skip(skip).toList();
    if (limit != null && limit >= 0) result = result.take(limit).toList();
    return result.map(_copy).toList();
  }

  Future<Map<String, dynamic>?> get(String appId, String collection, String id) async {
    final docs = await _load(appId, collection);
    for (final d in docs) {
      if (d['_id'] == id) return _copy(d);
    }
    return null;
  }

  Future<Map<String, dynamic>> insert(
    String appId,
    String collection,
    Map<String, dynamic> doc,
  ) {
    return _write(appId, collection, (docs) {
      final now = DateTime.now().toUtc().toIso8601String();
      final id = (doc['_id'] as String?) ?? _newId();
      if (docs.any((d) => d['_id'] == id)) {
        throw StateError('Document "$id" already exists in "$collection"');
      }
      final stored = {
        ..._copy(doc),
        '_id': id,
        '_createdAt': now,
        '_updatedAt': now,
      };
      docs.add(stored);
      return _copy(stored);
    });
  }

  /// Merges [patch] into the document. Returns null when it doesn't exist.
  Future<Map<String, dynamic>?> update(
    String appId,
    String collection,
    String id,
    Map<String, dynamic> patch,
  ) {
    return _write(appId, collection, (docs) {
      final i = docs.indexWhere((d) => d['_id'] == id);
      if (i < 0) return null;
      final merged = {
        ...docs[i],
        ..._copy(patch)..remove('_id')..remove('_createdAt'),
        '_updatedAt': DateTime.now().toUtc().toIso8601String(),
      };
      docs[i] = merged;
      return _copy(merged);
    });
  }

  Future<bool> remove(String appId, String collection, String id) {
    return _write(appId, collection, (docs) {
      final before = docs.length;
      docs.removeWhere((d) => d['_id'] == id);
      return docs.length != before;
    });
  }

  /// Removes documents matching [where] (all when null). Returns the count removed.
  Future<int> removeWhere(String appId, String collection, Map<String, dynamic>? where) {
    return _write(appId, collection, (docs) {
      final before = docs.length;
      docs.removeWhere((d) => matches(d, where));
      return before - docs.length;
    });
  }

  // ------------------------------------------------------------------------ kv

  Future<Map<String, dynamic>> kvAll(String appId) async => _copy(await _loadKv(appId));

  Future<dynamic> kvGet(String appId, String key) async => _clone((await _loadKv(appId))[key]);

  Future<void> kvSet(String appId, String key, dynamic value) {
    return _locked('${_safe(appId)}/__kv', () async {
      final kv = await _loadKv(appId);
      if (value == null) {
        kv.remove(key);
      } else {
        kv[key] = _clone(value);
      }
      await _atomicWrite(File(p.join((await appDir(appId)).path, 'kv.json')), kv);
    });
  }

  // ----------------------------------------------------------------- filtering

  /// Mongo-style subset: equality plus $gt/$gte/$lt/$lte/$ne/$in/$contains.
  static bool matches(Map<String, dynamic> doc, Map<String, dynamic>? where) {
    if (where == null || where.isEmpty) return true;
    for (final entry in where.entries) {
      final value = doc[entry.key];
      final cond = entry.value;
      if (cond is Map && cond.keys.every((k) => k is String && k.startsWith(r'$'))) {
        for (final op in cond.entries) {
          final arg = op.value;
          final ok = switch (op.key) {
            r'$gt' => _compare(value, arg) > 0 && value != null,
            r'$gte' => _compare(value, arg) >= 0 && value != null,
            r'$lt' => _compare(value, arg) < 0 && value != null,
            r'$lte' => _compare(value, arg) <= 0 && value != null,
            r'$ne' => !_deepEquals(value, arg),
            r'$in' => arg is List && arg.any((a) => _deepEquals(a, value)),
            r'$contains' => value is String
                ? arg is String && value.toLowerCase().contains(arg.toLowerCase())
                : value is List && value.any((v) => _deepEquals(v, arg)),
            _ => throw FormatException('Unsupported operator ${op.key}'),
          };
          if (!ok) return false;
        }
      } else if (!_deepEquals(value, cond)) {
        return false;
      }
    }
    return true;
  }

  static int _compare(dynamic a, dynamic b) {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (a is num && b is num) return a.compareTo(b);
    return a.toString().compareTo(b.toString());
  }

  static bool _deepEquals(dynamic a, dynamic b) => jsonEncode(a) == jsonEncode(b);

  // ------------------------------------------------------------------ plumbing

  Future<List<Map<String, dynamic>>> _load(String appId, String collection) {
    final key = '${_safe(appId)}/${_safeCollection(collection)}';
    return _collections[key] ??= _readCollection(appId, collection).catchError((Object e) {
      _collections.remove(key);
      throw e;
    });
  }

  Future<List<Map<String, dynamic>>> _readCollection(String appId, String collection) async {
    final file = await _collectionFile(appId, collection);
    if (!await file.exists()) return <Map<String, dynamic>>[];
    try {
      return (jsonDecode(await file.readAsString()) as List).cast<Map<String, dynamic>>();
    } catch (_) {
      // Keep the unreadable file for inspection instead of silently overwriting it.
      await file.rename('${file.path}.corrupt-${DateTime.now().millisecondsSinceEpoch}');
      return <Map<String, dynamic>>[];
    }
  }

  Future<Map<String, dynamic>> _loadKv(String appId) {
    return _kv[_safe(appId)] ??= () async {
      final file = File(p.join((await appDir(appId)).path, 'kv.json'));
      if (await file.exists()) {
        try {
          return jsonDecode(await file.readAsString()) as Map<String, dynamic>;
        } catch (_) {}
      }
      return <String, dynamic>{};
    }();
  }

  Future<T> _write<T>(
    String appId,
    String collection,
    T Function(List<Map<String, dynamic>> docs) mutate,
  ) {
    final key = '${_safe(appId)}/${_safeCollection(collection)}';
    return _locked(key, () async {
      final docs = await _load(appId, collection);
      final result = mutate(docs);
      await _atomicWrite(await _collectionFile(appId, collection), docs);
      return result;
    });
  }

  /// Serializes writes per key so concurrent API calls can't interleave.
  Future<T> _locked<T>(String key, Future<T> Function() action) {
    final previous = _locks[key] ?? Future.value();
    final completer = Completer<void>();
    _locks[key] = completer.future;
    return previous.then((_) => action()).whenComplete(() {
      completer.complete();
      if (identical(_locks[key], completer.future)) _locks.remove(key);
    });
  }

  Future<File> _collectionFile(String appId, String collection) async {
    final dir = Directory(p.join((await appDir(appId)).path, 'db'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return File(p.join(dir.path, '${_safeCollection(collection)}.json'));
  }

  static Future<void> _atomicWrite(File file, Object data) async {
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode(data), flush: true);
    await tmp.rename(file.path);
  }

  String _newId() {
    final bytes = List<int>.generate(9, (_) => _random.nextInt(256));
    return base64Url.encode(bytes);
  }

  static String _safe(String id) => id.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_-]'), '_');

  static String _safeCollection(String name) {
    if (!RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(name)) {
      throw FormatException('Invalid collection name "$name"');
    }
    return name;
  }

  static Map<String, dynamic> _copy(Map<String, dynamic> m) =>
      jsonDecode(jsonEncode(m)) as Map<String, dynamic>;

  static dynamic _clone(dynamic v) => v == null ? null : jsonDecode(jsonEncode(v));
}
