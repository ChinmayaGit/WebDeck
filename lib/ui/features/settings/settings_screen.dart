import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../data/services/storage_service.dart';
import '../../../runtime/link_service.dart';
import '../../../runtime/manifest.dart';
import '../../../runtime/settings_service.dart';
import '../../../runtime/store_service.dart';
import '../../../runtime/tools_service.dart';
import '../../core/theme.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsService>();
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _Header('General'),
                  Card(
                    child: Column(
                      children: [
                        SwitchListTile(
                          title: const Text('Background checks'),
                          subtitle: const Text('Let trackers check prices, games and tickets on a schedule while WebDeck is open.'),
                          value: settings.backgroundJobs,
                          onChanged: settings.setBackgroundJobs,
                        ),
                        const Divider(height: 1),
                        SwitchListTile(
                          title: const Text('System notifications'),
                          subtitle: const Text('Also show app alerts as desktop notifications (they always appear in Activity).'),
                          value: settings.systemNotifications,
                          onChanged: settings.setSystemNotifications,
                        ),
                        const Divider(height: 1),
                        SwitchListTile(
                          title: const Text('Developer mode'),
                          subtitle: const Text(
                              'Sideload any web project from GitHub, a zip or a folder, with companion backends and Database Studio.'),
                          value: settings.developerMode,
                          onChanged: settings.setDeveloperMode,
                        ),
                      ],
                    ),
                  ),
                  const _Header('Device Link'),
                  const _LinkCard(),
                  const _Header('Tools'),
                  const _ToolsCard(),
                  const _Header('Store sources'),
                  const _CatalogsCard(),
                  const _Header('Storage'),
                  const _StorageCard(),
                  const _Header('About'),
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.info_outline),
                      title: Text('WebDeck'),
                      subtitle: Text('Runtime API $kRuntimeApiVersion · build apps with webdeck.json — see docs/building-apps.md'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 22, 4, 8),
        child: Text(
          text.toUpperCase(),
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: WebDeckTheme.textSecondary),
        ),
      );
}

class _ToolsCard extends StatefulWidget {
  const _ToolsCard();

  @override
  State<_ToolsCard> createState() => _ToolsCardState();
}

