import 'dart:convert';
import 'dart:io';

import '../db_engine.dart';
import '../db_models.dart';

/// Document browser via `mongosh` when installed.
class MongoCliEngine extends DbEngine {
  MongoCliEngine(this._info);
  final DbConnectionInfo _info;
  String? _bin;

  @override
  DbConnectionInfo get info => _info;

  @override
  bool get supportsSqlEditor => false;

  @override
  String get queryHelp =>
      'MongoDB: leave empty for find({}), or enter a filter JSON e.g. {"active":true}';

  String get _uri =>
      _info.connectionString ?? 'mongodb://127.0.0.1:27017';

  @override
  Future<void> open() async {
    _bin = await _findMongosh();
    if (_bin == null) {
      throw const DbEngineException(
        'mongosh not found. Install MongoDB Shell to browse document collections.',
      );
    }
  }

  @override
  Future<void> close() async {}

  @override
  Future<List<DbCollection>> listCollections() async {
    final out = await _eval('db.getCollectionNames()');
    final decoded = jsonDecode(out);
    if (decoded is! List) return [];
    return decoded.map((e) => DbCollection(name: '$e')).toList();
  }

  @override
  Future<List<DbColumn>> describe(String collection) async {
    final result = await browse(collection, limit: 1);
    if (result.rows.isEmpty) {
      return const [DbColumn(name: '_id', type: 'ObjectId', primaryKey: true)];
    }
    return result.columns
        .map((c) => DbColumn(name: c, primaryKey: c == '_id'))
        .toList();
  }

  @override
  Future<DbQueryResult> runQuery(String query) async {
    final q = query.trim();
    if (q.isEmpty) {
      final cols = await listCollections();
      if (cols.isEmpty) return DbQueryResult.message('No collections');
      return browse(cols.first.name);
    }
    // If looks like filter JSON for current context — handled by browse with filter
    if (q.startsWith('{')) {
      final cols = await listCollections();
      if (cols.isEmpty) return DbQueryResult.message('No collections');
      return _find(cols.first.name, q);
    }
    final out = await _eval(q);
    try {
      final decoded = jsonDecode(out);
      return _docsToResult(decoded is List ? decoded : [decoded]);
    } catch (_) {
      return DbQueryResult.message(out.trim());
    }
  }

  @override
  Future<DbQueryResult> browse(String collection, {int limit = 200}) {
    return _find(collection, '{}', limit: limit);
  }

  Future<DbQueryResult> _find(String collection, String filter, {int limit = 200}) async {
    final safe = collection.replaceAll("'", r"\'");
    final out = await _eval(
      'JSON.stringify(db.getCollection("$safe").find($filter).limit($limit).toArray())',
    );
    final decoded = jsonDecode(out);
    if (decoded is! List) {
      return DbQueryResult.message(out);
    }
    return _docsToResult(decoded);
  }

  @override
  Future<void> insertRow(String collection, Map<String, dynamic> values) async {
    final safe = collection.replaceAll("'", r"\'");
    final json = jsonEncode(values);
    await _eval('db.getCollection("$safe").insertOne($json)');
  }

  @override
  Future<void> updateRow(
    String collection,
    Map<String, dynamic> key,
    Map<String, dynamic> values,
  ) async {
    final safe = collection.replaceAll("'", r"\'");
    final filter = jsonEncode(key);
    final set = jsonEncode({r'$set': values});
    await _eval('db.getCollection("$safe").updateOne($filter, $set)');
  }

  @override
  Future<void> deleteRow(String collection, Map<String, dynamic> key) async {
    final safe = collection.replaceAll("'", r"\'");
    final filter = jsonEncode(key);
    await _eval('db.getCollection("$safe").deleteOne($filter)');
  }

  DbQueryResult _docsToResult(List<dynamic> docs) {
    final rows = <Map<String, dynamic>>[];
    final columns = <String>{};
    for (final doc in docs) {
      if (doc is! Map) continue;
      final flat = <String, dynamic>{};
      for (final e in doc.entries) {
        final v = e.value;
        flat[e.key.toString()] =
            v is Map || v is List ? jsonEncode(v) : v;
      }
      columns.addAll(flat.keys);
      rows.add(flat);
    }
    final cols = columns.toList();
    if (cols.contains('_id')) {
      cols.remove('_id');
      cols.insert(0, '_id');
    }
    return DbQueryResult(
      columns: cols,
      rows: rows.map((r) => {for (final c in cols) c: r[c]}).toList(),
    );
  }

  Future<String> _eval(String js) async {
    final bin = _bin ?? await _findMongosh();
    if (bin == null) throw const DbEngineException('mongosh missing');
    final result = await Process.run(bin, [
      _uri,
      '--quiet',
      '--eval',
      js,
    ]);
    if (result.exitCode != 0) {
      throw DbEngineException(
        '${result.stderr}'.trim().isEmpty
            ? 'mongosh failed (${result.exitCode})'
            : '${result.stderr}'.trim(),
      );
    }
    return result.stdout.toString();
  }

  Future<String?> _findMongosh() async {
    for (final bin in [
      '/opt/homebrew/bin/mongosh',
      '/usr/local/bin/mongosh',
      'mongosh',
    ]) {
      try {
        final r = await Process.run(bin, ['--version']);
        if (r.exitCode == 0) return bin;
      } catch (_) {}
    }
    return null;
  }
}
