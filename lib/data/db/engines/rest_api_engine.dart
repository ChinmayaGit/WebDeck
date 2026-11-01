import 'dart:convert';
import 'dart:io';

import '../db_engine.dart';
import '../db_models.dart';

/// Treats a JSON REST collection endpoint as a browsable/editable "table".
/// Conventions: GET list, POST create, PUT/PATCH /{id} update, DELETE /{id}.
class RestApiEngine extends DbEngine {
  RestApiEngine(this._info);
  final DbConnectionInfo _info;

  @override
  DbConnectionInfo get info => _info;

  String get _base {
    final u = _info.apiBaseUrl;
    if (u == null || u.isEmpty) {
      throw const DbEngineException('API base URL is missing.');
    }
    return u.replaceAll(RegExp(r'/+$'), '');
  }

  String get _pk => _info.primaryKeyHint ?? 'id';

  @override
  Future<void> open() async {}

  @override
  Future<void> close() async {}

  @override
  bool get supportsSqlEditor => false;

  @override
  String get queryHelp =>
      'REST mode: use the grid for CRUD, or paste a full URL in the query box and Run.';

  @override
  Future<List<DbCollection>> listCollections() async {
    final uri = Uri.parse(_base);
    final name = uri.pathSegments.isEmpty
        ? 'data'
        : uri.pathSegments.lastWhere((s) => s.isNotEmpty, orElse: () => 'data');
    return [DbCollection(name: name, detail: _base)];
  }

  @override
  Future<List<DbColumn>> describe(String collection) async {
    final result = await browse(collection, limit: 1);
    if (result.rows.isEmpty) {
      return [
        DbColumn(name: _pk, type: 'number', primaryKey: true, nullable: false),
        const DbColumn(name: 'name', type: 'string'),
      ];
    }
    return result.rows.first.keys
        .map(
          (k) => DbColumn(
            name: k,
            type: _guessType(result.rows.first[k]),
            primaryKey: k.toLowerCase() == _pk.toLowerCase() || k.toLowerCase() == 'id',
          ),
        )
        .toList();
  }

  @override
  Future<DbQueryResult> runQuery(String query) async {
    final q = query.trim();
    if (q.isEmpty) return browse((await listCollections()).first.name);
    if (q.startsWith('http://') || q.startsWith('https://')) {
      return _getAsResult(q);
    }
    // Treat as relative path under host of api base
    final base = Uri.parse(_base);
    final path = q.startsWith('/') ? q : '/$q';
    final url = base.replace(path: path).toString();
    return _getAsResult(url);
  }

  @override
  Future<DbQueryResult> browse(String collection, {int limit = 200}) async {
    return _getAsResult(_base);
  }

  @override
  Future<void> insertRow(String collection, Map<String, dynamic> values) async {
    final body = Map<String, dynamic>.from(values)
      ..removeWhere((k, _) => k.toLowerCase() == _pk.toLowerCase() && (values[k] == null || values[k] == ''));
    final res = await _request('POST', _base, body: body);
    if (!res.ok) {
      throw DbEngineException(res.error ?? 'POST failed (${res.statusCode})');
    }
  }

  @override
  Future<void> updateRow(
    String collection,
    Map<String, dynamic> key,
    Map<String, dynamic> values,
  ) async {
    final id = _extractId(key);
    final body = Map<String, dynamic>.from(values)..addAll(key);
    final res = await _request('PUT', '$_base/$id', body: body);
    if (!res.ok) {
      final patch = await _request('PATCH', '$_base/$id', body: values);
      if (!patch.ok) {
        throw DbEngineException(res.error ?? 'PUT/PATCH failed (${res.statusCode})');
      }
    }
  }

  @override
  Future<void> deleteRow(String collection, Map<String, dynamic> key) async {
    final id = _extractId(key);
    final res = await _request('DELETE', '$_base/$id');
    if (!res.ok) {
      throw DbEngineException(res.error ?? 'DELETE failed (${res.statusCode})');
    }
  }

  dynamic _extractId(Map<String, dynamic> key) {
    for (final k in key.keys) {
      if (k.toLowerCase() == _pk.toLowerCase() || k.toLowerCase() == 'id') {
        return key[k];
      }
    }
    if (key.length == 1) return key.values.first;
    throw const DbEngineException('Could not determine record id for REST update/delete.');
  }

  Future<DbQueryResult> _getAsResult(String url) async {
    final res = await _request('GET', url);
    if (!res.ok) {
      throw DbEngineException(res.error ?? 'GET failed (${res.statusCode})');
    }
    return _decodeRows(res.body);
  }

  DbQueryResult _decodeRows(String body) {
    final decoded = jsonDecode(body);
    List<Map<String, dynamic>> records = [];
    if (decoded is List) {
      records = decoded
          .whereType<Map>()
          .map((e) => e.map((k, v) => MapEntry(k.toString(), v)))
          .toList();
    } else if (decoded is Map) {
      for (final key in ['data', 'items', 'results', 'employees', 'value', 'documents']) {
        final v = decoded[key];
        if (v is List) {
          records = v
              .whereType<Map>()
              .map((e) => e.map((k, val) => MapEntry(k.toString(), val)))
              .toList();
          break;
        }
      }
      if (records.isEmpty) {
        records = [decoded.map((k, v) => MapEntry(k.toString(), v))];
      }
    } else {
      throw const DbEngineException('API response is not JSON object/array.');
    }

    final columns = <String>{};
    for (final row in records) {
      columns.addAll(row.keys);
    }
    // Prefer id-like columns first
    final cols = columns.toList()
      ..sort((a, b) {
        int score(String s) {
          final l = s.toLowerCase();
          if (l == 'id' || l == '_id') return 0;
          if (l.endsWith('id')) return 1;
          return 2;
        }
        return score(a).compareTo(score(b));
      });

    return DbQueryResult(
      columns: cols,
      rows: records
          .map((r) => {for (final c in cols) c: r[c]})
          .toList(),
    );
  }

  String _guessType(dynamic v) {
    if (v is int || v is double) return 'number';
    if (v is bool) return 'boolean';
    if (v is Map || v is List) return 'json';
    return 'string';
  }

  Future<_HttpResult> _request(
    String method,
    String url, {
    Map<String, dynamic>? body,
  }) async {
    HttpClient? client;
    try {
      client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 5);
      final request = await client.openUrl(method, Uri.parse(url));
      request.headers.set('Accept', 'application/json');
      if (body != null) {
        final encoded = utf8.encode(jsonEncode(body));
        request.headers.set('Content-Type', 'application/json; charset=utf-8');
        request.contentLength = encoded.length;
        request.add(encoded);
      }
      final response = await request.close().timeout(const Duration(seconds: 8));
      final text = await response.transform(utf8.decoder).join();
      final code = response.statusCode;
      return _HttpResult(
        ok: code >= 200 && code < 300,
        statusCode: code,
        body: text,
        error: code >= 300 ? 'HTTP $code: ${text.length > 300 ? text.substring(0, 300) : text}' : null,
      );
    } catch (e) {
      return _HttpResult(ok: false, body: '', error: e.toString());
    } finally {
      client?.close(force: true);
    }
  }
}

class _HttpResult {
  final bool ok;
  final int? statusCode;
  final String body;
  final String? error;
  const _HttpResult({
    required this.ok,
    this.statusCode,
    required this.body,
    this.error,
  });
}