class _ToolsCardState extends State<_ToolsCard> {
  Future<List<ToolStatus>>? _statuses;
  ToolsService? _tools;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final tools = context.read<ToolsService>();
    if (_tools != tools) {
      _tools?.removeListener(_reload);
      _tools = tools..addListener(_reload);
      _statuses = tools.statuses(withVersion: true);
    }
  }

  @override
  void dispose() {
    _tools?.removeListener(_reload);
    super.dispose();
  }

  void _reload() {
    if (!mounted) return;
    setState(() {
      _statuses = _tools!.statuses(withVersion: true);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!ToolsService.isSupportedPlatform) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.desktop_windows_outlined),
          title: Text('Helper tools are available on macOS, Windows and Linux.'),
        ),
      );
    }
    final tools = context.watch<ToolsService>();
    return Card(
      child: FutureBuilder<List<ToolStatus>>(
        future: _statuses,
        builder: (ctx, snap) {
          final list = snap.data;
          if (list == null) {
            return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
          }
          return Column(
            children: [
              for (var i = 0; i < list.length; i++) ...[
                if (i > 0) const Divider(height: 1),
                _ToolTile(status: list[i], installState: tools.installState(list[i].spec.id)),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _ToolTile extends StatelessWidget {
  final ToolStatus status;
  final ToolInstallState? installState;

  const _ToolTile({required this.status, required this.installState});

  @override
  Widget build(BuildContext context) {
    final tools = context.read<ToolsService>();
    final spec = status.spec;
    final messenger = ScaffoldMessenger.of(context);

    Future<void> install() async {
      try {
        await tools.install(spec.id);
        messenger.showSnackBar(SnackBar(content: Text('${spec.name} installed')));
      } catch (e) {
        messenger.showSnackBar(SnackBar(content: Text('Could not install ${spec.name}: $e'), backgroundColor: WebDeckTheme.accentRed));
      }
    }

    final String subtitle;
    if (installState != null) {
      subtitle = installState!.message;
    } else if (status.installed) {
      final where = status.source == 'managed' ? 'Installed by WebDeck' : 'Found on system';
      subtitle = '$where${status.version != null ? ' · ${status.version}' : ''}';
    } else {
      subtitle = spec.description;
    }

    return ListTile(
      leading: Icon(
        status.installed ? Icons.check_circle : Icons.radio_button_unchecked,
        color: status.installed ? WebDeckTheme.accentGreen : WebDeckTheme.textSecondary,
      ),
      title: Text(spec.name),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
          if (installState != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: LinearProgressIndicator(value: installState!.progress),
            ),
        ],
      ),
      trailing: installState != null
          ? null
          : Wrap(
              spacing: 4,
              children: [
                if (spec.installable && status.source != 'system')
                  TextButton(onPressed: install, child: Text(status.installed ? 'Update' : 'Install')),
                if (!spec.installable && !status.installed)
                  TextButton(onPressed: () => launchUrl(Uri.parse(spec.homepage)), child: const Text('Get it')),
                if (status.source == 'managed')
                  IconButton(
                    tooltip: 'Remove',
                    icon: const Icon(Icons.delete_outline, size: 20),
                    onPressed: () => tools.uninstall(spec.id),
                  ),
              ],
            ),
    );
  }
}

class _CatalogsCard extends StatefulWidget {
  const _CatalogsCard();

  @override
  State<_CatalogsCard> createState() => _CatalogsCardState();
}

class _CatalogsCardState extends State<_CatalogsCard> {
  final _controller = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    try {
      await context.read<SettingsService>().addCatalogUrl(_controller.text);
      _controller.clear();
      setState(() => _error = null);
    } on FormatException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsService>();
    final store = context.watch<StoreService>();
    return Card(
      child: Column(
        children: [
          const ListTile(
            leading: Icon(Icons.verified_outlined, color: WebDeckTheme.accentGreen),
            title: Text('WebDeck built-in catalog'),
            subtitle: Text('Bundled with the app, works offline'),
          ),
          for (final url in settings.catalogUrls) ...[
            const Divider(height: 1),
            ListTile(
              leading: Icon(
                store.catalogErrors.containsKey(url) ? Icons.error_outline : Icons.link,
                color: store.catalogErrors.containsKey(url) ? WebDeckTheme.accentRed : null,
              ),
              title: Text(url, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: store.catalogErrors[url] != null ? Text(store.catalogErrors[url]!) : null,
              trailing: IconButton(
                icon: const Icon(Icons.close, size: 20),
                onPressed: () => settings.removeCatalogUrl(url),
              ),
            ),
          ],
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: 'https://example.com/webdeck-catalog.json',
                      errorText: _error,
                    ),
                    onSubmitted: (_) => _add(),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(onPressed: _add, child: const Text('Add')),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StorageCard extends StatelessWidget {
  const _StorageCard();

  static Future<void> _open(String path) async {
    if (Platform.isMacOS) {
      await Process.run('open', [path]);
    } else if (Platform.isWindows) {
      await Process.run('explorer', [path]);
    } else if (Platform.isLinux) {
      await Process.run('xdg-open', [path]);
    }
  }

  @override
  Widget build(BuildContext context) {
    final storage = context.read<StorageService>();
    return Card(
      child: FutureBuilder<Directory>(
        future: storage.getBaseDirectory(),
        builder: (ctx, snap) {
          final dir = snap.data;
          return ListTile(
            leading: const Icon(Icons.folder_outlined),
            title: const Text('WebDeck data folder'),
            subtitle: Text(dir?.path ?? '…', maxLines: 2, overflow: TextOverflow.ellipsis),
            trailing: dir == null || !(Platform.isMacOS || Platform.isWindows || Platform.isLinux)
                ? null
                : TextButton(onPressed: () => _open(dir.path), child: const Text('Open')),
          );
        },
      ),
    );
  }
}

class _LinkCard extends StatefulWidget {
  const _LinkCard();

  @override
  State<_LinkCard> createState() => _LinkCardState();
}

class _LinkCardState extends State<_LinkCard> {
  ({String code, DateTime expires})? _code;
  List<String> _addrs = const [];

  Future<void> _showCode(LinkService link) async {
    final c = link.newPairCode();
    final addrs = await link.localAddresses();
    setState(() {
      _code = c;
      _addrs = addrs;
    });
  }

  Future<void> _pairDialog(LinkService link, {String? addr}) async {
    final addrCtl = TextEditingController(text: addr ?? '');
    final codeCtl = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: const Text('Pair a device'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('On the other device open Settings → Device Link → "Show pairing code", then enter it here.'),
            const SizedBox(height: 12),
            TextField(controller: addrCtl, decoration: const InputDecoration(labelText: 'IP address (e.g. 192.168.1.20)')),
            const SizedBox(height: 8),
            TextField(controller: codeCtl, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '6-digit code')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              try {
                final peer = await link.pairWith(addrCtl.text, codeCtl.text);
                if (ctx.mounted) Navigator.pop(ctx);
                messenger.showSnackBar(SnackBar(content: Text('Paired with ${peer.name}')));
              } catch (e) {
                messenger.showSnackBar(SnackBar(content: Text('$e'), backgroundColor: WebDeckTheme.accentRed));
              }
            },
            child: const Text('Pair'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final link = context.watch<LinkService>();
    final nearby = link.peers.where((p) => !p.paired && p.online).toList();
    return Card(
      child: Column(
        children: [
          SwitchListTile(
            title: const Text('Device Link'),
            subtitle: Text(link.running
                ? 'On as “${link.deviceName}”. Share files, messages and clipboard with your paired devices on this network.'
                : 'Connect WebDeck on your phone and computers over Wi-Fi: Nearby Share, Messages and Clipboard Sync.'),
            value: link.enabled,
            onChanged: link.setEnabled,
          ),
          if (link.lastError != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(link.lastError!, style: const TextStyle(color: WebDeckTheme.accentRed, fontSize: 12)),
            ),
          if (link.enabled) ...[
            const Divider(height: 1),
            ListTile(
              leading: const Icon(Icons.badge_outlined),
              title: const Text('This device’s name'),
              subtitle: Text(link.deviceName),
              trailing: TextButton(
                onPressed: () async {
                  final ctl = TextEditingController(text: link.deviceName);
                  final name = await showDialog<String>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      backgroundColor: WebDeckTheme.surface,
                      title: const Text('Device name'),
                      content: TextField(controller: ctl, autofocus: true),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                        ElevatedButton(onPressed: () => Navigator.pop(ctx, ctl.text), child: const Text('Save')),
                      ],
                    ),
                  );
                  if (name != null) await link.setDeviceName(name);
                },
                child: const Text('Rename'),
              ),
            ),
            SwitchListTile(
              secondary: const Icon(Icons.content_paste),
              title: const Text('Clipboard sync'),
              subtitle: const Text('Text you copy appears on your paired devices, and theirs here.'),
              value: link.clipboardSync,
              onChanged: link.setClipboardSync,
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  ElevatedButton.icon(onPressed: () => _showCode(link), icon: const Icon(Icons.qr_code_2, size: 18), label: const Text('Show pairing code')),
                  OutlinedButton.icon(onPressed: () => _pairDialog(link), icon: const Icon(Icons.add_link, size: 18), label: const Text('Pair with a code')),
                  if (_code != null && _code!.expires.isAfter(DateTime.now()))
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(color: WebDeckTheme.surfaceSubtle, borderRadius: BorderRadius.circular(10), border: Border.all(color: WebDeckTheme.primary)),
                      child: Text(
                        'Code ${_code!.code} · ${_addrs.join(', ')}',
                        style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, fontSize: 15),
                      ),
                    ),
                ],
              ),
            ),
            for (final p in nearby)
              ListTile(
                leading: const Icon(Icons.wifi_tethering),
                title: Text(p.name),
                subtitle: Text('Nearby · ${p.platform} · ${p.addr}'),
                trailing: TextButton(onPressed: () => _pairDialog(link, addr: p.addr), child: const Text('Pair')),
              ),
            for (final p in link.pairedPeers)
              ListTile(
                leading: Icon(Icons.devices, color: p.online ? WebDeckTheme.accentGreen : WebDeckTheme.textSecondary),
                title: Text(p.name),
                subtitle: Text('${p.online ? 'Online' : 'Offline'} · ${p.platform} · ${p.addr}'),
                trailing: IconButton(tooltip: 'Unpair', icon: const Icon(Icons.link_off, size: 20), onPressed: () => link.unpair(p.id)),
              ),
          ],
        ],
      ),
    );
  }
}
