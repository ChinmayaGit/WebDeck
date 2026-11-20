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
  bool _essentialOnly = false;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<StoreService>();
    final catalog = context.watch<CatalogViewModel>();
    final installed = {for (final a in catalog.apps) a.id: a};
    final browsing = _category == null && _query.isEmpty && !_essentialOnly;

    final entries =
        store.entries.where((e) {
          final m = e.manifest;
          if (_essentialOnly && !e.essential) return false;
          if (_category != null && m.category != _category) return false;
          if (_query.isEmpty) return true;
          final q = _query.toLowerCase();
          return m.name.toLowerCase().contains(q) ||
              m.description.toLowerCase().contains(q) ||
              m.category.toLowerCase().contains(q);
        }).toList()..sort((a, b) {
          if (a.featured != b.featured) return a.featured ? -1 : 1;
          return a.manifest.name.compareTo(b.manifest.name);
        });

    final updates = store.entries.where((e) {
      final app = installed[e.id];
      return app != null &&
          compareVersions(e.manifest.version, app.version) > 0;
    }).toList();

    _AppTile tile(StoreEntry e) => _AppTile(
      entry: e,
      installed: installed[e.id],
      installing: store.isInstalling(e.id),
      onDetails: () => _showDetails(context, e),
      onInstall: () => _install(context, e),
      onOpen: () => openRuntimeApp(context, catalog, installed[e.id]!),
    );

    final featured = store.entries.where((e) => e.featured).toList();
    final mine = store.entries
        .where((e) => installed.containsKey(e.id))
        .toList();

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: store.refresh,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: _Hero(
                appCount: store.entries.length,
                categoryCount: store.categories.length,
                installedCount: mine.length,
                query: _query,
                onSearch: (v) => setState(() => _query = v.trim()),
                updates: updates.length,
                onUpdateAll: () async {
                  for (final e in updates) {
                    await _install(context, e, confirmPermissions: false);
                  }
                },
                onRefresh: store.loading ? null : store.refresh,
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 4),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    FilterChip(
                      selected: !_essentialOnly,
                      label: Text('All Apps (${store.entries.length})'),
                      selectedColor: WebDeckTheme.primary.withValues(alpha: 0.3),
                      showCheckmark: false,
                      onSelected: (_) => setState(() => _essentialOnly = false),
                    ),
                    FilterChip(
                      selected: _essentialOnly,
                      label: Text('★ Essential (${store.entries.where((e) => e.essential).length})'),
                      selectedColor: WebDeckTheme.accentGreen.withValues(alpha: 0.3),
                      showCheckmark: false,
                      onSelected: (_) => setState(() => _essentialOnly = true),
                    ),
                    if (_category != null)
                      Chip(
                        label: Text('Category: $_category'),
                        onDeleted: () => setState(() => _category = null),
                        deleteIcon: const Icon(Icons.close, size: 14),
                      ),
                  ],
                ),
              ),
            ),
            for (final err in store.catalogErrors.entries)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                  child: Text(
                    'Could not load catalog ${err.key}: ${err.value}',
                    style: const TextStyle(
                      color: WebDeckTheme.accentRed,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            if (store.loading && store.entries.isEmpty)
              const SliverFillRemaining(
                child: Center(child: CircularProgressIndicator()),
              )
            else if (browsing) ...[
              // ---- Browse: categories, featured, rows per category, coming soon.
              _sectionTitle('Categories'),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                    maxCrossAxisExtent: 190,
                    mainAxisExtent: 74,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  delegate: SliverChildListDelegate([
                    for (final c in store.categories)
                      _CategoryTile(
                        category: store.category(c),
                        count: store.entries
                            .where((e) => e.manifest.category == c)
                            .length,
                        onTap: () => setState(() => _category = c),
                      ),
                  ]),
                ),
              ),
              if (featured.isNotEmpty) ...[
                _sectionTitle('Featured'),
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: 190,
                    child: ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      scrollDirection: Axis.horizontal,
                      itemCount: featured.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 14),
                      itemBuilder: (ctx, i) => _FeaturedCard(
                        entry: featured[i],
                        installed: installed[featured[i].id],
                        installing: store.isInstalling(featured[i].id),
                        onDetails: () => _showDetails(context, featured[i]),
                        onInstall: () => _install(context, featured[i]),
                        onOpen: () => openRuntimeApp(
                          context,
                          catalog,
                          installed[featured[i].id]!,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
              if (mine.isNotEmpty) ...[
                _sectionTitle(
                  'Your apps',
                  trailing: '${mine.length} installed',
                ),
                _row([for (final e in mine) tile(e)]),
              ],
              for (final cat in store.categories) ...[
                _sectionTitle(
                  cat,
                  category: store.category(cat),
                  onSeeAll: () => setState(() => _category = cat),
                ),
                _row([
                  for (final e in entries.where(
                    (e) => e.manifest.category == cat,
                  ))
                    tile(e),
                ]),
              ],
              if (store.upcoming.isNotEmpty) ...[
                _sectionTitle('Coming soon', trailing: 'In development'),
                _row([
                  for (final u in store.upcoming) _UpcomingTile(upcoming: u),
                ]),
              ],
              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ] else ...[
              // ---- Filtered: a category or a search.
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 14, 20, 4),
                  child: Row(
                    children: [
                      IconButton(
                        tooltip: 'Back to Store',
                        onPressed: () => setState(() {
                          _category = null;
                          _query = '';
                        }),
                        icon: const Icon(Icons.arrow_back),
                      ),
                      if (_category != null) ...[
                        AppGlyphTile(
                          glyph: store.category(_category!).icon,
                          color: store.category(_category!).color,
                          size: 30,
                        ),
                        const SizedBox(width: 10),
                      ],
                      Expanded(
                        child: Text(
                          _category ?? 'Results for “$_query”',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        '${entries.length} app${entries.length == 1 ? '' : 's'}',
                        style: const TextStyle(
                          color: WebDeckTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              if (entries.isEmpty)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Text(
                      'No apps match.',
                      style: TextStyle(color: WebDeckTheme.textSecondary),
                    ),
                  ),
                )
              else
                _grid(context, entries, installed, store, catalog, bottom: 32),
            ],
          ],
        ),
      ),
    );
  }

  Widget _sectionTitle(
    String title, {
    StoreCategory? category,
    VoidCallback? onSeeAll,
    String? trailing,
  }) {
    return SliverToBoxAdapter(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 26, 12, 10),
        child: Row(
          children: [
            if (category != null) ...[
              AppGlyphTile(
                glyph: category.icon,
                color: category.color,
                size: 26,
              ),
              const SizedBox(width: 10),
            ],
            Flexible(
              child: Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const Spacer(),
            if (trailing != null)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: Text(
                  trailing,
                  style: const TextStyle(
                    color: WebDeckTheme.textSecondary,
                    fontSize: 12,
                  ),
                ),
              ),
            if (onSeeAll != null)
              TextButton(onPressed: onSeeAll, child: const Text('See all')),
          ],
        ),
      ),
    );
  }

  Widget _row(List<Widget> tiles) {
    return SliverToBoxAdapter(
      child: SizedBox(
        height: 150,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          scrollDirection: Axis.horizontal,
          itemCount: tiles.length,
          separatorBuilder: (_, _) => const SizedBox(width: 12),
          itemBuilder: (_, i) => tiles[i],
        ),
      ),
    );
  }

  Widget _grid(
    BuildContext context,
    List<StoreEntry> list,
    Map<String, InstalledApp> installed,
    StoreService store,
    CatalogViewModel catalog, {
    double bottom = 0,
  }) {
    return SliverPadding(
      padding: EdgeInsets.fromLTRB(20, 8, 20, bottom),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 360,
          mainAxisExtent: 196,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
        ),
        delegate: SliverChildBuilderDelegate(
          (ctx, i) => _StoreCard(
            entry: list[i],
            installed: installed[list[i].id],
            installing: store.isInstalling(list[i].id),
            onDetails: () => _showDetails(context, list[i]),
            onInstall: () => _install(context, list[i]),
            onOpen: () =>
                openRuntimeApp(context, catalog, installed[list[i].id]!),
          ),
          childCount: list.length,
        ),
      ),
    );
  }

  Future<void> _install(
    BuildContext context,
    StoreEntry entry, {
    bool confirmPermissions = true,
  }) async {
    final store = context.read<StoreService>();
    final catalog = context.read<CatalogViewModel>();
    final messenger = ScaffoldMessenger.of(context);
    final existing = catalog.apps.where((a) => a.id == entry.id).firstOrNull;

    // Ask again only when the update asks for new permissions.
    final newPerms = entry.manifest.permissions.difference(
      existing?.manifest?.permissions ?? const {},
    );
    if (confirmPermissions && newPerms.isNotEmpty) {
      final ok = await _confirmPermissions(
        context,
        entry,
        newPerms,
        isUpdate: existing != null,
      );
      if (!ok) return;
    }
    try {
      final app = await store.install(entry);
      await catalog.loadApps();
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            existing == null
                ? '${app.name} installed'
                : '${app.name} updated to ${app.version}',
          ),
          action: context.mounted
              ? SnackBarAction(
                  label: 'Open',
                  onPressed: () => openRuntimeApp(context, catalog, app),
                )
              : null,
        ),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(
          content: Text('Could not install ${entry.manifest.name}: $e'),
          backgroundColor: WebDeckTheme.accentRed,
        ),
      );
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
        title: Text(
          isUpdate
              ? 'Update ${entry.manifest.name}?'
              : 'Install ${entry.manifest.name}?',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isUpdate
                  ? 'This update needs new permissions:'
                  : 'This app will be able to:',
            ),
            const SizedBox(height: 12),
            for (final p in perms) _PermissionRow(permission: p),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(isUpdate ? 'Update' : 'Install'),
          ),
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
        final installed = catalog.apps
            .where((a) => a.id == entry.id)
            .firstOrNull;
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
                    Text(
                      m.name,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      '${m.category} · v${m.version} · ${entry.catalog}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: WebDeckTheme.textSecondary,
                      ),
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
                    const Text(
                      'Only its own storage.',
                      style: TextStyle(color: WebDeckTheme.textSecondary),
                    )
                  else
                    for (final p in m.permissions)
                      _PermissionRow(permission: p),
                  if (m.jobs.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    const _SectionLabel('Background checks'),
                    for (final j in m.jobs)
                      Text(
                        '• ${j.title}: every ${JobSpec.formatInterval(j.every)}',
                        style: const TextStyle(
                          color: WebDeckTheme.textSecondary,
                        ),
                      ),
                  ],
                  const SizedBox(height: 12),
                  const _SectionLabel('Platforms'),
                  Text(
                    m.platforms.isEmpty
                        ? 'All platforms'
                        : m.platforms.join(', '),
                    style: const TextStyle(color: WebDeckTheme.textSecondary),
                  ),
                  if (!m.supportsCurrentPlatform)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text(
                        'Not available on this device.',
                        style: TextStyle(color: WebDeckTheme.accentRed),
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            if (installed != null)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: WebDeckTheme.accentRed,
                ),
                onPressed: () async {
                  final ok = await showDialog<bool>(
                    context: ctx,
                    builder: (c2) => AlertDialog(
                      backgroundColor: WebDeckTheme.surface,
                      title: Text('Uninstall ${m.name}?'),
                      content: const Text(
                        'The app and everything it saved (tracked items, history, settings) will be deleted. '
                        'Files in your Downloads folder are kept.',
                      ),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(c2, false),
                          child: const Text('Cancel'),
                        ),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: WebDeckTheme.accentRed,
                          ),
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
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Close'),
            ),
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
  RuntimePermission.shell => Icons.warning_amber_rounded,
  RuntimePermission.localnet => Icons.lan_outlined,
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
        Icon(
          permissionIcon(permission),
          size: 18,
          color: permission == RuntimePermission.shell
              ? WebDeckTheme.accentRed
              : WebDeckTheme.primary,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            RuntimePermission.describe(permission),
            style: permission == RuntimePermission.shell
                ? const TextStyle(
                    color: WebDeckTheme.accentRed,
                    fontWeight: FontWeight.w600,
                  )
                : null,
          ),
        ),
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
    final hasUpdate =
        installed != null && compareVersions(m.version, installed!.version) > 0;

    Widget action;
    if (installing) {
      action = const SizedBox(
        width: 22,
        height: 22,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    } else if (!m.supportsCurrentPlatform) {
      action = const Text(
        'Desktop only',
        style: TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
      );
    } else if (hasUpdate) {
      action = ElevatedButton(
        onPressed: onInstall,
        child: const Text('Update'),
      );
    } else if (installed != null) {
      action = OutlinedButton(onPressed: onOpen, child: const Text('Open'));
    } else {
      action = ElevatedButton(
        onPressed: onInstall,
        child: const Text('Install'),
      );
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
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                m.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            if (entry.essential)
                              Container(
                                margin: const EdgeInsets.only(left: 6),
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: WebDeckTheme.accentGreen.withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(color: WebDeckTheme.accentGreen.withValues(alpha: 0.4)),
                                ),
                                child: const Text(
                                  '★ Essential',
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    color: WebDeckTheme.accentGreen,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        Text(
                          entry.featured
                              ? '${m.category} · Featured'
                              : m.category,
                          style: const TextStyle(
                            fontSize: 12,
                            color: WebDeckTheme.textSecondary,
                          ),
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
                  style: const TextStyle(
                    fontSize: 13,
                    color: WebDeckTheme.textSecondary,
                    height: 1.4,
                  ),
                ),
              ),
              Row(
                children: [
                  for (final p in m.permissions)
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: Tooltip(
                        message: RuntimePermission.describe(p),
                        child: Icon(
                          permissionIcon(p),
                          size: 15,
                          color: WebDeckTheme.textSecondary,
                        ),
                      ),
                    ),
                  const Spacer(),
                  if (installed != null && !hasUpdate)
                    const Padding(
                      padding: EdgeInsets.only(right: 8),
                      child: Icon(
                        Icons.check_circle,
                        size: 16,
                        color: WebDeckTheme.accentGreen,
                      ),
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

// --------------------------------------------------------------------- widgets

class _Hero extends StatefulWidget {
  final int appCount;
  final int categoryCount;
  final int installedCount;
  final String query;
  final ValueChanged<String> onSearch;
  final int updates;
  final VoidCallback onUpdateAll;
  final VoidCallback? onRefresh;

  const _Hero({
    required this.appCount,
    required this.categoryCount,
    required this.installedCount,
    required this.query,
    required this.onSearch,
    required this.updates,
    required this.onUpdateAll,
    required this.onRefresh,
  });

  @override
  State<_Hero> createState() => _HeroState();
}

class _HeroState extends State<_Hero> {
  final _controller = TextEditingController();

  @override
  void didUpdateWidget(_Hero old) {
    super.didUpdateWidget(old);
    if (widget.query.isEmpty && _controller.text.isNotEmpty) {
      _controller.clear();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 600;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      padding: EdgeInsets.fromLTRB(narrow ? 18 : 28, 22, narrow ? 18 : 28, 22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1F6FEB), Color(0xFF8B5CF6), Color(0xFFEC4899)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.storefront, color: Colors.white, size: 26),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'WebDeck Store',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              if (widget.updates > 0)
                FilledButton.tonalIcon(
                  onPressed: widget.onUpdateAll,
                  icon: const Icon(Icons.system_update_alt, size: 18),
                  label: Text('Update ${widget.updates}'),
                ),
              IconButton(
                tooltip: 'Refresh catalogs',
                onPressed: widget.onRefresh,
                icon: const Icon(Icons.refresh, color: Colors.white),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Free tools that run right on your device. No accounts, no servers, your files stay yours.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.9),
              height: 1.4,
            ),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _pill(Icons.apps, '${widget.appCount} apps'),
              _pill(
                Icons.category_outlined,
                '${widget.categoryCount} categories',
              ),
              _pill(
                Icons.check_circle_outline,
                '${widget.installedCount} installed',
              ),
              _pill(Icons.wifi_off, 'Works offline'),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            onChanged: widget.onSearch,
            style: const TextStyle(color: Colors.black87),
            decoration: InputDecoration(
              hintText: 'Search apps: PDF, music, downloader, tracker…',
              hintStyle: const TextStyle(color: Colors.black45),
              prefixIcon: const Icon(Icons.search, color: Colors.black54),
              filled: true,
              fillColor: Colors.white,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _pill(IconData icon, String text) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.18),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: Colors.white),
        const SizedBox(width: 6),
        Text(
          text,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ),
  );
}

class _CategoryTile extends StatelessWidget {
  final StoreCategory category;
  final int count;
  final VoidCallback onTap;
  const _CategoryTile({
    required this.category,
    required this.count,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = AppGlyphs.parseColor(category.color);
    return Material(
      color: c.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: c.withValues(alpha: 0.35)),
          ),
          child: Row(
            children: [
              AppGlyphTile(
                glyph: category.icon,
                color: category.color,
                size: 38,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      category.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      '$count app${count == 1 ? '' : 's'}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: WebDeckTheme.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _tagline(String description) {
  final i = description.indexOf('. ');
  return i > 0 ? description.substring(0, i + 1) : description;
}

class _FeaturedCard extends StatelessWidget {
  final StoreEntry entry;
  final InstalledApp? installed;
  final bool installing;
  final VoidCallback onDetails;
  final VoidCallback onInstall;
  final VoidCallback onOpen;

  const _FeaturedCard({
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
    final c = AppGlyphs.parseColor(m.color);
    final hsl = HSLColor.fromColor(c);
    return SizedBox(
      width: 330,
      child: Material(
        borderRadius: BorderRadius.circular(18),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onDetails,
          child: Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  hsl
                      .withLightness((hsl.lightness * 0.55).clamp(0.0, 1.0))
                      .toColor(),
                  hsl
                      .withLightness((hsl.lightness * 0.25).clamp(0.0, 1.0))
                      .toColor(),
                ],
              ),
            ),
            child: Stack(
              children: [
                Positioned(
                  right: -18,
                  bottom: -26,
                  child: Icon(
                    AppGlyphs.of(m.icon),
                    size: 130,
                    color: Colors.white.withValues(alpha: 0.08),
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        AppGlyphTile(glyph: m.icon, color: m.color, size: 50),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                m.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 17,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                m.category,
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.75),
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: Text(
                        _tagline(m.description),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.88),
                          height: 1.35,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: _ActionButton(
                        entry: entry,
                        installed: installed,
                        installing: installing,
                        onInstall: onInstall,
                        onOpen: onOpen,
                        light: true,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Compact tile used in the horizontal rows.
class _AppTile extends StatelessWidget {
  final StoreEntry entry;
  final InstalledApp? installed;
  final bool installing;
  final VoidCallback onDetails;
  final VoidCallback onInstall;
  final VoidCallback onOpen;

  const _AppTile({
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
    return SizedBox(
      width: 250,
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onDetails,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AppGlyphTile(glyph: m.icon, color: m.color, size: 44),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  m.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontWeight: FontWeight.w700),
                                ),
                              ),
                              if (entry.essential)
                                const Text(
                                  ' ★',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold,
                                    color: WebDeckTheme.accentGreen,
                                  ),
                                ),
                            ],
                          ),
                          Text(
                            m.supportsCurrentPlatform
                                ? m.category
                                : 'Desktop only',
                            style: const TextStyle(
                              fontSize: 12,
                              color: WebDeckTheme.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: Text(
                    _tagline(m.description),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      color: WebDeckTheme.textSecondary,
                      height: 1.35,
                    ),
                  ),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: _ActionButton(
                    entry: entry,
                    installed: installed,
                    installing: installing,
                    onInstall: onInstall,
                    onOpen: onOpen,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final StoreEntry entry;
  final InstalledApp? installed;
  final bool installing;
  final VoidCallback onInstall;
  final VoidCallback onOpen;
  final bool light;

  const _ActionButton({
    required this.entry,
    required this.installed,
    required this.installing,
    required this.onInstall,
    required this.onOpen,
    this.light = false,
  });

  @override
  Widget build(BuildContext context) {
    final m = entry.manifest;
    if (installing) {
      return const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    if (!m.supportsCurrentPlatform) {
      return const Text(
        'Not on this device',
        style: TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
      );
    }
    final style = light
        ? FilledButton.styleFrom(
            backgroundColor: Colors.white,
            foregroundColor: Colors.black87,
            visualDensity: VisualDensity.compact,
          )
        : FilledButton.styleFrom(visualDensity: VisualDensity.compact);
    if (installed != null &&
        compareVersions(m.version, installed!.version) > 0) {
      return FilledButton(
        style: style,
        onPressed: onInstall,
        child: const Text('Update'),
      );
    }
    if (installed != null) {
      return OutlinedButton(
        style: OutlinedButton.styleFrom(
          visualDensity: VisualDensity.compact,
          foregroundColor: light ? Colors.white : null,
          side: light ? const BorderSide(color: Colors.white70) : null,
        ),
        onPressed: onOpen,
        child: const Text('Open'),
      );
    }
    return FilledButton(
      style: style,
      onPressed: onInstall,
      child: const Text('Get'),
    );
  }
}

class _UpcomingTile extends StatelessWidget {
  final StoreUpcoming upcoming;
  const _UpcomingTile({required this.upcoming});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 250,
      child: Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Opacity(
                    opacity: 0.6,
                    child: AppGlyphTile(
                      glyph: upcoming.icon,
                      color: upcoming.color,
                      size: 44,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          upcoming.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          upcoming.category,
                          style: const TextStyle(
                            fontSize: 12,
                            color: WebDeckTheme.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Expanded(
                child: Text(
                  upcoming.description,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: WebDeckTheme.textSecondary,
                    height: 1.35,
                  ),
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: WebDeckTheme.surfaceSubtle,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: WebDeckTheme.border),
                  ),
                  child: const Text(
                    'Coming soon',
                    style: TextStyle(
                      fontSize: 11,
                      color: WebDeckTheme.textSecondary,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
