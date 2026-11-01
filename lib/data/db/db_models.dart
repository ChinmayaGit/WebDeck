enum DbEngineKind {
  sqlite,
  sqlServer,
  postgres,
  mysql,
  mongodb,
  redis,
  restApi,
  unknown,
}

extension DbEngineKindX on DbEngineKind {
  String get label => switch (this) {
        DbEngineKind.sqlite => 'SQLite',
        DbEngineKind.sqlServer => 'SQL Server',
        DbEngineKind.postgres => 'PostgreSQL',
        DbEngineKind.mysql => 'MySQL',
        DbEngineKind.mongodb => 'MongoDB',
        DbEngineKind.redis => 'Redis',
        DbEngineKind.restApi => 'REST / API store',
        DbEngineKind.unknown => 'Database',
      };

  bool get isSql =>
      this == DbEngineKind.sqlite ||
      this == DbEngineKind.sqlServer ||
      this == DbEngineKind.postgres ||
      this == DbEngineKind.mysql;

  bool get isDocument => this == DbEngineKind.mongodb || this == DbEngineKind.restApi;

  bool get isKeyValue => this == DbEngineKind.redis;

  String get queryPlaceholder => switch (this) {
        DbEngineKind.mongodb => '{ "status": "active" }\n// or leave empty for find({})',
        DbEngineKind.redis => 'KEYS *',
        DbEngineKind.restApi => '// Optional JSON body for custom POST filter',
        _ => 'SELECT * FROM table_name LIMIT 100;',
      };

  String get collectionNoun => isDocument
      ? 'collection'
      : (isKeyValue ? 'keyspace' : 'table');
}

class DbColumn {
  final String name;
  final String type;
  final bool primaryKey;
  final bool nullable;

  const DbColumn({
    required this.name,
    this.type = 'TEXT',
    this.primaryKey = false,
    this.nullable = true,
  });
}

class DbCollection {
  final String name;
  final String? detail;

  const DbCollection({required this.name, this.detail});
}

class DbQueryResult {
  final List<String> columns;
  final List<Map<String, dynamic>> rows;
  final String? message;
  final bool isMutation;

  const DbQueryResult({
    required this.columns,
    required this.rows,
    this.message,
    this.isMutation = false,
  });

  factory DbQueryResult.message(String message, {bool isMutation = false}) =>
      DbQueryResult(
        columns: const [],
        rows: const [],
        message: message,
        isMutation: isMutation,
      );
}

class DbConnectionInfo {
  final DbEngineKind kind;
  final String displayName;
  final String? filePath;
  final String? connectionString;
  final String? apiBaseUrl;
  final String? primaryKeyHint;

  const DbConnectionInfo({
    required this.kind,
    required this.displayName,
    this.filePath,
    this.connectionString,
    this.apiBaseUrl,
    this.primaryKeyHint,
  });
}
