import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../data/models/installed_app.dart';
import '../../../runtime/app_icons.dart';
import '../../../runtime/manifest.dart';
import '../../../runtime/store_service.dart';
import '../../core/theme.dart';
import '../catalog/view_models/catalog_view_model.dart';
import '../shell/app_launcher.dart';

class StoreScreen extends StatefulWidget {
  const StoreScreen({super.key});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  String _query = '';
  String? _category;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<StoreService>();
    final catalog = context.watch<CatalogViewModel>();
    final installed = {for (final a in catalog.apps) a.id: a};

    final entries = store.entries.where((e) {
      final m = e.manifest;
      if (_category != null && m.category != _category) return false;
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      return m.name.toLowerCase().contains(q) ||
          m.description.toLowerCase().contains(q) ||
          m.category.toLowerCase().contains(q);
    }).toList()
      ..sort((a, b) {
        if (a.featured != b.featured) return a.featured ? -1 : 1;
        return a.manifest.name.compareTo(b.manifest.name);
      });

    final updates = store.entries.where((e) {
      final app = installed[e.id];
      return app != null && compareVersions(e.manifest.version, app.version) > 0;
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Store'),
        actions: [
          if (updates.isNotEmpty)
            TextButton.icon(
              onPressed: () async {
                for (final e in updates) {
                  await _install(context, e, confirmPermissions: false);
                }
              },
              icon: const Icon(Icons.system_update_alt, size: 18),
              label: Text('Update all (${updates.length})'),
            ),
          IconButton(
            tooltip: 'Refresh catalogs',
            onPressed: store.loading ? null : store.refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: store.refresh,
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Apps that run entirely on your computer. WebDeck provides storage, '
                      'networking, background checks and helper tools, so nothing else needs setting up.',
                      style: TextStyle(color: WebDeckTheme.textSecondary, height: 1.4),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      decoration: const InputDecoration(
                        hintText: 'Search apps',
                        prefixIcon: Icon(Icons.search, size: 20),
                        isDense: true,
                      ),
                      onChanged: (v) => setState(() => _query = v.trim()),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        ChoiceChip(
                          label: const Text('All'),
                          selected: _category == null,
                          onSelected: (_) => setState(() => _category = null),
                        ),
                        for (final c in store.categories)
                          ChoiceChip(
                            label: Text(c),
                            selected: _category == c,
                            onSelected: (_) => setState(() => _category = _category == c ? null : c),
                          ),
                      ],
                    ),
                    for (final err in store.catalogErrors.entries)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          'Could not load catalog ${err.key}: ${err.value}',
                          style: const TextStyle(color: WebDeckTheme.accentRed, fontSize: 12),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            if (store.loading && store.entries.isEmpty)
              const SliverFillRemaining(child: Center(child: CircularProgressIndicator()))
            else if (entries.isEmpty)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Text('No apps match.', style: TextStyle(color: WebDeckTheme.textSecondary)),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 360,
                    mainAxisExtent: 196,
                    crossAxisSpacing: 14,
                    mainAxisSpacing: 14,
                  ),
                  delegate: SliverChildBuilderDelegate(
                    (ctx, i) => _StoreCard(
                      entry: entries[i],
                      installed: installed[entries[i].id],
                      installing: store.isInstalling(entries[i].id),
                      onDetails: () => _showDetails(context, entries[i]),
                      onInstall: () => _install(context, entries[i]),
                      onOpen: () => openRuntimeApp(context, catalog, installed[entries[i].id]!),
                    ),
                    childCount: entries.length,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _install(BuildContext context, StoreEntry entry, {bool confirmPermissions = true}) async {
    final store = context.read<StoreService>();
    final catalog = context.read<CatalogViewModel>();
    final messenger = ScaffoldMessenger.of(context);
    final existing = catalog.apps.where((a) => a.id == entry.id).firstOrNull;

    // Ask again only when the update asks for new permissions.
    final newPerms = entry.manifest.permissions.difference(existing?.manifest?.permissions ?? const {});
    if (confirmPermissions && newPerms.isNotEmpty) {
      final ok = await _confirmPermissions(context, entry, newPerms, isUpdate: existing != null);
      if (!ok) return;
    }
    try {
      final app = await store.install(entry);
      await catalog.loadApps();
      messenger.showSnackBar(SnackBar(
        content: Text(existing == null ? '${app.name} installed' : '${app.name} updated to ${app.version}'),
        action: context.mounted
            ? SnackBarAction(label: 'Open', onPressed: () => openRuntimeApp(context, catalog, app))
            : null,
      ));
    } catch (e) {
      messenger.showSnackBar(SnackBar(
        content: Text('Could not install ${entry.manifest.name}: $e'),
        backgroundColor: WebDeckTheme.accentRed,
      ));
    }
  }

  Future<bool> _confirmPermissions(
    BuildContext context,
    StoreEntry entry,
    Set<String> perms, {
    required bool isUpdate,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: Text(isUpdate ? 'Update ${entry.manifest.name}?' : 'Install ${entry.manifest.name}?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(isUpdate ? 'This update needs new permissions:' : 'This app will be able to:'),
            const SizedBox(height: 12),
            for (final p in perms) _PermissionRow(permission: p),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: Text(isUpdate ? 'Update' : 'Install')),
        ],
      ),
    );
    return result ?? false;
  }

