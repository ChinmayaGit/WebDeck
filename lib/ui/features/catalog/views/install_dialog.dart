import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../../../core/theme.dart';
import '../view_models/catalog_view_model.dart';

class InstallAppDialog extends StatefulWidget {
  final CatalogViewModel viewModel;

  const InstallAppDialog({super.key, required this.viewModel});

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

  void _onInstallRemote() async {
    final url = _urlController.text.trim();
    if (url.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a GitHub repository or URL')),
      );
      return;
    }

    final success = await widget.viewModel.installFromSource(
      sourceUrl: url,
      token: _tokenController.text.trim().isNotEmpty
          ? _tokenController.text.trim()
          : null,
      customName: _nameController.text.trim().isNotEmpty
          ? _nameController.text.trim()
          : null,
    );

    if (mounted && success) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('App successfully installed to WebDeck shelf!'),
          backgroundColor: WebDeckTheme.accentGreen,
        ),
      );
    }
  }

  void _onPickLocalZip() async {
    try {
      final result = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['zip'],
      );
      if (result != null && result.path != null) {
        final file = File(result.path!);
        final success = await widget.viewModel.installFromLocalZipFile(
          zipFile: file,
          customName: _nameController.text.trim().isNotEmpty
              ? _nameController.text.trim()
              : null,
        );
        if (mounted && success) {
          Navigator.of(context).pop();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Local zip bundle installed!'),
              backgroundColor: WebDeckTheme.accentGreen,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to pick file: $e')),
        );
      }
    }
  }

  void _onPickLocalFolder() async {
    try {
      final selectedDirectory = await FilePicker.getDirectoryPath();
      if (selectedDirectory != null) {
        final dir = Directory(selectedDirectory);
        final success = await widget.viewModel.installFromLocalDirectory(
          directory: dir,
          customName: _nameController.text.trim().isNotEmpty
              ? _nameController.text.trim()
              : null,
        );
        if (mounted && success) {
          Navigator.of(context).pop();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Local build directory installed!'),
              backgroundColor: WebDeckTheme.accentGreen,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to pick directory: $e')),
        );
      }
    }
  }

  void _onInstallDemo() async {
    final success = await widget.viewModel.installDemoApp();
    if (mounted && success) {
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Neon Arcade Demo installed into your WebDeck shelf!'),
          backgroundColor: WebDeckTheme.accentGreen,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isInstalling = widget.viewModel.isInstalling;
    final progress = widget.viewModel.currentInstallProgress;

    return Dialog(
      backgroundColor: WebDeckTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: WebDeckTheme.border),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 580),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.download_rounded, color: WebDeckTheme.primary, size: 24),
                      SizedBox(width: 10),
                      Text(
                        'Install Web App',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: WebDeckTheme.textPrimary,
                        ),
                      ),
                    ],
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
                          const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              progress?.message ?? 'Installing application...',
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                                color: WebDeckTheme.textPrimary,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      LinearProgressIndicator(
                        value: progress?.progress ?? 0.0,
                        backgroundColor: WebDeckTheme.border,
                        valueColor: const AlwaysStoppedAnimation(WebDeckTheme.primary),
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
                    Tab(icon: Icon(Icons.cloud_download, size: 18), text: 'GitHub / URL'),
                    Tab(icon: Icon(Icons.folder_open, size: 18), text: 'Local Sideload'),
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
                                hintText: 'owner/repo or https://github.com/...',
                                prefixIcon: Icon(Icons.link, size: 20),
                              ),
                            ),
                            const SizedBox(height: 10),
                            TextField(
                              controller: _nameController,
                              decoration: const InputDecoration(
                                labelText: 'Custom Title (Optional)',
                                hintText: 'Auto-detected if left empty',
                                prefixIcon: Icon(Icons.label_outline, size: 20),
                              ),
                            ),
                            const SizedBox(height: 8),
                            InkWell(
                              onTap: () => setState(() => _showTokenField = !_showTokenField),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    _showTokenField ? Icons.expand_less : Icons.expand_more,
                                    size: 16,
                                    color: WebDeckTheme.primary,
                                  ),
                                  const SizedBox(width: 4),
                                  const Text(
                                    'GitHub Token (for private repos)',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: WebDeckTheme.primary,
                                      fontWeight: FontWeight.w500,
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
                              style: TextStyle(fontSize: 13, color: WebDeckTheme.textSecondary),
                            ),
                            const SizedBox(height: 16),
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton.icon(
                                    style: OutlinedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(vertical: 14),
                                      side: const BorderSide(color: WebDeckTheme.border),
                                    ),
                                    onPressed: _onPickLocalFolder,
                                    icon: const Icon(Icons.folder),
                                    label: const Text('Pick Build Folder'),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: OutlinedButton.icon(
                                    style: OutlinedButton.styleFrom(
                                      padding: const EdgeInsets.symmetric(vertical: 14),
                                      side: const BorderSide(color: WebDeckTheme.border),
                                    ),
                                    onPressed: _onPickLocalZip,
                                    icon: const Icon(Icons.archive),
                                    label: const Text('Pick .zip Archive'),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            TextField(
                              controller: _nameController,
                              decoration: const InputDecoration(
                                labelText: 'Custom Title (Optional)',
                                hintText: 'Auto-detected from manifest or folder name',
                                prefixIcon: Icon(Icons.label_outline, size: 20),
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
                        color: WebDeckTheme.accentRed.withValues(alpha: 0.3),
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

                const SizedBox(height: 16),
                // Footer Buttons
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    TextButton.icon(
                      onPressed: _onInstallDemo,
                      icon: const Icon(Icons.sports_esports, size: 18),
                      label: const Text('Try Demo App'),
                    ),
                    Row(
                      children: [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: const Text('Cancel'),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton.icon(
                          onPressed: _onInstallRemote,
                          icon: const Icon(Icons.download, size: 18),
                          label: const Text('Fetch & Install'),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
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
