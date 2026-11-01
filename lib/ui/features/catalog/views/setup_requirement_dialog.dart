import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import '../../../../data/models/backend_requirement.dart';
import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';
import '../view_models/catalog_view_model.dart';
import 'backend_console_dialog.dart';

class SetupRequirementDialog extends StatefulWidget {
  final InstalledApp app;
  final BackendRequirement requirement;
  final CatalogViewModel viewModel;
  final VoidCallback onProceedToLaunch;

  const SetupRequirementDialog({
    super.key,
    required this.app,
    required this.requirement,
    required this.viewModel,
    required this.onProceedToLaunch,
  });

  @override
  State<SetupRequirementDialog> createState() => _SetupRequirementDialogState();
}

class _SetupRequirementDialogState extends State<SetupRequirementDialog> {
  bool _isStarting = false;
  String? _statusMessage;
  String? _errorMessage;
  List<String> _processLogs = [];
  bool _showLogs = false;

  String get _terminalCommand {
    final req = widget.requirement;
    final path = widget.app.installedPath;
    final parts = <String>[];

    if (req.requiresDotnet && req.dotnetProject != null) {
      final projectFile = File(p.join(path, req.dotnetProject!));
      final workDir = projectFile.existsSync() ? projectFile.parent.path : path;
      final projectArg =
          projectFile.existsSync() ? p.basename(projectFile.path) : req.dotnetProject!;
      parts.add('cd "$workDir" && dotnet run --project $projectArg --launch-profile http');
    }
    if (req.requiresPython && req.pythonScript != null) {
      final scriptFile = File(p.join(path, req.pythonScript!));
      final workDir = scriptFile.existsSync() ? scriptFile.parent.path : path;
      final scriptName =
          scriptFile.existsSync() ? p.basename(scriptFile.path) : req.pythonScript!;
      parts.add('cd "$workDir" && python3 $scriptName');
    } else if (req.requiresNode && req.nodeScript != null) {
      final scriptFile = File(p.join(path, req.nodeScript!));
      final workDir = scriptFile.existsSync() ? scriptFile.parent.path : path;
      final scriptName =
          scriptFile.existsSync() ? p.basename(scriptFile.path) : req.nodeScript!;
      parts.add('cd "$workDir" && node $scriptName');
    }
    if (req.requiresViteDev && req.viteProjectDir != null) {
      final viteDir = req.viteProjectDir == '.' || req.viteProjectDir!.isEmpty
          ? path
          : p.join(path, req.viteProjectDir!);
      final viteCli = p.join(viteDir, 'node_modules', 'vite', 'bin', 'vite.js');
      final port = req.viteDevPort ?? 5173;
      if (File(viteCli).existsSync()) {
        parts.add(
          'cd "$viteDir" && node "$viteCli" --host 127.0.0.1 --port $port',
        );
      } else {
        parts.add(
          'cd "$viteDir" && npm run dev -- --host 127.0.0.1 --port $port',
        );
      }
    }

    if (parts.isEmpty) return 'cd "$path"';
    return parts.join('\n');
  }

