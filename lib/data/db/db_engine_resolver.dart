import 'dart:io';

import 'package:path/path.dart' as p;

import '../models/backend_requirement.dart';
import '../models/installed_app.dart';
import 'db_engine.dart';
import 'db_models.dart';
import 'engines/mongo_cli_engine.dart';
import 'engines/rest_api_engine.dart';
import 'engines/sql_cli_engine.dart';
import 'engines/sqlite_engine.dart';

class DbEngineResolver {
  /// Builds every viable engine for an installed app (SQL file, remote SQL, Mongo, REST).
  Future<List<DbEngine>> resolveAll(
    InstalledApp app,
    BackendRequirement? req,
  ) async {
    final engines = <DbEngine>[];
    final seen = <String>{};

    void add(DbEngine e) {
      final key = '${e.info.kind}:${e.info.filePath ?? e.info.connectionString ?? e.info.apiBaseUrl}';
      if (seen.add(key)) engines.add(e);
    }

    // 1) Explicit SQLite / .db file from detection
    if (req?.databasePath != null &&
        req!.databasePath != 'SQLite' &&
        req.databasePath != 'SQL Server') {
      final file = File(p.join(app.installedPath, req.databasePath!));
      if (await file.exists()) {
        add(SqliteEngine(DbConnectionInfo(
          kind: DbEngineKind.sqlite,
          displayName: 'SQLite · ${p.basename(file.path)}',
          filePath: file.path,
        )));
      }
    }

    // 2) Scan app tree for common DB files
    final root = Directory(app.installedPath);
    if (await root.exists()) {
      await for (final entity in root.list(recursive: true, followLinks: false)) {
        if (entity is! File) continue;
        final name = p.basename(entity.path).toLowerCase();
        final rel = p.relative(entity.path, from: root.path);
        if (rel.contains('node_modules') ||
            rel.contains('.git') ||
            rel.contains('bin/') ||
            rel.contains('obj/')) {
          continue;
        }
        if (name.endsWith('.db') ||
            name.endsWith('.sqlite') ||
            name.endsWith('.sqlite3')) {
          add(SqliteEngine(DbConnectionInfo(
            kind: DbEngineKind.sqlite,
            displayName: 'SQLite · ${p.basename(entity.path)}',
            filePath: entity.path,
          )));
        }
      }
    }

    // 3) Connection string based engines
    final conn = req?.connectionString;
    if (conn != null && conn.isNotEmpty) {
      final kind = _kindFromConnection(conn, req);
      if (kind == DbEngineKind.mongodb) {
        add(MongoCliEngine(DbConnectionInfo(
          kind: kind,
          displayName: 'MongoDB',
          connectionString: conn,
        )));
      } else if (kind.isSql && kind != DbEngineKind.sqlite) {
        add(SqlCliEngine(DbConnectionInfo(
          kind: kind,
          displayName: kind.label,
          connectionString: conn,
        )));
      }
    } else if (req?.usesSqlServer == true) {
      add(SqlCliEngine(DbConnectionInfo(
        kind: DbEngineKind.sqlServer,
        displayName: 'SQL Server',
        connectionString: 'Server=localhost,1433;TrustServerCertificate=True;',
      )));
    }

    // 4) REST / API-backed store (SPA + .NET/Python companions)
    final apiUrl = req?.apiCheckUrl ??
        (req?.backendPort != null
            ? 'http://127.0.0.1:${req!.backendPort}/api'
            : null);
    if (apiUrl != null) {
      add(RestApiEngine(DbConnectionInfo(
        kind: DbEngineKind.restApi,
        displayName: 'API data · $apiUrl',
        apiBaseUrl: apiUrl,
        primaryKeyHint: 'id',
      )));
    }

    return engines;
  }

  DbEngineKind _kindFromConnection(String conn, BackendRequirement? req) {
    final lower = conn.toLowerCase();
    if (lower.startsWith('mongodb://') || lower.startsWith('mongodb+srv://')) {
      return DbEngineKind.mongodb;
    }
    if (lower.startsWith('postgres://') ||
        lower.startsWith('postgresql://') ||
        lower.contains('host=') && lower.contains('dbname=')) {
      return DbEngineKind.postgres;
    }
    if (lower.startsWith('mysql://') || lower.contains('mysql')) {
      return DbEngineKind.mysql;
    }
    if (req?.usesSqlServer == true ||
        lower.contains('server=') ||
        lower.contains('initial catalog') ||
        lower.contains('trustservercertificate')) {
      return DbEngineKind.sqlServer;
    }
    if (lower.endsWith('.db') || lower.contains('sqlite')) {
      return DbEngineKind.sqlite;
    }
    return DbEngineKind.unknown;
  }
}
