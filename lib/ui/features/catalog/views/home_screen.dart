import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';
import '../../player/views/webview_player_screen.dart';
import '../view_models/catalog_view_model.dart';
import 'app_card.dart';
import 'install_dialog.dart';
import 'setup_requirement_dialog.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  void _showInstallDialog(BuildContext context, CatalogViewModel viewModel) {
    showDialog(
      context: context,
      barrierDismissible: !viewModel.isInstalling,
      builder: (ctx) => InstallAppDialog(viewModel: viewModel),
    );
  }

  void _launchApp(BuildContext context, CatalogViewModel viewModel, InstalledApp app) async {
    // Check if app has companion backend or database requirements
    final req = await viewModel.resolveBackendRequirement(app);
    final effectiveApp = req != null && app.backendRequirement == null
        ? app.copyWith(backendRequirement: req)
        : app;

    if (req != null && req.hasRequirements) {
      final port = req.backendPort;
      var isPortActive = false;
      if (port != null) {
        isPortActive = await viewModel.isPortListening(port);
      } else if (viewModel.isCompanionRunning(app.id)) {
        isPortActive = true;
      }

      if (!isPortActive) {
        if (!context.mounted) return;
        showDialog(
          context: context,
          builder: (ctx) => SetupRequirementDialog(
            app: effectiveApp,
            requirement: req,
            viewModel: viewModel,
            onProceedToLaunch: () => _executeLaunch(context, viewModel, effectiveApp),
          ),
        );
        return;
      }
    }

    if (!context.mounted) return;
    _executeLaunch(context, viewModel, effectiveApp);
  }

  void _executeLaunch(BuildContext context, CatalogViewModel viewModel, InstalledApp app) async {
    try {
      final instance = await viewModel.launchApp(app);
      if (!context.mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (ctx) => WebViewPlayerScreen(
            app: app,
            launchUrl: instance.launchUrl,
            port: instance.port,
          ),
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to launch ${app.name}: $e'),
          backgroundColor: WebDeckTheme.accentRed,
        ),
      );
    }
  }

  void _openInExternalBrowser(BuildContext context, CatalogViewModel viewModel, InstalledApp app) async {
    final req = await viewModel.resolveBackendRequirement(app);
    final effectiveApp = req != null && app.backendRequirement == null
        ? app.copyWith(backendRequirement: req)
        : app;

    if (req != null && req.hasRequirements) {
      final port = req.backendPort;
      var isPortActive = false;
      if (port != null) {
        isPortActive = await viewModel.isPortListening(port);
      } else if (viewModel.isCompanionRunning(app.id)) {
        isPortActive = true;
      }

      if (!isPortActive) {
        if (!context.mounted) return;
        showDialog(
          context: context,
          builder: (ctx) => SetupRequirementDialog(
            app: effectiveApp,
            requirement: req,
            viewModel: viewModel,
            onProceedToLaunch: () => _executeOpenInExternalBrowser(viewModel, effectiveApp),
          ),
        );
        return;
      }
    }

    if (!context.mounted) return;
    _executeOpenInExternalBrowser(viewModel, effectiveApp);
  }

  void _executeOpenInExternalBrowser(CatalogViewModel viewModel, InstalledApp app) async {
    final instance = await viewModel.launchApp(app);
    final uri = Uri.parse(instance.launchUrl);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _onUpdateIcon(BuildContext context, CatalogViewModel viewModel, InstalledApp app) async {
    try {
      final result = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['png', 'jpg', 'jpeg', 'svg', 'ico', 'webp'],
      );
      if (result != null && result.path != null) {
        final success = await viewModel.updateAppIcon(app.id, File(result.path!));
        if (context.mounted && success) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Updated icon for ${app.name}!'),
              backgroundColor: WebDeckTheme.accentGreen,
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update icon: $e')),
        );
      }
    }
  }

  void _onCheckUpdate(BuildContext context, CatalogViewModel viewModel, InstalledApp app) async {
    final success = await viewModel.checkAndUpdateApp(app.id);
    if (context.mounted) {
      if (success) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${app.name} updated to latest build!'),
            backgroundColor: WebDeckTheme.accentGreen,
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Update failed: ${viewModel.errorMessage}'),
            backgroundColor: WebDeckTheme.accentRed,
          ),
        );
      }
    }
  }

  void _exportBackup(BuildContext context, CatalogViewModel viewModel) async {
    try {
      final destDirPath = await FilePicker.getDirectoryPath();
      if (destDirPath != null) {
        final backupFile = await viewModel.exportBackup(Directory(destDirPath));
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Backup exported successfully: ${backupFile.path}'),
              backgroundColor: WebDeckTheme.accentGreen,
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Backup export failed: $e')),
        );
      }
    }
  }

  void _restoreBackup(BuildContext context, CatalogViewModel viewModel) async {
    try {
      final result = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: ['zip'],
      );
      if (result != null && result.path != null) {
        final count = await viewModel.restoreBackup(File(result.path!));
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Successfully restored $count apps from backup!'),
              backgroundColor: WebDeckTheme.accentGreen,
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Restore failed: $e')),
        );
      }
    }
  }

  void _confirmUninstall(BuildContext context, CatalogViewModel viewModel, InstalledApp app) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: Text('Uninstall ${app.name}?'),
        content: Text(
          'This will delete all sandboxed files from your local storage (${app.installedPath}).',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: WebDeckTheme.accentRed),
            onPressed: () {
              Navigator.of(ctx).pop();
              viewModel.uninstallApp(app.id);
            },
            child: const Text('Uninstall'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final viewModel = context.watch<CatalogViewModel>();
    final apps = viewModel.filteredApps;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset(
                'assets/icons/app_icon.png',
                width: 32,
                height: 32,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: WebDeckTheme.primary.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: WebDeckTheme.primary.withValues(alpha: 0.3),
                    ),
                  ),
                  child: const Icon(
                    Icons.rocket_launch,
                    color: WebDeckTheme.primary,
                    size: 18,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            const Text('WebDeck'),
          ],
        ),
        actions: [
          // Backup & Restore Popup Menu
          PopupMenuButton<String>(
            tooltip: 'Backup & Restore',
            icon: const Icon(Icons.backup_rounded, size: 20),
            color: WebDeckTheme.surface,
            onSelected: (val) {
              if (val == 'export') {
                _exportBackup(context, viewModel);
              } else if (val == 'restore') {
                _restoreBackup(context, viewModel);
              }
            },
            itemBuilder: (ctx) => [
              const PopupMenuItem(
                value: 'export',
                child: Row(
                  children: [
                    Icon(Icons.file_upload_outlined, size: 18),
                    SizedBox(width: 8),
                    Text('Export All Apps Backup (.zip)'),
                  ],
                ),
              ),
              const PopupMenuItem(
                value: 'restore',
                child: Row(
                  children: [
                    Icon(Icons.file_download_outlined, size: 18),
                    SizedBox(width: 8),
                    Text('Restore Apps from Backup (.zip)'),
                  ],
                ),
              ),
            ],
          ),
          IconButton(
            tooltip: 'Quick Demo',
            onPressed: () => viewModel.installDemoApp(),
            icon: const Icon(Icons.sports_esports, size: 20),
          ),
          const SizedBox(width: 4),
          ElevatedButton.icon(
            onPressed: () => _showInstallDialog(context, viewModel),
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Install App'),
          ),
          const SizedBox(width: 16),
        ],
      ),
      body: Column(
        children: [
          // Subheader Toolbar: Search + Mode Switcher + Sort
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            decoration: const BoxDecoration(
              color: WebDeckTheme.surface,
              border: Border(bottom: BorderSide(color: WebDeckTheme.border)),
            ),
            child: Row(
              children: [
                // Search Input
                Expanded(
                  child: SizedBox(
                    height: 38,
                    child: TextField(
                      onChanged: viewModel.setSearchQuery,
                      decoration: InputDecoration(
                        hintText: 'Search installed shelf apps...',
                        prefixIcon: const Icon(Icons.search, size: 18),
                        contentPadding: const EdgeInsets.symmetric(vertical: 0),
                        suffixIcon: viewModel.searchQuery.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear, size: 16),
                                onPressed: () => viewModel.setSearchQuery(''),
                              )
                            : null,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),

                // Sort Dropdown
                Container(
                  height: 38,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  decoration: BoxDecoration(
                    color: WebDeckTheme.surfaceSubtle,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: WebDeckTheme.border),
                  ),
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<AppSortOption>(
                      value: viewModel.sortOption,
                      dropdownColor: WebDeckTheme.surface,
                      icon: const Icon(Icons.sort, size: 18),
                      style: const TextStyle(fontSize: 12, color: WebDeckTheme.textPrimary),
                      onChanged: (opt) {
                        if (opt != null) viewModel.setSortOption(opt);
                      },
                      items: const [
                        DropdownMenuItem(
                          value: AppSortOption.dateNewest,
                          child: Text('Newest First'),
                        ),
                        DropdownMenuItem(
                          value: AppSortOption.dateOldest,
                          child: Text('Oldest First'),
                        ),
                        DropdownMenuItem(
                          value: AppSortOption.nameAsc,
                          child: Text('Name (A-Z)'),
                        ),
                        DropdownMenuItem(
                          value: AppSortOption.nameDesc,
                          child: Text('Name (Z-A)'),
                        ),
                        DropdownMenuItem(
                          value: AppSortOption.sizeLargest,
                          child: Text('Largest Size'),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 10),

                // View Mode Switcher: Grid, List, Icon-Only
                Container(
                  height: 38,
                  decoration: BoxDecoration(
                    color: WebDeckTheme.surfaceSubtle,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: WebDeckTheme.border),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _viewModeButton(
                        icon: Icons.grid_view_rounded,
                        tooltip: 'Grid Cards',
                        isSelected: viewModel.viewMode == ViewMode.grid,
                        onTap: () => viewModel.setViewMode(ViewMode.grid),
                      ),
                      _viewModeButton(
                        icon: Icons.view_list_rounded,
                        tooltip: 'List View',
                        isSelected: viewModel.viewMode == ViewMode.list,
                        onTap: () => viewModel.setViewMode(ViewMode.list),
                      ),
                      _viewModeButton(
                        icon: Icons.apps_rounded,
                        tooltip: 'App Shelf (Icons Only)',
                        isSelected: viewModel.viewMode == ViewMode.iconOnly,
                        onTap: () => viewModel.setViewMode(ViewMode.iconOnly),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Filters Bar: Framework Chips + Running Toggle
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
            decoration: const BoxDecoration(
              color: WebDeckTheme.surfaceSubtle,
              border: Border(bottom: BorderSide(color: WebDeckTheme.border)),
            ),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  // Running Only Filter Chip
                  FilterChip(
                    label: Text('Running (${viewModel.runningCount})'),
                    selected: viewModel.onlyRunning,
                    onSelected: (_) => viewModel.toggleOnlyRunning(),
                    avatar: Icon(
                      Icons.circle,
                      size: 10,
                      color: viewModel.runningCount > 0 ? WebDeckTheme.accentGreen : WebDeckTheme.textSecondary,
                    ),
                    backgroundColor: WebDeckTheme.surface,
                    selectedColor: WebDeckTheme.accentGreen.withValues(alpha: 0.25),
                    labelStyle: TextStyle(
                      fontSize: 12,
                      color: viewModel.onlyRunning ? WebDeckTheme.accentGreen : WebDeckTheme.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                    side: BorderSide(
                      color: viewModel.onlyRunning ? WebDeckTheme.accentGreen : WebDeckTheme.border,
                    ),
                  ),
                  const SizedBox(width: 8),

                  // Framework Filter Chips
                  for (final fw in viewModel.availableFrameworks) ...[
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: FilterChip(
                        label: Text(fw),
                        selected: (viewModel.selectedFramework ?? 'All') == fw,
                        onSelected: (selected) {
                          viewModel.setSelectedFramework(selected ? fw : 'All');
                        },
                        backgroundColor: WebDeckTheme.surface,
                        selectedColor: WebDeckTheme.primary.withValues(alpha: 0.25),
                        labelStyle: TextStyle(
                          fontSize: 12,
                          color: (viewModel.selectedFramework ?? 'All') == fw
                              ? WebDeckTheme.primary
                              : WebDeckTheme.textSecondary,
                          fontWeight: FontWeight.w600,
                        ),
                        side: BorderSide(
                          color: (viewModel.selectedFramework ?? 'All') == fw
                              ? WebDeckTheme.primary
                              : WebDeckTheme.border,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),

          // Main View (Grid, List, or Icon-Only)
          Expanded(
            child: viewModel.isLoading
                ? const Center(child: CircularProgressIndicator())
                : apps.isEmpty
                    ? _buildEmptyState(context, viewModel)
                    : viewModel.viewMode == ViewMode.grid
                        ? _buildGridView(context, viewModel, apps)
                        : viewModel.viewMode == ViewMode.list
                            ? _buildListView(context, viewModel, apps)
                            : _buildIconOnlyView(context, viewModel, apps),
          ),
        ],
      ),
    );
  }

  Widget _viewModeButton({
    required IconData icon,
    required String tooltip,
    required bool isSelected,
    required VoidCallback onTap,
  }) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          padding: const EdgeInsets.all(8),
          color: isSelected ? WebDeckTheme.primary.withValues(alpha: 0.2) : Colors.transparent,
          child: Icon(
            icon,
            size: 18,
            color: isSelected ? WebDeckTheme.primary : WebDeckTheme.textSecondary,
          ),
        ),
      ),
    );
  }

  Widget _buildGridView(BuildContext context, CatalogViewModel viewModel, List<InstalledApp> apps) {
    return LayoutBuilder(
      builder: (context, constraints) {
        int crossAxisCount = 1;
        if (constraints.maxWidth > 1200) {
          crossAxisCount = 4;
        } else if (constraints.maxWidth > 850) {
          crossAxisCount = 3;
        } else if (constraints.maxWidth > 550) {
          crossAxisCount = 2;
        }

        return GridView.builder(
          padding: const EdgeInsets.all(20),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            crossAxisSpacing: 16,
            mainAxisSpacing: 16,
            mainAxisExtent: 215,
          ),
          itemCount: apps.length,
          itemBuilder: (context, index) {
            final app = apps[index];
            final isRunning = viewModel.isAppRunning(app.id);
            final instance = viewModel.getAppInstance(app.id);

            return AppCard(
              app: app,
              isRunning: isRunning,
              runningPort: instance?.port,
              onLaunch: () => _launchApp(context, viewModel, app),
              onStop: () => viewModel.stopApp(app.id),
              onUninstall: () => _confirmUninstall(context, viewModel, app),
              onOpenBrowser: () => _openInExternalBrowser(context, viewModel, app),
              onUpdateIcon: () => _onUpdateIcon(context, viewModel, app),
              onCheckUpdate: () => _onCheckUpdate(context, viewModel, app),
            );
          },
        );
      },
    );
  }

  Widget _buildListView(BuildContext context, CatalogViewModel viewModel, List<InstalledApp> apps) {
    return ListView.separated(
      padding: const EdgeInsets.all(20),
      itemCount: apps.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final app = apps[index];
        final isRunning = viewModel.isAppRunning(app.id);
        final hasIcon = app.localIconPath != null && File(app.localIconPath!).existsSync();

        return Card(
          child: ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            leading: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                color: WebDeckTheme.surfaceSubtle,
                border: Border.all(color: WebDeckTheme.border),
              ),
              child: hasIcon
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.file(File(app.localIconPath!), fit: BoxFit.cover),
                    )
                  : Center(
                      child: Text(
                        app.name.isNotEmpty ? app.name[0].toUpperCase() : 'W',
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
                      ),
                    ),
            ),
            title: Row(
              children: [
                Flexible(
                  child: Text(
                    app.name,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: WebDeckTheme.surfaceSubtle,
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(color: WebDeckTheme.border),
                  ),
                  child: Text(
                    app.framework,
                    style: const TextStyle(fontSize: 10, color: WebDeckTheme.primary, fontWeight: FontWeight.w600),
                  ),
                ),
                if (app.backendRequirement?.hasRequirements == true) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFFD29922).withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: const Color(0xFFD29922).withValues(alpha: 0.35)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          app.backendRequirement!.requiresPython ? Icons.terminal : Icons.storage,
                          size: 10,
                          color: const Color(0xFFD29922),
                        ),
                        const SizedBox(width: 3),
                        Text(
                          app.backendRequirement!.requiresPython ? 'Python' : 'DB',
                          style: const TextStyle(fontSize: 9, color: Color(0xFFD29922), fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ),
                ],
                if (isRunning) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: WebDeckTheme.accentGreen.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: WebDeckTheme.accentGreen.withValues(alpha: 0.4)),
                    ),
                    child: const Text(
                      'RUNNING',
                      style: TextStyle(fontSize: 9, color: WebDeckTheme.accentGreen, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ],
            ),
            subtitle: Text(
              app.description.isNotEmpty ? app.description : 'Version ${app.version}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (isRunning) ...[
                  IconButton(
                    icon: const Icon(Icons.stop_rounded, color: WebDeckTheme.accentRed, size: 20),
                    tooltip: 'Stop Server',
                    onPressed: () => viewModel.stopApp(app.id),
                  ),
                ],
                IconButton(
                  icon: const Icon(Icons.open_in_browser, size: 20),
                  tooltip: 'Open in Browser',
                  onPressed: () => _openInExternalBrowser(context, viewModel, app),
                ),
                ElevatedButton.icon(
                  onPressed: () => _launchApp(context, viewModel, app),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isRunning ? WebDeckTheme.accentGreen : WebDeckTheme.primary,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  ),
                  icon: Icon(isRunning ? Icons.play_arrow : Icons.rocket_launch, size: 14),
                  label: Text(isRunning ? 'Play' : 'Launch', style: const TextStyle(fontSize: 12)),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildIconOnlyView(BuildContext context, CatalogViewModel viewModel, List<InstalledApp> apps) {
    return LayoutBuilder(
      builder: (context, constraints) {
        int crossAxisCount = (constraints.maxWidth / 120).floor().clamp(2, 8);

        return GridView.builder(
          padding: const EdgeInsets.all(24),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: crossAxisCount,
            crossAxisSpacing: 20,
            mainAxisSpacing: 24,
            mainAxisExtent: 130,
          ),
          itemCount: apps.length,
          itemBuilder: (context, index) {
            final app = apps[index];
            final isRunning = viewModel.isAppRunning(app.id);
            final hasIcon = app.localIconPath != null && File(app.localIconPath!).existsSync();

            return InkWell(
              onTap: () => _launchApp(context, viewModel, app),
              borderRadius: BorderRadius.circular(16),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Stack(
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          gradient: const LinearGradient(
                            colors: [Color(0xFF1F6FEB), Color(0xFF8957E5)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.3),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: hasIcon
                            ? ClipRRect(
                                borderRadius: BorderRadius.circular(18),
                                child: Image.file(File(app.localIconPath!), fit: BoxFit.cover),
                              )
                            : Center(
                                child: Text(
                                  app.name.isNotEmpty ? app.name[0].toUpperCase() : 'W',
                                  style: const TextStyle(
                                    fontSize: 32,
                                    fontWeight: FontWeight.w800,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                      ),
                      if (isRunning)
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: Container(
                            width: 16,
                            height: 16,
                            decoration: BoxDecoration(
                              color: WebDeckTheme.accentGreen,
                              shape: BoxShape.circle,
                              border: Border.all(color: WebDeckTheme.surface, width: 2),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    app.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: WebDeckTheme.textPrimary,
                    ),
                  ),
                  Text(
                    app.framework,
                    style: const TextStyle(fontSize: 10, color: WebDeckTheme.textSecondary),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildEmptyState(BuildContext context, CatalogViewModel viewModel) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 460),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: WebDeckTheme.primary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                  border: Border.all(color: WebDeckTheme.primary.withValues(alpha: 0.3)),
                ),
                child: const Icon(
                  Icons.view_in_ar,
                  color: WebDeckTheme.primary,
                  size: 40,
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Your WebDeck Shelf is Empty',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: WebDeckTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Sideload any web application from GitHub Releases or a direct build archive. WebDeck will extract it into local sandbox storage and serve it via an isolated loopback webview.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: WebDeckTheme.textSecondary, height: 1.4),
              ),
              const SizedBox(height: 24),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 12,
                children: [
                  ElevatedButton.icon(
                    onPressed: () => _showInstallDialog(context, viewModel),
                    icon: const Icon(Icons.add_link),
                    label: const Text('Add from GitHub'),
                  ),
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: WebDeckTheme.textPrimary,
                      side: const BorderSide(color: WebDeckTheme.border),
                    ),
                    onPressed: () => viewModel.installDemoApp(),
                    icon: const Icon(Icons.sports_esports),
                    label: const Text('Try Demo App'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