  void _copyCommand() {
    Clipboard.setData(ClipboardData(text: _terminalCommand));
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Terminal command copied to clipboard!'),
        backgroundColor: WebDeckTheme.accentGreen,
        duration: Duration(seconds: 2),
      ),
    );
  }

  void _openAppFolder() {
    try {
      final req = widget.requirement;
      final path = widget.app.installedPath;
      var openPath = path;
      if (req.dotnetProject != null) {
        final projectFile = File(p.join(path, req.dotnetProject!));
        if (projectFile.existsSync()) {
          openPath = projectFile.parent.path;
        }
      } else if (req.pythonScript != null) {
        final scriptFile = File(p.join(path, req.pythonScript!));
        if (scriptFile.existsSync()) {
          openPath = scriptFile.parent.path;
        }
      } else if (req.nodeScript != null) {
        final scriptFile = File(p.join(path, req.nodeScript!));
        if (scriptFile.existsSync()) {
          openPath = scriptFile.parent.path;
        }
      } else if (req.viteProjectDir != null) {
        openPath = req.viteProjectDir == '.' || req.viteProjectDir!.isEmpty
            ? path
            : p.join(path, req.viteProjectDir!);
      }
      if (Platform.isMacOS) {
        Process.run('open', [openPath]);
      } else if (Platform.isWindows) {
        Process.run('explorer.exe', [openPath]);
      } else if (Platform.isLinux) {
        Process.run('xdg-open', [openPath]);
      }
    } catch (_) {}
  }

  Set<int> get _requiredPorts => {
        if (widget.requirement.backendPort != null) widget.requirement.backendPort!,
        if (widget.requirement.viteDevPort != null) widget.requirement.viteDevPort!,
      };

  Future<bool> _waitForPorts({required int attempts}) async {
    final ports = _requiredPorts;
    if (ports.isEmpty) return true;

    for (var i = 0; i < attempts; i++) {
      await Future.delayed(const Duration(milliseconds: 500));
      if (!mounted) return false;
      var allUp = true;
      for (final port in ports) {
        if (!await widget.viewModel.isPortListening(port)) {
          allUp = false;
          break;
        }
      }
      if (allUp) return true;
    }
    return false;
  }

  Future<bool> _waitForApiCheck({required int attempts}) async {
    final url = widget.requirement.apiCheckUrl;
    if (url == null) return true;
    for (var i = 0; i < attempts; i++) {
      await Future.delayed(const Duration(milliseconds: 500));
      if (!mounted) return false;
      if (await widget.viewModel.checkApiHealth(url)) return true;
    }
    return false;
  }

  Future<void> _startBackendAutomatically() async {
    setState(() {
      _isStarting = true;
      _statusMessage = 'Launching companion server(s) in background...';
      _errorMessage = null;
      _processLogs = [];
    });

    try {
      await widget.viewModel.startCompanionBackend(
        widget.app,
        requirement: widget.requirement,
      );

      final ports = _requiredPorts;
      if (ports.isNotEmpty) {
        setState(() {
          _statusMessage =
              'Waiting for ports ${ports.join(", ")} to become active...';
        });

        final isListening = await _waitForPorts(attempts: 40);
        if (!isListening) {
          final logs = widget.viewModel.getCompanionLogs(widget.app.id);
          setState(() {
            _isStarting = false;
            _statusMessage = null;
            _errorMessage =
                'Backend started but port(s) ${ports.join(", ")} are not yet responding. Check output logs below.';
            _processLogs = logs;
            _showLogs = true;
          });
          return;
        }
      }

      if (widget.requirement.apiCheckUrl != null) {
        setState(() {
          _statusMessage =
              'Checking API ${widget.requirement.apiCheckUrl}...';
        });
        final apiOk = await _waitForApiCheck(attempts: 20);
        if (!apiOk) {
          final logs = widget.viewModel.getCompanionLogs(widget.app.id);
          setState(() {
            _isStarting = false;
            _statusMessage = null;
            _errorMessage =
                'Ports are up but API check failed for ${widget.requirement.apiCheckUrl}. Check logs / SQL Server connection.';
            _processLogs = logs;
            _showLogs = true;
          });
          return;
        }
      }

      if (!mounted) return;
      Navigator.of(context).pop();
      widget.onProceedToLaunch();
    } catch (e) {
      if (!mounted) return;
      final logs = widget.viewModel.getCompanionLogs(widget.app.id);
      setState(() {
        _isStarting = false;
        _statusMessage = null;
        _errorMessage =
            'Could not start backend: $e\nEnsure .NET SDK, Node/npm, and/or Python 3 are installed.';
        _processLogs = logs;
        _showLogs = true;
      });
    }
  }

  Future<void> _runInTerminal() async {
    setState(() {
      _isStarting = true;
      _statusMessage = 'Opening command in Terminal...';
      _errorMessage = null;
    });

    try {
      final cmd = _terminalCommand;
      if (Platform.isMacOS) {
        final escaped = cmd.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        await Process.run('osascript', [
          '-e',
          'tell application "Terminal" to do script "$escaped"',
          '-e',
          'tell application "Terminal" to activate',
        ]);
      } else if (Platform.isWindows) {
        await Process.start('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', cmd]);
      } else if (Platform.isLinux) {
        await Process.start('x-terminal-emulator', ['-e', 'bash -c "$cmd; exec bash"']);
      }

      final ports = _requiredPorts;
      if (ports.isNotEmpty) {
        setState(() {
          _statusMessage =
              'Waiting for ports ${ports.join(", ")} to become active...';
        });

        final isListening = await _waitForPorts(attempts: 40);
        if (isListening) {
          final apiOk = await _waitForApiCheck(attempts: 20);
          if (apiOk) {
            if (!mounted) return;
            Navigator.of(context).pop();
            widget.onProceedToLaunch();
            return;
          }
        }
      }

      if (!mounted) return;
      setState(() {
        _isStarting = false;
        _statusMessage = 'Terminal opened. When ready, click Launch Anyway.';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isStarting = false;
        _errorMessage = 'Could not open Terminal: $e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final req = widget.requirement;

    return Dialog(
      backgroundColor: WebDeckTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: WebDeckTheme.border),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 580, maxHeight: 680),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color(0xFFD29922).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFD29922).withValues(alpha: 0.3)),
                    ),
                    child: const Icon(
                      Icons.settings_suggest_rounded,
                      color: Color(0xFFD29922),
                      size: 26,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                widget.app.name,
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                  color: WebDeckTheme.textPrimary,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: const Color(0xFFD29922).withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: const Color(0xFFD29922).withValues(alpha: 0.4)),
                              ),
                              child: const Text(
                                'BACKEND REQUIRED',
                                style: TextStyle(
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                  color: Color(0xFFD29922),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        const Text(
                          'Companion Server & Local Database Setup',
                          style: TextStyle(
                            fontSize: 13,
                            color: WebDeckTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: _isStarting ? null : () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Description banner
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: WebDeckTheme.surfaceSubtle,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: WebDeckTheme.border),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.info_outline, size: 18, color: WebDeckTheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        req.setupInstructions ??
                            'This application needs a local companion server (.NET API, Python, Node, and/or Vite). WebDeck can start it for you or you can run the commands in a terminal.',
                        style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary, height: 1.4),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),

              // Detected Details List
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Requirements summary grid
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.25),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: WebDeckTheme.border),
                        ),
                        child: Column(
                          children: [
                            if (req.requiresDotnet && req.dotnetProject != null)
                              _buildDetailRow(
                                icon: Icons.dns_rounded,
                                label: '.NET Project',
                                value: req.dotnetProject!,
                                badge: '.NET',
                                badgeColor: const Color(0xFF512BD4),
                              ),
                            if (req.requiresPython && req.pythonScript != null)
                              _buildDetailRow(
                                icon: Icons.terminal_rounded,
                                label: 'Python Script',
                                value: req.pythonScript!,
                                badge: 'Python 3',
                                badgeColor: const Color(0xFF3776AB),
                              ),
                            if (req.requiresNode && req.nodeScript != null)
                              _buildDetailRow(
                                icon: Icons.code,
                                label: 'Node Script',
                                value: req.nodeScript!,
                                badge: 'Node.js',
                                badgeColor: const Color(0xFF68A063),
                              ),
                            if (req.requiresViteDev && req.viteProjectDir != null)
                              _buildDetailRow(
                                icon: Icons.flash_on_rounded,
                                label: 'Vite UI',
                                value: 'npm run dev (${req.viteProjectDir})',
                                badge: 'Vite',
                                badgeColor: const Color(0xFF646CFF),
                              ),
                            if (req.hasDatabase)
                              _buildDetailRow(
                                icon: Icons.storage_rounded,
                                label: 'Database',
                                value: req.databasePath ??
                                    (req.usesSqlServer ? 'SQL Server' : 'SQLite Disk DB'),
                                badge: req.usesSqlServer ? 'SQL Server' : 'SQLite',
                                badgeColor: req.usesSqlServer
                                    ? const Color(0xFFCC2927)
                                    : const Color(0xFF003B57),
                              ),
                            if (req.backendPort != null)
                              _buildDetailRow(
                                icon: Icons.lan_outlined,
                                label: 'API Port',
                                value: 'http://127.0.0.1:${req.backendPort}',
                                badge: 'Inactive',
                                badgeColor: WebDeckTheme.accentRed,
                              ),
                            if (req.viteDevPort != null)
                              _buildDetailRow(
                                icon: Icons.language_rounded,
                                label: 'UI Port',
                                value: 'http://127.0.0.1:${req.viteDevPort}',
                                badge: 'Inactive',
                                badgeColor: WebDeckTheme.accentRed,
                              ),
                            if (req.apiCheckUrl != null)
                              _buildDetailRow(
                                icon: Icons.health_and_safety_outlined,
                                label: 'API Check',
                                value: req.apiCheckUrl!,
                                badge: 'Health',
                                badgeColor: const Color(0xFF1F6FEB),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),

                      // Terminal Command Snippet
                      const Text(
                        'Manual Terminal Command:',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: WebDeckTheme.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF0D1117),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: WebDeckTheme.border),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: SelectableText(
                                _terminalCommand,
                                style: const TextStyle(
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  color: Color(0xFF58A6FF),
                                ),
                              ),
                            ),
                            IconButton(
                              icon: const Icon(Icons.copy, size: 16),
                              tooltip: 'Copy Command',
                              onPressed: _copyCommand,
                              visualDensity: VisualDensity.compact,
                            ),
                          ],
                        ),
                      ),

                      // Starting status indicator
                      if (_isStarting) ...[
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _statusMessage ?? 'Starting...',
                                style: const TextStyle(fontSize: 12, color: WebDeckTheme.primary),
                              ),
                            ),
                          ],
                        ),
                      ],

                      // Error message if any
                      if (_errorMessage != null) ...[
                        const SizedBox(height: 12),
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: WebDeckTheme.accentRed.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: WebDeckTheme.accentRed.withValues(alpha: 0.3)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Icon(Icons.error_outline, size: 16, color: WebDeckTheme.accentRed),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      _errorMessage!,
                                      style: const TextStyle(fontSize: 11, color: WebDeckTheme.accentRed),
                                    ),
                                  ),
                                ],
                              ),
                              if (_processLogs.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                InkWell(
                                  onTap: () => setState(() => _showLogs = !_showLogs),
                                  child: Row(
                                    children: [
                                      Text(
                                        _showLogs ? 'Hide Output Logs' : 'Show Output Logs (${_processLogs.length} lines)',
                                        style: const TextStyle(fontSize: 11, color: Color(0xFF58A6FF), fontWeight: FontWeight.w600),
                                      ),
                                      Icon(_showLogs ? Icons.arrow_drop_up : Icons.arrow_drop_down, size: 16, color: const Color(0xFF58A6FF)),
                                    ],
                                  ),
                                ),
                                if (_showLogs) ...[
                                  const SizedBox(height: 6),
                                  Container(
                                    constraints: const BoxConstraints(maxHeight: 120),
                                    width: double.infinity,
                                    padding: const EdgeInsets.all(8),
                                    decoration: BoxDecoration(
                                      color: Colors.black,
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                    child: SingleChildScrollView(
                                      child: SelectableText(
                                        _processLogs.join('\n'),
                                        style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.white70),
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 18),

              // Action buttons footer
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 8,
                runSpacing: 10,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _openAppFolder,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: WebDeckTheme.textPrimary,
                          side: const BorderSide(color: WebDeckTheme.border),
                        ),
                        icon: const Icon(Icons.folder_open, size: 15),
                        label: const Text('Open Folder', style: TextStyle(fontSize: 12)),
                      ),
                      OutlinedButton.icon(
                        onPressed: _isStarting
                            ? null
                            : () {
                                showDialog(
                                  context: context,
                                  builder: (ctx) => BackendConsoleDialog(
                                    app: widget.app,
                                    requirement: widget.requirement,
                                    viewModel: widget.viewModel,
                                  ),
                                );
                              },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF512BD4),
                          side: BorderSide(color: const Color(0xFF512BD4).withValues(alpha: 0.4)),
                        ),
                        icon: const Icon(Icons.dns_rounded, size: 15),
                        label: const Text('DB / Test API', style: TextStyle(fontSize: 12)),
                      ),
                      OutlinedButton.icon(
                        onPressed: _isStarting ? null : _runInTerminal,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF58A6FF),
                          side: BorderSide(color: const Color(0xFF58A6FF).withValues(alpha: 0.4)),
                        ),
                        icon: const Icon(Icons.terminal, size: 15),
                        label: const Text('Run in Terminal', style: TextStyle(fontSize: 12)),
                      ),
                    ],
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      TextButton(
                        onPressed: _isStarting
                            ? null
                            : () {
                                Navigator.of(context).pop();
                                widget.onProceedToLaunch();
                              },
                        child: const Text('Launch Anyway', style: TextStyle(fontSize: 12)),
                      ),
                      ElevatedButton.icon(
                        onPressed: _isStarting ? null : _startBackendAutomatically,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: WebDeckTheme.primary,
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        ),
                        icon: const Icon(Icons.play_arrow_rounded, size: 16),
                        label: const Text('Start Backend & Launch', style: TextStyle(fontSize: 12)),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow({
    required IconData icon,
    required String label,
    required String value,
    required String badge,
    required Color badgeColor,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 16, color: WebDeckTheme.textSecondary),
          const SizedBox(width: 10),
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: WebDeckTheme.textPrimary),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: badgeColor.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: badgeColor.withValues(alpha: 0.4)),
            ),
            child: Text(
              badge,
              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: badgeColor),
            ),
          ),
        ],
      ),
    );
  }
}
