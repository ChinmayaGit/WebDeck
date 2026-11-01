import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../data/models/backend_requirement.dart';
import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';
import '../view_models/catalog_view_model.dart';
import 'database_browser_dialog.dart';

class BackendConsoleDialog extends StatefulWidget {
  final InstalledApp app;
  final BackendRequirement requirement;
  final CatalogViewModel viewModel;

  const BackendConsoleDialog({
    super.key,
    required this.app,
    required this.requirement,
    required this.viewModel,
  });

  @override
  State<BackendConsoleDialog> createState() => _BackendConsoleDialogState();
}

class _BackendConsoleDialogState extends State<BackendConsoleDialog> {
  bool _busy = false;
  String? _status;
  ApiTestResult? _apiResult;
  late final TextEditingController _urlController;
  String _method = 'GET';
  bool _apiUp = false;
  bool _viteUp = false;
  bool _dbAvailable = false;

  BackendRequirement get req => widget.requirement;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(
      text: req.apiCheckUrl ??
          (req.backendPort != null
              ? 'http://127.0.0.1:${req.backendPort}/api'
              : ''),
    );
    _refreshStatus();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _refreshStatus() async {
    final apiUp =
        req.backendPort != null && await widget.viewModel.isPortListening(req.backendPort!);
    final viteUp =
        req.viteDevPort != null && await widget.viewModel.isPortListening(req.viteDevPort!);
    final dbAvailable = req.hasDatabase ||
        req.usesSqlServer ||
        (req.databasePath != null && req.databasePath != 'SQLite' && req.databasePath != 'SQL Server') ||
        (req.connectionString != null && req.connectionString!.isNotEmpty);
    if (!mounted) return;
    setState(() {
      _apiUp = apiUp;
      _viteUp = viteUp;
      _dbAvailable = dbAvailable;
    });
  }

