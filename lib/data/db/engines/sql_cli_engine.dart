import 'dart:convert';
import 'dart:io';

import '../db_engine.dart';
import '../db_models.dart';

/// Runs queries through installed CLI tools: sqlcmd / psql / mysql.
class SqlCliEngine extends DbEngine {
  SqlCliEngine(this._info);
  final DbConnectionInfo _info;
  _CliTool? _tool;

  @override
  DbConnectionInfo get info => _info;

  @override
  Future<void> open() async {
    _tool = await _detectTool();
    if (_tool == null) {
      throw DbEngineException(
        'No CLI client found for ${_info.kind.label}. '
        'Install sqlcmd (SQL Server), psql (Postgres), or mysql client, '
        'or use a SQLite / REST-backed app.',
      );
    }
  }

  @override
  Future<void> close() async {}

  @override
  Future<List<DbCollection>> listCollections() async {
    final sql = switch (_info.kind) {
      DbEngineKind.postgres =>
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY 1;",
      DbEngineKind.mysql => 'SHOW TABLES;',
      _ =>
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY 1;",
    };
    final result = await runQuery(sql);
    return result.rows
        .map((r) => DbCollection(name: '${r.values.first}'))
        .toList();
  }

  @override
  Future<List<DbColumn>> describe(String collection) async {
    final sql = switch (_info.kind) {
      DbEngineKind.postgres =>
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='${_esc(collection)}' ORDER BY ordinal_position;",
      DbEngineKind.mysql => 'DESCRIBE `${_esc(collection)}`;',
      _ =>
        "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${_esc(collection)}' ORDER BY ORDINAL_POSITION;",
    };
    final result = await runQuery(sql);
    return result.rows
        .map(
          (r) => DbColumn(
            name: '${r.values.elementAt(0)}',
            type: r.values.length > 1 ? '${r.values.elementAt(1)}' : 'TEXT',
          ),
        )
        .toList();
  }

  @override
  Future<DbQueryResult> runQuery(String query) async {
    final tool = _tool ?? await _detectTool();
    if (tool == null) {
      throw const DbEngineException('SQL CLI not available');
    }
    final q = query.trim();
    if (q.isEmpty) return DbQueryResult.message('Empty query');
    final isMutation = RegExp(
      r'^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|REPLACE)\b',
      caseSensitive: false,
    ).hasMatch(q);

    final result = await Process.run(tool.bin, [...tool.args, ...tool.queryArgs(q)]);
    if (result.exitCode != 0) {
      final err = '${result.stderr}\n${result.stdout}'.trim();
      throw DbEngineException(err.isEmpty ? 'CLI failed (${result.exitCode})' : err);
    }
    if (isMutation) {
      return DbQueryResult.message('OK — statement executed.', isMutation: true);
    }
    return _parseTabular(result.stdout.toString());
  }

  @override
  Future<DbQueryResult> browse(String collection, {int limit = 200}) {
    final q = switch (_info.kind) {
      DbEngineKind.mysql => 'SELECT * FROM `${_esc(collection)}` LIMIT $limit;',
      DbEngineKind.postgres => 'SELECT * FROM "${_esc(collection)}" LIMIT $limit;',
      _ => 'SELECT TOP $limit * FROM [${_esc(collection)}];',
    };
    return runQuery(q);
  }

  @override
  Future<void> insertRow(String collection, Map<String, dynamic> values) async {
    final cols = values.keys.map(_quoteIdent).join(', ');
    final vals = values.values.map(_literal).join(', ');
    await runQuery('INSERT INTO ${_quoteIdent(collection)} ($cols) VALUES ($vals);');
  }

  @override
  Future<void> updateRow(
    String collection,
    Map<String, dynamic> key,
    Map<String, dynamic> values,
  ) async {
    final sets =
        values.entries.map((e) => '${_quoteIdent(e.key)} = ${_literal(e.value)}').join(', ');
    final where =
        key.entries.map((e) => '${_quoteIdent(e.key)} = ${_literal(e.value)}').join(' AND ');
    await runQuery('UPDATE ${_quoteIdent(collection)} SET $sets WHERE $where;');
  }

  @override
  Future<void> deleteRow(String collection, Map<String, dynamic> key) async {
    final where =
        key.entries.map((e) => '${_quoteIdent(e.key)} = ${_literal(e.value)}').join(' AND ');
    await runQuery('DELETE FROM ${_quoteIdent(collection)} WHERE $where;');
  }