  void _showDetails(BuildContext context, StoreEntry entry) {
    final m = entry.manifest;
    showDialog(
      context: context,
      builder: (ctx) {
        final catalog = ctx.watch<CatalogViewModel>();
        final store = ctx.watch<StoreService>();
        final installed = catalog.apps.where((a) => a.id == entry.id).firstOrNull;
        return AlertDialog(
          backgroundColor: WebDeckTheme.surface,
          titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
          title: Row(
            children: [
              AppGlyphTile(glyph: m.icon, color: m.color, size: 52),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    Text(
                      '${m.category} · v${m.version} · ${entry.catalog}',
                      style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
          content: SizedBox(
            width: 460,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m.description, style: const TextStyle(height: 1.45)),
                  const SizedBox(height: 18),
                  const _SectionLabel('Permissions'),
                  if (m.permissions.isEmpty)
                    const Text('Only its own storage.', style: TextStyle(color: WebDeckTheme.textSecondary))
                  else
                    for (final p in m.permissions) _PermissionRow(permission: p),
                  if (m.jobs.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    const _SectionLabel('Background checks'),
                    for (final j in m.jobs)
                      Text('• ${j.title}: every ${JobSpec.formatInterval(j.every)}',
                          style: const TextStyle(color: WebDeckTheme.textSecondary)),
                  ],
                  const SizedBox(height: 12),
                  const _SectionLabel('Platforms'),
                  Text(
                    m.platforms.isEmpty ? 'All platforms' : m.platforms.join(', '),
                    style: const TextStyle(color: WebDeckTheme.textSecondary),
                  ),
                  if (!m.supportsCurrentPlatform)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('Not available on this device.', style: TextStyle(color: WebDeckTheme.accentRed)),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            if (installed != null)
              TextButton(
                style: TextButton.styleFrom(foregroundColor: WebDeckTheme.accentRed),
                onPressed: () async {
                  final ok = await showDialog<bool>(
                    context: ctx,
                    builder: (c2) => AlertDialog(
                      backgroundColor: WebDeckTheme.surface,
                      title: Text('Uninstall ${m.name}?'),
                      content: const Text('The app and everything it saved (tracked items, history, settings) will be deleted. '
                          'Files in your Downloads folder are kept.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(c2, false), child: const Text('Cancel')),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(backgroundColor: WebDeckTheme.accentRed),
                          onPressed: () => Navigator.pop(c2, true),
                          child: const Text('Uninstall'),
                        ),
                      ],
                    ),
                  );
                  if (ok == true) await catalog.uninstallApp(entry.id);
                },
                child: const Text('Uninstall'),
              ),
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
            if (installed != null)
              ElevatedButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  openRuntimeApp(context, catalog, installed);
                },
                child: const Text('Open'),
              )
            else if (m.supportsCurrentPlatform)
              ElevatedButton(
                onPressed: store.isInstalling(entry.id)
                    ? null
                    : () {
                        Navigator.pop(ctx);
                        _install(context, entry);
                      },
                child: const Text('Install'),
              ),
          ],
        );
      },
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
            color: WebDeckTheme.textSecondary,
          ),
        ),
      );
}

IconData permissionIcon(String p) => switch (p) {
      RuntimePermission.net => Icons.public,
      RuntimePermission.files => Icons.folder_open,
      RuntimePermission.notify => Icons.notifications_none,
      RuntimePermission.jobs => Icons.schedule,
      RuntimePermission.tools => Icons.terminal,
      _ => Icons.shield_outlined,
    };

class _PermissionRow extends StatelessWidget {
  final String permission;
  const _PermissionRow({required this.permission});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Icon(permissionIcon(permission), size: 18, color: WebDeckTheme.primary),
            const SizedBox(width: 10),
            Expanded(child: Text(RuntimePermission.describe(permission))),
          ],
        ),
      );
}

class _StoreCard extends StatelessWidget {
  final StoreEntry entry;
  final InstalledApp? installed;
  final bool installing;
  final VoidCallback onDetails;
  final VoidCallback onInstall;
  final VoidCallback onOpen;

  const _StoreCard({
    required this.entry,
    required this.installed,
    required this.installing,
    required this.onDetails,
    required this.onInstall,
    required this.onOpen,
  });

  @override
  Widget build(BuildContext context) {
    final m = entry.manifest;
    final hasUpdate = installed != null && compareVersions(m.version, installed!.version) > 0;

    Widget action;
    if (installing) {
      action = const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2));
    } else if (!m.supportsCurrentPlatform) {
      action = const Text('Desktop only', style: TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary));
    } else if (hasUpdate) {
      action = ElevatedButton(onPressed: onInstall, child: const Text('Update'));
    } else if (installed != null) {
      action = OutlinedButton(onPressed: onOpen, child: const Text('Open'));
    } else {
      action = ElevatedButton(onPressed: onInstall, child: const Text('Install'));
    }

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onDetails,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  AppGlyphTile(glyph: m.icon, color: m.color, size: 46),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(m.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                        Text(
                          entry.featured ? '${m.category} · Featured' : m.category,
                          style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Expanded(
                child: Text(
                  m.description,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: WebDeckTheme.textSecondary, height: 1.4),
                ),
              ),
              Row(
                children: [
                  for (final p in m.permissions)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Tooltip(
                        message: RuntimePermission.describe(p),
                        child: Icon(permissionIcon(p), size: 15, color: WebDeckTheme.textSecondary),
                      ),
                    ),
                  const Spacer(),
                  if (installed != null && !hasUpdate)
                    const Padding(
                      padding: EdgeInsets.only(right: 8),
                      child: Icon(Icons.check_circle, size: 16, color: WebDeckTheme.accentGreen),
                    ),
                  action,
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
