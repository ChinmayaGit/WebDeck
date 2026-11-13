import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';
import '../view_models/catalog_view_model.dart';

class InstallAppDialog extends StatefulWidget {
  final CatalogViewModel viewModel;
  final void Function(InstalledApp app)? onInstalledLaunch;

  const InstallAppDialog({
    super.key,
    required this.viewModel,
    this.onInstalledLaunch,
  });

  @override
  State<InstallAppDialog> createState() => _InstallAppDialogState();
}

class _InstallAppDialogState extends State<InstallAppDialog>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _urlController = TextEditingController();
  final _nameController = TextEditingController();
  final _tokenController = TextEditingController();
  bool _showTokenField = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _urlController.dispose();
    _nameController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  bool get _isInstalling => _busy || widget.viewModel.isInstalling;

  InstalledApp? _findDuplicateApp({String? url, String? name}) {
    final apps = widget.viewModel.apps;
    if (url != null && url.isNotEmpty) {
      final clean = url.trim().toLowerCase().replaceAll('.git', '').replaceAll('https://github.com/', '');
      for (final a in apps) {
        final aClean = a.repoUrl.toLowerCase().replaceAll('.git', '').replaceAll('https://github.com/', '');
        if (aClean.isNotEmpty && (aClean == clean || aClean.endsWith(clean) || clean.endsWith(aClean))) {
          return a;
        }
      }
    }
    if (name != null && name.trim().isNotEmpty) {
      final cleanName = name.trim().toLowerCase();
      for (final a in apps) {
        if (a.name.toLowerCase() == cleanName || a.id.toLowerCase() == cleanName) {
          return a;
        }
      }
    }
    return null;
  }

  Future<bool> _confirmDuplicate(InstalledApp existing) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: WebDeckTheme.border),
        ),
        title: Row(
          children: [
            const Icon(Icons.sync_problem_rounded, color: Color(0xFFD29922)),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'Duplicate App Found',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close, size: 20),
              onPressed: () => Navigator.of(ctx).pop(false),
            ),
          ],
        ),
        content: Text(
          '"${existing.name}" is already installed on your WebDeck shelf.\n\nDo you want to update and replace it with this version?',
          style: const TextStyle(fontSize: 13, color: WebDeckTheme.textSecondary, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: WebDeckTheme.primary,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Replace & Update'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _completeInstall(
    Future<bool> future,
    String successMessage,
  ) async {
    if (_isInstalling) return;
    setState(() => _busy = true);

    var success = false;
    try {
      success = await future;
    } catch (_) {
      success = false;
    }
    if (!mounted) return;
    if (success) {
      final installedApp = widget.viewModel.lastInstalledApp;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).pop();
      messenger.showSnackBar(
        SnackBar(
          content: Text(successMessage),
          backgroundColor: WebDeckTheme.accentGreen,
        ),
      );
      if (installedApp != null && widget.onInstalledLaunch != null) {
        widget.onInstalledLaunch!(installedApp);
      }
      return;
    }
    setState(() => _busy = false);
  }

  void _onInstallRemote() async {
    if (_isInstalling) return;
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter a GitHub repository or URL'),
        ),
      );
      return;
    }

    final duplicate = _findDuplicateApp(url: url, name: _nameController.text.trim());
    if (duplicate != null) {
      final confirm = await _confirmDuplicate(duplicate);
      if (!confirm) return;
    }

    _completeInstall(
      widget.viewModel.installFromSource(
        sourceUrl: url,
        token: _tokenController.text.trim().isNotEmpty
            ? _tokenController.text.trim()
            : null,
        customName: _nameController.text.trim().isNotEmpty
            ? _nameController.text.trim()
            : null,
      ),
      'App successfully installed to WebDeck shelf!',
    );
  }

  void _onPickLocalZip() async {
    if (_isInstalling) return;
    try {
      final result = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['zip'],
      );
      if (!mounted || result == null || result.path == null) return;

      final zipName = p.basenameWithoutExtension(result.path!);
      final duplicate = _findDuplicateApp(
        name: _nameController.text.trim().isNotEmpty ? _nameController.text.trim() : zipName,
      );
      if (duplicate != null) {
        final confirm = await _confirmDuplicate(duplicate);
        if (!confirm) return;
      }

      await _completeInstall(
        widget.viewModel.installFromLocalZipFile(
          zipFile: File(result.path!),
          customName: _nameController.text.trim().isNotEmpty
              ? _nameController.text.trim()
              : null,
        ),
        'Local zip bundle installed!',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed to pick file: $e')));
      }
    }
  }

  void _onPickLocalFolder() async {
    if (_isInstalling) return;
    try {
      final selectedDirectory = await FilePicker.getDirectoryPath();
      if (!mounted || selectedDirectory == null) return;

      final folderName = p.basename(selectedDirectory);
      final duplicate = _findDuplicateApp(
        name: _nameController.text.trim().isNotEmpty ? _nameController.text.trim() : folderName,
      );
      if (duplicate != null) {
        final confirm = await _confirmDuplicate(duplicate);
        if (!confirm) return;
      }

      await _completeInstall(
        widget.viewModel.installFromLocalDirectory(
          directory: Directory(selectedDirectory),
          customName: _nameController.text.trim().isNotEmpty
              ? _nameController.text.trim()
              : null,
        ),
        'Local build directory installed!',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to pick directory: $e')));
      }
    }
  }

  void _onInstallDemo() {
    if (_isInstalling) return;
    _completeInstall(
      widget.viewModel.installDemoApp(),
      'Neon Arcade Demo installed into your WebDeck shelf!',
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.viewModel,
      builder: (context, _) {
        final isInstalling = _isInstalling;
        final progress = widget.viewModel.currentInstallProgress;
        final maxHeight = MediaQuery.sizeOf(context).height * 0.92;

        return PopScope(
          canPop: !isInstalling,
          child: Dialog(
            insetPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 20,
            ),
            backgroundColor: WebDeckTheme.surface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(color: WebDeckTheme.border),
            ),
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 580, maxHeight: maxHeight),
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
                children: [
                  // Header Row
                  Row(
                    children: [
                      const Icon(
                        Icons.download_rounded,
                        color: WebDeckTheme.primary,
                        size: 24,
                      ),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Install Web App',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: WebDeckTheme.textPrimary,
                          ),
                        ),
                      ),
                      if (!isInstalling)
                        IconButton(
                          icon: const Icon(Icons.close, size: 20),
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  // Supported technologies badge
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      _techChip('React'),
                      _techChip('Angular'),
                      _techChip('Flutter Web'),
                      _techChip('Vue'),
                      _techChip('Svelte'),
                      _techChip('Next.js Export'),
                      _techChip('HTML5 / WASM'),
                    ],
                  ),
                  const SizedBox(height: 16),

                  if (isInstalling) ...[
                    // Installation Progress Box
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: WebDeckTheme.surfaceSubtle,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: WebDeckTheme.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Icon(
                                Icons.cloud_download_rounded,
                                color: WebDeckTheme.primary,
                                size: 20,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  progress?.message ??
                                      'Downloading & installing…',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: WebDeckTheme.textPrimary,
                                  ),
                                ),
                              ),
                              if (progress != null && progress.progress > 0) ...[
                                const SizedBox(width: 8),
                                Text(
                                  '${(progress.progress * 100).toInt()}%',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: WebDeckTheme.primary,
                                  ),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 14),
                          LinearProgressIndicator(
                            value: progress?.progress ?? 0.0,
                            backgroundColor: WebDeckTheme.border,
                            valueColor: const AlwaysStoppedAnimation(
                              WebDeckTheme.primary,
                            ),
                            borderRadius: BorderRadius.circular(4),
                            minHeight: 6,
                          ),
                        ],
                      ),
                    ),
                  ] else ...[
                    // Tabs: GitHub / Remote vs Local Sideload
                    TabBar(
                      controller: _tabController,
                      indicatorColor: WebDeckTheme.primary,
                      labelColor: WebDeckTheme.primary,
                      unselectedLabelColor: WebDeckTheme.textSecondary,
                      tabs: const [
                        Tab(
                          icon: Icon(Icons.cloud_download, size: 18),
                          text: 'GitHub / URL',
                        ),
                        Tab(
                          icon: Icon(Icons.folder_open, size: 18),
                          text: 'Local Sideload',
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),

                    SizedBox(
                      height: 220,
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          // Tab 1: Remote GitHub / URL
                          SingleChildScrollView(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                TextField(
                                  controller: _urlController,
                                  decoration: const InputDecoration(
                                    labelText: 'GitHub Repo or Release Zip URL',
                                    hintText:
                                        'owner/repo or https://github.com/...',
                                    prefixIcon: Icon(Icons.link, size: 20),
                                  ),
                                ),
                                const SizedBox(height: 10),
                                TextField(
                                  controller: _nameController,
                                  decoration: const InputDecoration(
                                    labelText: 'Custom Title (Optional)',
                                    hintText: 'Auto-detected if left empty',
                                    prefixIcon: Icon(
                                      Icons.label_outline,
                                      size: 20,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                InkWell(
                                  onTap: () => setState(
                                    () => _showTokenField = !_showTokenField,
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        _showTokenField
                                            ? Icons.expand_less
                                            : Icons.expand_more,
                                        size: 16,
                                        color: WebDeckTheme.primary,
                                      ),
                                      const SizedBox(width: 4),
                                      const Expanded(
                                        child: Text(
                                          'GitHub Token (for private repos)',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: WebDeckTheme.primary,
                                            fontWeight: FontWeight.w500,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                if (_showTokenField) ...[
                                  const SizedBox(height: 8),
                                  TextField(
                                    controller: _tokenController,
                                    obscureText: true,
                                    decoration: const InputDecoration(
                                      labelText: 'Personal Access Token',
                                      hintText: 'ghp_...',
                                      prefixIcon: Icon(Icons.key, size: 20),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),

                          // Tab 2: Local Sideload (Pick Folder or Zip)
                          SingleChildScrollView(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'Import a compiled build directly from your computer (e.g. dist/, build/web/, or a .zip archive):',
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: WebDeckTheme.textSecondary,
                                  ),
                                ),
                                const SizedBox(height: 16),
                                LayoutBuilder(
                                  builder: (context, constraints) {
                                    final stack = constraints.maxWidth < 420;
                                    final folderButton = OutlinedButton.icon(
                                      style: OutlinedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(
                                          vertical: 14,
                                        ),
                                        side: const BorderSide(
                                          color: WebDeckTheme.border,
                                        ),
                                      ),
                                      onPressed: _onPickLocalFolder,
                                      icon: const Icon(Icons.folder),
                                      label: const Text('Pick Build Folder'),
                                    );
                                    final zipButton = OutlinedButton.icon(
                                      style: OutlinedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(
                                          vertical: 14,
                                        ),
                                        side: const BorderSide(
                                          color: WebDeckTheme.border,
                                        ),
                                      ),
                                      onPressed: _onPickLocalZip,
                                      icon: const Icon(Icons.archive),
                                      label: const Text('Pick .zip Archive'),
                                    );
                                    if (stack) {
                                      return Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: [
                                          folderButton,
                                          const SizedBox(height: 8),
                                          zipButton,
                                        ],
                                      );
                                    }
                                    return Row(
                                      children: [
                                        Expanded(child: folderButton),
                                        const SizedBox(width: 12),
                                        Expanded(child: zipButton),
                                      ],
                                    );
                                  },
                                ),
                                const SizedBox(height: 16),
                                TextField(
                                  controller: _nameController,
                                  decoration: const InputDecoration(
                                    labelText: 'Custom Title (Optional)',
                                    hintText: 'Auto-detected from manifest or folder name',
                                    prefixIcon: Icon(
                                      Icons.label_outline,
                                      size: 20,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),

                    if (widget.viewModel.errorMessage != null) ...[
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: WebDeckTheme.accentRed.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: WebDeckTheme.accentRed.withValues(
                              alpha: 0.3,
                            ),
                          ),
                        ),
                        child: Text(
                          widget.viewModel.errorMessage!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: WebDeckTheme.accentRed,
                          ),
                        ),
                      ),
                    ],
                  ],

                  const SizedBox(height: 16),
                  _buildActions(),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildActions() {
    final busy = _isInstalling;
    return LayoutBuilder(
      builder: (context, constraints) {
        final stack = constraints.maxWidth < 460;
        final installButton = ElevatedButton.icon(
          onPressed: busy ? null : _onInstallRemote,
          style: ElevatedButton.styleFrom(
            disabledBackgroundColor: WebDeckTheme.primary.withValues(
              alpha: 0.75,
            ),
            disabledForegroundColor: Colors.white,
            minimumSize: stack ? const Size.fromHeight(48) : null,
          ),
          icon: busy
              ? const Icon(Icons.downloading_rounded, size: 18)
              : const Icon(Icons.download, size: 18),
          label: Text(busy ? 'Installing…' : 'Fetch & Install'),
        );
        final demoButton = TextButton.icon(
          onPressed: busy ? null : _onInstallDemo,
          icon: const Icon(Icons.sports_esports, size: 18),
          label: const Text('Try Demo App'),
        );
        final cancelButton = TextButton(
          onPressed: busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        );

        if (stack) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              installButton,
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(child: demoButton),
                  Expanded(child: cancelButton),
                ],
              ),
            ],
          );
        }

        return Row(
          children: [
            demoButton,
            const Spacer(),
            cancelButton,
            const SizedBox(width: 8),
            installButton,
          ],
        );
      },
    );
  }

  Widget _techChip(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: WebDeckTheme.surfaceSubtle,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: WebDeckTheme.border),
      ),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 10,
          color: WebDeckTheme.textSecondary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