  Future<void> _startBackend() async {
    setState(() {
      _busy = true;
      _status = 'Creating / starting companion backend…';
    });
    try {
      await widget.viewModel.startCompanionBackend(
        widget.app,
        requirement: req,
      );
      // Wait briefly for ports
      for (var i = 0; i < 30; i++) {
        await Future.delayed(const Duration(milliseconds: 500));
        await _refreshStatus();
        final needApi = req.backendPort == null || _apiUp;
        final needVite = req.viteDevPort == null || _viteUp;
        if (needApi && needVite) break;
      }
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = (_apiUp || req.backendPort == null) &&
                (_viteUp || req.viteDevPort == null)
            ? 'Backend is running.'
            : 'Started, but some ports are still coming up. Use Test API to verify.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = 'Failed to start backend: $e';
      });
    }
  }

  Future<void> _stopBackend() async {
    setState(() {
      _busy = true;
      _status = 'Stopping companion processes…';
    });
    await widget.viewModel.stopCompanionBackend(widget.app.id);
    await _refreshStatus();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = 'Companion processes stopped.';
    });
  }

  Future<void> _testApi() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) return;
    setState(() {
      _busy = true;
      _status = 'Testing $url…';
      _apiResult = null;
    });
    final result = await widget.viewModel.testApi(url, method: _method);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _apiResult = result;
      _status = result.ok
          ? 'API OK (${result.statusCode})'
          : 'API failed: ${result.error ?? result.statusCode}';
    });
    await _refreshStatus();
  }

  Future<void> _openDatabase() async {
    if (!mounted) return;
    await showDialog(
      context: context,
      builder: (ctx) => DatabaseBrowserDialog(
        app: widget.app,
        requirement: req,
        viewModel: widget.viewModel,
      ),
    );
  }

  Future<void> _copyConnectionString() async {
    final conn = req.connectionString;
    if (conn == null || conn.isEmpty) {
      setState(() => _status = 'No connection string detected for this app.');
      return;
    }
    await Clipboard.setData(ClipboardData(text: conn));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Connection string copied to clipboard'),
        backgroundColor: WebDeckTheme.accentGreen,
      ),
    );
  }

  Future<void> _openOpenApi() async {
    final url = req.openApiUrl;
    if (url == null) return;
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: WebDeckTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: WebDeckTheme.border),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640, maxHeight: 720),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.dns_rounded, color: Color(0xFF512BD4)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Backend Console — ${widget.app.name}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: WebDeckTheme.textPrimary,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: _busy ? null : () => Navigator.pop(context),
                    icon: const Icon(Icons.close, size: 20),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                req.setupInstructions ??
                    'Create, open, and test this app\'s local API / database companions.',
                style: const TextStyle(
                  fontSize: 12,
                  color: WebDeckTheme.textSecondary,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (req.backendPort != null)
                    _statusChip(
                      'API :${req.backendPort}',
                      _apiUp,
                    ),
                  if (req.viteDevPort != null)
                    _statusChip(
                      'UI :${req.viteDevPort}',
                      _viteUp,
                    ),
                  if (_dbAvailable)
                    _statusChip(
                      req.usesSqlServer ? 'SQL Server' : 'Database',
                      true,
                      idleColor: const Color(0xFFCC2927),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ElevatedButton.icon(
                    onPressed: _busy ? null : _startBackend,
                    icon: const Icon(Icons.play_arrow_rounded, size: 18),
                    label: const Text('Create / Start Backend'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _stopBackend,
                    icon: const Icon(Icons.stop_rounded, size: 16),
                    label: const Text('Stop'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _openDatabase,
                    icon: const Icon(Icons.table_chart_rounded, size: 16),
                    label: const Text('Open Database'),
                  ),
                  if (req.connectionString != null &&
                      req.connectionString!.isNotEmpty)
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _copyConnectionString,
                      icon: const Icon(Icons.copy_rounded, size: 16),
                      label: const Text('Copy Conn String'),
                    ),
                  if (req.openApiUrl != null)
                    OutlinedButton.icon(
                      onPressed: _busy ? null : _openOpenApi,
                      icon: const Icon(Icons.description_outlined, size: 16),
                      label: const Text('OpenAPI'),
                    ),
                  IconButton(
                    tooltip: 'Refresh status',
                    onPressed: _busy ? null : _refreshStatus,
                    icon: const Icon(Icons.refresh, size: 18),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              const Text(
                'Test API',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: WebDeckTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  DropdownButton<String>(
                    value: _method,
                    dropdownColor: WebDeckTheme.surface,
                    items: const [
                      DropdownMenuItem(value: 'GET', child: Text('GET')),
                      DropdownMenuItem(value: 'POST', child: Text('POST')),
                      DropdownMenuItem(value: 'PUT', child: Text('PUT')),
                      DropdownMenuItem(value: 'DELETE', child: Text('DELETE')),
                    ],
                    onChanged: _busy
                        ? null
                        : (v) {
                            if (v != null) setState(() => _method = v);
                          },
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _urlController,
                      enabled: !_busy,
                      style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: 'http://127.0.0.1:5018/api/employees',
                        filled: true,
                        fillColor: Colors.black.withValues(alpha: 0.25),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(8),
                          borderSide: const BorderSide(color: WebDeckTheme.border),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: _busy ? null : _testApi,
                    child: const Text('Test'),
                  ),
                ],
              ),
              if (_status != null) ...[
                const SizedBox(height: 12),
                Text(
                  _status!,
                  style: TextStyle(
                    fontSize: 12,
                    color: _status!.toLowerCase().contains('fail')
                        ? WebDeckTheme.accentRed
                        : WebDeckTheme.textSecondary,
                  ),
                ),
              ],
              if (_apiResult != null) ...[
                const SizedBox(height: 10),
                Expanded(
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.35),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: WebDeckTheme.border),
                    ),
                    child: SingleChildScrollView(
                      child: SelectableText(
                        [
                          '${_apiResult!.method} ${_apiResult!.url}',
                          'Status: ${_apiResult!.statusCode ?? _apiResult!.error}',
                          '',
                          _apiResult!.bodyPreview.isEmpty
                              ? '(empty body)'
                              : _apiResult!.bodyPreview,
                        ].join('\n'),
                        style: const TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          color: Colors.white70,
                        ),
                      ),
                    ),
                  ),
                ),
              ] else
                const Spacer(),
              if (_busy)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: LinearProgressIndicator(minHeight: 2),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusChip(String label, bool active, {Color idleColor = WebDeckTheme.accentRed}) {
    final color = active ? WebDeckTheme.accentGreen : idleColor;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(
        active ? '$label · up' : '$label · down',
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}