  String _quoteIdent(String name) => switch (_info.kind) {
        DbEngineKind.mysql => '`${name.replaceAll('`', '``')}`',
        DbEngineKind.postgres => '"${name.replaceAll('"', '""')}"',
        _ => '[${name.replaceAll(']', ']]')}]',
      };

  String _literal(dynamic value) {
    if (value == null) return 'NULL';
    if (value is num || value is bool) return '$value';
    return "'${value.toString().replaceAll("'", "''")}'";
  }

  String _esc(String s) => s.replaceAll("'", "''");

  DbQueryResult _parseTabular(String out) {
    final lines = const LineSplitter()
        .convert(out)
        .where((l) => l.trim().isNotEmpty)
        .where((l) => !l.trim().startsWith('(') || !l.contains('rows affected'))
        .toList();
    if (lines.isEmpty) return const DbQueryResult(columns: [], rows: []);

    // Prefer tab-separated; fall back to multi-space.
    final delim = lines.first.contains('\t') ? '\t' : null;
    List<String> split(String line) => delim != null
        ? line.split('\t')
        : line.trim().split(RegExp(r'\s{2,}'));

    final columns = split(lines.first).map((e) => e.trim()).toList();
    final rows = <Map<String, dynamic>>[];
    for (final line in lines.skip(1)) {
      if (RegExp(r'^-+$').hasMatch(line.replaceAll(' ', ''))) continue;
      if (line.toLowerCase().contains('rows affected')) continue;
      final cells = split(line);
      final map = <String, dynamic>{};
      for (var i = 0; i < columns.length; i++) {
        map[columns[i]] = i < cells.length ? cells[i].trim() : '';
      }
      rows.add(map);
    }
    return DbQueryResult(columns: columns, rows: rows);
  }

  Future<_CliTool?> _detectTool() async {
    final conn = _info.connectionString ?? '';
    switch (_info.kind) {
      case DbEngineKind.postgres:
        final bin = await _which([
          '/opt/homebrew/bin/psql',
          '/usr/local/bin/psql',
          'psql',
        ]);
        if (bin == null) return null;
        return _CliTool(
          bin: bin,
          args: ['"$conn"'.contains('=') ? conn : 'postgresql://$conn'],
          queryArgs: (q) => ['-c', q, '--csv'],
        );
      case DbEngineKind.mysql:
        final bin = await _which([
          '/opt/homebrew/bin/mysql',
          '/usr/local/bin/mysql',
          'mysql',
        ]);
        if (bin == null) return null;
        return _CliTool(
          bin: bin,
          args: _mysqlArgs(conn),
          queryArgs: (q) => ['-e', q, '--batch', '--raw'],
        );
      case DbEngineKind.sqlServer:
      default:
        final bin = await _which([
          '/opt/homebrew/bin/sqlcmd',
          '/usr/local/bin/sqlcmd',
          'sqlcmd',
        ]);
        if (bin == null) return null;
        return _CliTool(
          bin: bin,
          args: _sqlcmdArgs(conn),
          queryArgs: (q) => ['-Q', q, '-s', '\t', '-W'],
        );
    }
  }

  List<String> _mysqlArgs(String conn) {
    // mysql://user:pass@host:3306/db or key=value;
    final uri = Uri.tryParse(conn);
    if (uri != null && (uri.scheme == 'mysql' || uri.scheme == 'mysql2')) {
      return [
        if (uri.host.isNotEmpty) ...['-h', uri.host],
        if (uri.port != 0) ...['-P', '${uri.port}'],
        if (uri.userInfo.isNotEmpty) ...[
          '-u',
          uri.userInfo.split(':').first,
          if (uri.userInfo.contains(':')) ...['-p${uri.userInfo.split(':').last}'],
        ],
        if (uri.path.length > 1) uri.path.substring(1),
      ];
    }
    return ['--defaults-extra-file=/dev/null', '-e', 'SELECT 1']; // fallback overwritten
  }

  List<String> _sqlcmdArgs(String conn) {
    // Server=host,1433;Database=db;User Id=sa;Password=x;TrustServerCertificate=True
    String? server;
    String? db;
    String? user;
    String? pass;
    for (final part in conn.split(';')) {
      final kv = part.split('=');
      if (kv.length < 2) continue;
      final k = kv.first.trim().toLowerCase();
      final v = kv.sublist(1).join('=').trim();
      if (k == 'server' || k == 'data source') server = v;
      if (k == 'database' || k == 'initial catalog') db = v;
      if (k == 'user id' || k == 'uid') user = v;
      if (k == 'password' || k == 'pwd') pass = v;
    }
    return [
      if (server != null) ...['-S', server],
      if (db != null) ...['-d', db],
      if (user != null) ...['-U', user],
      if (pass != null) ...['-P', pass],
      '-C',
    ];
  }

  Future<String?> _which(List<String> candidates) async {
    for (final bin in candidates) {
      try {
        final r = await Process.run(bin, ['--version']);
        if (r.exitCode == 0 || r.stdout.toString().isNotEmpty || r.stderr.toString().isNotEmpty) {
          return bin;
        }
      } catch (_) {
        try {
          final r = await Process.run(bin, ['-?']);
          if (r.exitCode == 0 || r.stdout.toString().isNotEmpty) return bin;
        } catch (_) {}
      }
    }
    return null;
  }
}

class _CliTool {
  final String bin;
  final List<String> args;
  final List<String> Function(String query) queryArgs;
  _CliTool({required this.bin, required this.args, required this.queryArgs});
}
