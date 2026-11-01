import 'db_models.dart';

/// Universal database engine contract used by Database Studio.
abstract class DbEngine {
  DbConnectionInfo get info;

  Future<void> open();
  Future<void> close();

  Future<List<DbCollection>> listCollections();
  Future<List<DbColumn>> describe(String collection);

  /// Run native query language for this engine (SQL, Mongo filter, Redis cmd…).
  Future<DbQueryResult> runQuery(String query);

  /// Load rows for grid browsing.
  Future<DbQueryResult> browse(String collection, {int limit = 200});

  Future<void> insertRow(String collection, Map<String, dynamic> values);
  Future<void> updateRow(
    String collection,
    Map<String, dynamic> key,
    Map<String, dynamic> values,
  );
  Future<void> deleteRow(String collection, Map<String, dynamic> key);

  bool get supportsSqlEditor => info.kind.isSql;
  bool get supportsGridCrud => true;
  String get queryHelp => info.kind.queryPlaceholder;
}

class DbEngineException implements Exception {
  final String message;
  const DbEngineException(this.message);
  @override
  String toString() => message;
}
