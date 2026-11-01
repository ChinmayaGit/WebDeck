import 'package:flutter/material.dart';

import '../../../../data/db/db_engine.dart';
import '../../../../data/db/db_engine_resolver.dart';
import '../../../../data/db/db_models.dart';
import '../../../../data/models/backend_requirement.dart';
import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';
import '../view_models/catalog_view_model.dart';

/// Universal Database Studio — SQL + NoSQL + REST API stores.
/// Grid CRUD, query editor, and multi-engine connection switching.
class DatabaseBrowserDialog extends StatefulWidget {
  final InstalledApp app;
  final BackendRequirement requirement;
  final CatalogViewModel viewModel;

  const DatabaseBrowserDialog({
    super.key,
    required this.app,
    required this.requirement,
    required this.viewModel,
  });

  @override
  State<DatabaseBrowserDialog> createState() => _DatabaseBrowserDialogState();
}

class _DatabaseBrowserDialogState extends State<DatabaseBrowserDialog> {
  final _resolver = DbEngineResolver();
  final _queryController = TextEditingController();

  List<DbEngine> _engines = [];
  DbEngine? _engine;
  List<DbCollection> _collections = [];
  String? _selectedCollection;
  List<DbColumn> _schema = [];
  DbQueryResult? _result;
  bool _loading = true;
  String? _error;
  String? _status;
  int? _selectedRow;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _queryController.dispose();
    for (final e in _engines) {
      e.close();
    }
    super.dispose();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final engines =
          await _resolver.resolveAll(widget.app, widget.requirement);
      if (engines.isEmpty) {
        throw const DbEngineException(
          'No database or API store detected for this app.',
        );
      }
      for (final e in engines) {
        try {
          await e.open();
        } catch (_) {
          // Keep engine listed; open errors surface when selected.
        }
      }
      _engines = engines;
      await _selectEngine(engines.first);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _selectEngine(DbEngine engine) async {
    setState(() {
      _loading = true;
      _error = null;
      _engine = engine;
      _collections = [];
      _selectedCollection = null;
      _result = null;
      _selectedRow = null;
      _queryController.text = engine.queryHelp.split('\n').first;
    });
    try {
      await engine.open();
      final collections = await engine.listCollections();
      if (!mounted) return;
      setState(() {
        _collections = collections;
        _loading = false;
      });
      if (collections.isNotEmpty) {
        await _selectCollection(collections.first.name);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _selectCollection(String name) async {
    final engine = _engine;
    if (engine == null) return;
    setState(() {
      _loading = true;
      _selectedCollection = name;
      _selectedRow = null;
      _error = null;
      if (engine.supportsSqlEditor) {
        _queryController.text = 'SELECT * FROM $name LIMIT 200;';
      }
    });
    try {
      final schema = await engine.describe(name);
      final result = await engine.browse(name);
      if (!mounted) return;
      setState(() {
        _schema = schema;
        _result = result;
        _loading = false;
        _status = '${result.rows.length} row(s)';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _runQuery() async {
    final engine = _engine;
    if (engine == null) return;
    setState(() {
      _loading = true;
      _error = null;
      _selectedRow = null;
    });
    try {
      final result = await engine.runQuery(_queryController.text);
      if (result.isMutation) {
        if (_selectedCollection != null) {
          await _selectCollection(_selectedCollection!);
        }
        setState(() {
          _status = result.message ?? 'Mutation OK';
          _loading = false;
        });
        return;
      }
      if (!mounted) return;
      setState(() {
        _result = result;
        _loading = false;
        _status = result.message ?? '${result.rows.length} row(s)';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _refresh() async {
    if (_selectedCollection != null) {
      await _selectCollection(_selectedCollection!);
    } else if (_engine != null) {
      await _selectEngine(_engine!);
    }
  }

  Map<String, dynamic>? get _selectedKey {
    final engine = _engine;
    final result = _result;
    final idx = _selectedRow;
    if (engine == null || result == null || idx == null) return null;
    if (idx < 0 || idx >= result.rows.length) return null;
    final row = result.rows[idx];
    final pkCols = _schema.where((c) => c.primaryKey).map((c) => c.name).toList();
    if (pkCols.isEmpty) {
      for (final c in result.columns) {
        final l = c.toLowerCase();
        if (l == 'id' || l == '_id' || l.endsWith('id')) {
          pkCols.add(c);
          break;
        }
      }
    }
    if (pkCols.isEmpty && row.isNotEmpty) {
      return {row.keys.first: row.values.first};
    }
    return {for (final c in pkCols) c: row[c]};
  }

  Future<void> _addRow() async {
    final engine = _engine;
    final collection = _selectedCollection;
    if (engine == null || collection == null) return;
    final values = await _showRowEditor(title: 'Insert row', initial: {
      for (final c in _schema.where((c) => !c.primaryKey)) c.name: '',
    });
    if (values == null) return;
    try {
      await engine.insertRow(collection, values);
      await _refresh();
      setState(() => _status = 'Row inserted');
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _editRow() async {
    final engine = _engine;
    final collection = _selectedCollection;
    final result = _result;
    final idx = _selectedRow;
    final key = _selectedKey;
    if (engine == null || collection == null || result == null || idx == null || key == null) {
      setState(() => _status = 'Select a row first');
      return;
    }
    final row = Map<String, dynamic>.from(result.rows[idx]);
    final values = await _showRowEditor(title: 'Edit row', initial: row, lockedKeys: key.keys.toSet());
    if (values == null) return;
    final updates = Map<String, dynamic>.from(values)
      ..removeWhere((k, _) => key.containsKey(k));
    try {
      await engine.updateRow(collection, key, updates);
      await _refresh();
      setState(() => _status = 'Row updated');
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<void> _deleteRow() async {
    final engine = _engine;
    final collection = _selectedCollection;
    final key = _selectedKey;
    if (engine == null || collection == null || key == null) {
      setState(() => _status = 'Select a row first');
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: const Text('Delete row?'),
        content: Text('Delete record $key from $collection?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: WebDeckTheme.accentRed),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await engine.deleteRow(collection, key);
      await _refresh();
      setState(() => _status = 'Row deleted');
    } catch (e) {
      setState(() => _error = e.toString());
    }
  }

  Future<Map<String, dynamic>?> _showRowEditor({
    required String title,
    required Map<String, dynamic> initial,
    Set<String> lockedKeys = const {},
  }) async {
    final controllers = <String, TextEditingController>{
      for (final e in initial.entries)
        e.key: TextEditingController(text: '${e.value ?? ''}'),
    };
    // Ensure schema fields exist
    for (final col in _schema) {
      controllers.putIfAbsent(col.name, () => TextEditingController());
    }

    return showDialog<Map<String, dynamic>>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: Text(title),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final entry in controllers.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TextField(
                      controller: entry.value,
                      enabled: !lockedKeys.contains(entry.key),
                      decoration: InputDecoration(
                        labelText: entry.key,
                        isDense: true,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final map = <String, dynamic>{};
              for (final e in controllers.entries) {
                final raw = e.value.text.trim();
                if (raw.isEmpty && lockedKeys.contains(e.key)) continue;
                final asNum = num.tryParse(raw);
                map[e.key] = asNum ?? raw;
              }
              Navigator.pop(ctx, map);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final engine = _engine;
    final noun = engine?.info.kind.collectionNoun ?? 'table';

    return Dialog(
      backgroundColor: WebDeckTheme.surface,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: WebDeckTheme.border),
      ),
      child: SizedBox(
        width: 1100,
        height: 680,
        child: Column(
          children: [
            _buildHeader(),
            const Divider(height: 1, color: WebDeckTheme.border),
            Expanded(
              child: Row(
                children: [
                  SizedBox(
                    width: 220,
                    child: _buildSidebar(noun),
                  ),
                  const VerticalDivider(width: 1, color: WebDeckTheme.border),
                  Expanded(child: _buildMainPane()),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      child: Row(
        children: [
          const Icon(Icons.storage_rounded, color: Color(0xFF58A6FF)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Database Studio · ${widget.app.name}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: WebDeckTheme.textPrimary,
                  ),
                ),
                Text(
                  _engine == null
                      ? 'Detecting stores…'
                      : '${_engine!.info.kind.label} · ${_engine!.info.displayName}',
                  style: const TextStyle(fontSize: 11, color: WebDeckTheme.textSecondary),
                ),
              ],
            ),
          ),
          if (_engines.length > 1)
            DropdownButton<DbEngine>(
              value: _engine,
              dropdownColor: WebDeckTheme.surface,
              underline: const SizedBox.shrink(),
              items: [
                for (final e in _engines)
                  DropdownMenuItem(
                    value: e,
                    child: Text(e.info.displayName, style: const TextStyle(fontSize: 12)),
                  ),
              ],
              onChanged: _loading
                  ? null
                  : (e) {
                      if (e != null) _selectEngine(e);
                    },
            ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _refresh,
            icon: const Icon(Icons.refresh, size: 18),
          ),
          IconButton(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close, size: 20),
          ),
        ],
      ),
    );
  }

  Widget _buildSidebar(String noun) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 6),
          child: Text(
            '${noun.toUpperCase()}S',
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.8,
              color: WebDeckTheme.textSecondary,
            ),
          ),
        ),
        Expanded(
          child: _collections.isEmpty
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: Text(
                    'No tables/collections yet.',
                    style: TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                  ),
                )
              : ListView.builder(
                  itemCount: _collections.length,
                  itemBuilder: (context, index) {
                    final c = _collections[index];
                    final selected = c.name == _selectedCollection;
                    return ListTile(
                      dense: true,
                      selected: selected,
                      selectedTileColor: WebDeckTheme.primary.withValues(alpha: 0.12),
                      title: Text(
                        c.name,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                          color: WebDeckTheme.textPrimary,
                        ),
                      ),
                      subtitle: c.detail == null
                          ? null
                          : Text(
                              c.detail!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 10),
                            ),
                      onTap: _loading ? null : () => _selectCollection(c.name),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildMainPane() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
          child: Row(
            children: [
              ElevatedButton.icon(
                onPressed: _loading || _selectedCollection == null ? null : _addRow,
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _loading || _selectedRow == null ? null : _editRow,
                icon: const Icon(Icons.edit, size: 15),
                label: const Text('Edit'),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _loading || _selectedRow == null ? null : _deleteRow,
                style: OutlinedButton.styleFrom(foregroundColor: WebDeckTheme.accentRed),
                icon: const Icon(Icons.delete_outline, size: 15),
                label: const Text('Delete'),
              ),
              const Spacer(),
              if (_status != null)
                Text(
                  _status!,
                  style: const TextStyle(fontSize: 11, color: WebDeckTheme.textSecondary),
                ),
            ],
          ),
        ),
        Expanded(child: _buildGrid()),
        _buildQueryEditor(),
      ],
    );
  }

  Widget _buildGrid() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: SelectableText(
            _error!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: WebDeckTheme.accentRed, fontSize: 13),
          ),
        ),
      );
    }
    final result = _result;
    if (result == null || result.columns.isEmpty) {
      return Center(
        child: Text(
          result?.message ?? 'No rows. Use Add or run a query.',
          style: const TextStyle(color: WebDeckTheme.textSecondary),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.28),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: WebDeckTheme.border),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: SingleChildScrollView(
          child: DataTable(
            showCheckboxColumn: false,
            headingRowColor: WidgetStatePropertyAll(
              WebDeckTheme.primary.withValues(alpha: 0.12),
            ),
            dataRowMinHeight: 36,
            dataRowMaxHeight: 48,
            columns: [
              for (final col in result.columns)
                DataColumn(
                  label: Text(
                    col,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                      color: WebDeckTheme.textPrimary,
                    ),
                  ),
                ),
            ],
            rows: [
              for (var i = 0; i < result.rows.length; i++)
                DataRow(
                  selected: _selectedRow == i,
                  onSelectChanged: (_) => setState(() => _selectedRow = i),
                  cells: [
                    for (final col in result.columns)
                      DataCell(
                        SelectableText(
                          '${result.rows[i][col] ?? ''}',
                          style: const TextStyle(
                            fontSize: 12,
                            fontFamily: 'monospace',
                            color: WebDeckTheme.textPrimary,
                          ),
                        ),
                        onTap: () => setState(() => _selectedRow = i),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQueryEditor() {
    final engine = _engine;
    final label = engine == null
        ? 'Query'
        : engine.supportsSqlEditor
            ? 'SQL'
            : engine.info.kind == DbEngineKind.mongodb
                ? 'Filter / script'
                : 'Query / URL';

    return Container(
      height: 150,
      margin: const EdgeInsets.all(12),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF0D1117),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: WebDeckTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: WebDeckTheme.textSecondary,
                ),
              ),
              const Spacer(),
              ElevatedButton.icon(
                onPressed: _loading ? null : _runQuery,
                icon: const Icon(Icons.play_arrow_rounded, size: 16),
                label: const Text('Run'),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Expanded(
            child: TextField(
              controller: _queryController,
              maxLines: null,
              expands: true,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: Color(0xFF58A6FF),
              ),
              decoration: const InputDecoration(
                border: InputBorder.none,
                isDense: true,
                hintText: 'Write a query…',
                hintStyle: TextStyle(color: Colors.white24),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
