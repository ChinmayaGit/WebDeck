import 'dart:convert';
import 'dart:io';

import '../db_engine.dart';
import '../db_models.dart';

class SqliteEngine extends DbEngine {
  SqliteEngine(this._info);
  final DbConnectionInfo _info;
  String? _bin;

  @override
  DbConnectionInfo get info => _info;

  String get _path {
    final p = _info.filePath;
    if (p == null || p.isEmpty) {
      throw const DbEngineException('SQLite file path is missing.');
    }
    return p;
  }

  @override
  Future<void> open() async {
    _bin = await _findSqlite3();
    if (_bin == null) {
      throw const DbEngineException(
        'sqlite3 CLI not found. Install SQLite (e.g. brew install sqlite).',
      );
    }
    final file = File(_path);
    if (!await file.exists()) {
      await file.parent.create(recursive: true);
      await _exec('CREATE TABLE IF NOT EXISTS _webdeck_meta (k TEXT PRIMARY KEY, v TEXT);');
    }
  }

  @override
  Future<void> close() async {}

  @override
  Future<List<DbCollection>> listCollections() async {
    final out = await _exec(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_webdeck_%' ORDER BY name;",
      header: false,
    );
    return out
        .split('\n')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .map((n) => DbCollection(name: n))
        .toList();
  }

  @override
  Future<List<DbColumn>> describe(String collection) async {
    final safe = _ident(collection);
    final out = await _exec('PRAGMA table_info($safe);', header: true, csv: true);
    final lines = _nonEmptyLines(out);
    if (lines.length < 2) return [];
    final cols = <DbColumn>[];
    for (final line in lines.skip(1)) {
      final parts = _parseCsv(line);
      // cid,name,type,notnull,dflt_value,pk
      if (parts.length < 6) continue;
      cols.add(DbColumn(
        name: parts[1],
        type: parts[2].isEmpty ? 'TEXT' : parts[2],
        nullable: parts[3] != '1',
        primaryKey: parts[5] == '1',
      ));
    }
    return cols;
  }

  @override
  Future<DbQueryResult> runQuery(String query) async {
    final q = query.trim();
    if (q.isEmpty) return DbQueryResult.message('Empty query');
    final isMutation = RegExp(
      r'^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|REPLACE|TRUNCATE)\b',
      caseSensitive: false,
    ).hasMatch(q);
    if (isMutation) {
      await _exec(q, header: false);
      return DbQueryResult.message('OK — statement executed.', isMutation: true);
    }
    final out = await _exec(q, header: true, csv: true);
    return _csvToResult(out);
  }

  @override
  Future<DbQueryResult> browse(String collection, {int limit = 200}) async {
    final safe = _ident(collection);
    final out = await _exec(
      'SELECT * FROM $safe LIMIT $limit;',
      header: true,
      csv: true,
    );
    return _csvToResult(out);
  }

  @override
  Future<void> insertRow(String collection, Map<String, dynamic> values) async {
    if (values.isEmpty) throw const DbEngineException('Nothing to insert.');
    final cols = values.keys.map(_ident).join(', ');
    final vals = values.values.map(_literal).join(', ');
    await _exec('INSERT INTO ${_ident(collection)} ($cols) VALUES ($vals);');
  }

  @override
  Future<void> updateRow(
    String collection,
    Map<String, dynamic> key,
    Map<String, dynamic> values,
  ) async {
    if (key.isEmpty) throw const DbEngineException('Missing primary key for update.');
    if (values.isEmpty) return;
    final sets = values.entries.map((e) => '${_ident(e.key)} = ${_literal(e.value)}').join(', ');
    final where = key.entries.map((e) => '${_ident(e.key)} = ${_literal(e.value)}').join(' AND ');
    await _exec('UPDATE ${_ident(collection)} SET $sets WHERE $where;');
  }

  @override
  Future<void> deleteRow(String collection, Map<String, dynamic> key) async {
    if (key.isEmpty) throw const DbEngineException('Missing primary key for delete.');
    final where = key.entries.map((e) => '${_ident(e.key)} = ${_literal(e.value)}').join(' AND ');
    await _exec('DELETE FROM ${_ident(collection)} WHERE $where;');
  }

  Future<String> _exec(String sql, {bool header = false, bool csv = false}) async {
    final bin = _bin ?? await _findSqlite3();
    if (bin == null) {
      throw const DbEngineException('sqlite3 not available');
    }
    final args = <String>[_path];
    if (header) args.add('-header');
    if (csv) args.add('-csv');
    args.add(sql);
    final result = await Process.run(bin, args);
    if (result.exitCode != 0) {
      final err = result.stderr.toString().trim();
      throw DbEngineException(err.isEmpty ? 'SQLite error (code ${result.exitCode})' : err);
    }
    return result.stdout.toString();
  }

  DbQueryResult _csvToResult(String out) {
    final lines = _nonEmptyLines(out);
    if (lines.isEmpty) {
      return const DbQueryResult(columns: [], rows: []);
    }
    final columns = _parseCsv(lines.first);
    final rows = <Map<String, dynamic>>[];
    for (final line in lines.skip(1)) {
      final cells = _parseCsv(line);
      final map = <String, dynamic>{};
      for (var i = 0; i < columns.length; i++) {
        map[columns[i]] = i < cells.length ? cells[i] : '';
      }
      rows.add(map);
    }
    return DbQueryResult(columns: columns, rows: rows);
  }

  List<String> _nonEmptyLines(String out) => const LineSplitter()
      .convert(out)
      .where((l) => l.isNotEmpty)
      .toList();

  String _ident(String name) => '"${name.replaceAll('"', '""')}"';

  String _literal(dynamic value) {
    if (value == null) return 'NULL';
    if (value is num || value is bool) return value.toString();
    final s = value.toString().replaceAll("'", "''");
    return "'$s'";
  }

  List<String> _parseCsv(String line) {
    final result = <String>[];
    final buf = StringBuffer();
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      final ch = line[i];
      if (ch == '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
          buf.write('"');
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch == ',' && !inQuotes) {
        result.add(buf.toString());
        buf.clear();
      } else {
        buf.write(ch);
      }
    }
    result.add(buf.toString());
    return result;
  }

  Future<String?> _findSqlite3() async {
    for (final bin in [
      '/opt/homebrew/bin/sqlite3',
      '/usr/local/bin/sqlite3',
      '/usr/bin/sqlite3',
      'sqlite3',
    ]) {
      try {
        final r = await Process.run(bin, ['--version']);
        if (r.exitCode == 0) return bin;
      } catch (_) {}
    }
    return null;
  }
}
