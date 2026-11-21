import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../runtime/cloud_service.dart';
import '../../../runtime/manifest.dart';
import '../../../runtime/store_service.dart';
import '../../core/theme.dart';
import '../catalog/view_models/catalog_view_model.dart';
import '../catalog/views/install_dialog.dart';
import '../shell/app_launcher.dart';

/// "Build an extension": how to make, test and publish a WebDeck extension,
/// plus an AI skill file that lets any assistant build one from a description.
Future<void> showExtensionBuilder(BuildContext context) {
  return showDialog(
    context: context,
    builder: (_) => const _ExtensionBuilderDialog(),
  );
}

/// The skill: AI instructions followed by the full developer reference.
Future<String> loadExtensionSkill() async {
  final header = await rootBundle.loadString('assets/developer/skill_header.md');
  final reference = await rootBundle.loadString('docs/building-apps.md');
  // Drop the reference's own H1; the header already introduces it.
  final body = reference.replaceFirst(RegExp(r'^# .*\n'), '');
  return '$header$body';
}

/// A minimal working extension to start from (plus the AI skill).
Future<Uint8List> buildStarterTemplate() async {
  const manifest = '''{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "What it does, in one or two sentences.",
  "category": "Tools",
  "icon": "tool",
  "color": "#2563EB",
  "entry": "index.html",
  "permissions": [],
  "author": "You"
}
''';
  const html = '''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Extension</title>
  <link rel="stylesheet" href="/__webdeck/ui.css">
</head>
<body>
  <div class="wd-app" style="max-width:720px">
    <div class="wd-header">
      <div class="wd-icon">🧩</div>
      <div><h1>My Extension</h1><div class="wd-sub">Edit index.html and app.js to make it yours</div></div>
    </div>
    <div class="wd-card">
      <div class="wd-row">
        <input class="wd-input wd-grow" id="text" placeholder="Write a note">
        <button class="wd-btn wd-btn-primary" id="add">Add</button>
      </div>
      <div class="wd-list" id="list" style="margin-top:12px"></div>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>
''';
  const js = r'''(() => {
  const wd = window.webdeck;
  const notes = wd.db.collection('notes'); // private storage, kept across updates
  const $ = (id) => document.getElementById(id);

  async function render() {
    const items = await notes.find(null, { sort: '-_createdAt' });
    $('list').innerHTML = items.length
      ? items.map((n) => `<div class="wd-item"><div class="wd-grow">${wd.ui.escape(n.text)}</div>
          <button class="wd-btn wd-btn-sm wd-btn-ghost" data-rm="${n._id}">✕</button></div>`).join('')
      : '<div class="wd-empty">Nothing yet. Add your first note.</div>';
  }

  $('add').onclick = async () => {
    const text = $('text').value.trim();
    if (!text) return;
    await notes.insert({ text });
    $('text').value = '';
    render();
  };
  $('list').onclick = async (e) => {
    const id = e.target.dataset.rm;
    if (id) { await notes.remove(id); render(); }
  };
  render();
})();
''';
  const readme = '''# My Extension

1. Change "id" (lowercase, permanent) and "name" in webdeck.json.
2. Edit index.html / app.js. The SDK is `window.webdeck` (see SKILL.md for the full reference).
3. Zip this folder and install it in WebDeck: Home → Add → Install web app.
4. To publish: Store → Build extension → Submit for review.

Tip: give SKILL.md to any AI assistant and describe what you want; it will write the files for you.
''';
  final skill = await loadExtensionSkill();
  final archive = Archive();
  void add(String name, String text) {
    final bytes = utf8.encode(text);
    archive.addFile(ArchiveFile('my-extension/$name', bytes.length, bytes));
  }

  add('webdeck.json', manifest);
  add('index.html', html);
  add('app.js', js);
  add('README.md', readme);
  add('SKILL.md', skill);
  return Uint8List.fromList(ZipEncoder().encode(archive));
}

const _examplePrompt =
    'Using the webdeck-extension skill, build a WebDeck extension that tracks my '
    'daily water intake: a big "+250 ml" button, a progress ring toward a 2 L goal, '
    'a 7-day history chart, and a reminder notification every 2 hours while WebDeck is open.';

class _ExtensionBuilderDialog extends StatelessWidget {
  const _ExtensionBuilderDialog();

  Future<void> _saveSkillZip(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final skill = utf8.encode(await loadExtensionSkill());
      final archive = Archive()
        ..addFile(ArchiveFile('webdeck-extension/SKILL.md', skill.length, skill));
      final bytes = Uint8List.fromList(ZipEncoder().encode(archive));
      final path = await FilePicker.saveFile(
        dialogTitle: 'Save the WebDeck extension skill',
        fileName: 'webdeck-extension-skill.zip',
        bytes: bytes,
      );
      if (path != null) {
        messenger.showSnackBar(SnackBar(content: Text('Skill saved to $path')));
      }
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not save the skill: $e'), backgroundColor: WebDeckTheme.accentRed),
      );
    }
  }

  Future<void> _saveTemplate(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final path = await FilePicker.saveFile(
        dialogTitle: 'Save the starter template',
        fileName: 'webdeck-extension-template.zip',
        bytes: await buildStarterTemplate(),
      );
      if (path != null) messenger.showSnackBar(SnackBar(content: Text('Template saved to $path')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not save: $e'), backgroundColor: WebDeckTheme.accentRed));
    }
  }

  /// Validates a zip and submits it to the WebDeck Store for owner review.
  Future<void> _submit(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final cloud = context.read<CloudService>();
    final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['zip']);
    if (file == null) return;
    final Uint8List bytes;
    try {
      if (file.path == null) return;
      bytes = await File(file.path!).readAsBytes();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not read the zip: $e'), backgroundColor: WebDeckTheme.accentRed));
      return;
    }
    WebDeckManifest manifest;
    Map<String, dynamic> manifestJson;
    try {
      final files = StoreService.unpackZip(bytes);
      final raw = files[WebDeckManifest.fileName];
      if (raw == null) throw const FormatException('The zip has no webdeck.json at its top level.');
      manifestJson = (jsonDecode(utf8.decode(raw)) as Map).cast<String, dynamic>();
      manifest = WebDeckManifest.fromJson(manifestJson);
      if (!files.containsKey(manifest.entry)) {
        throw FormatException('The entry page "${manifest.entry}" is missing from the zip.');
      }
      if (!RegExp(r'^[a-z0-9][a-z0-9_-]{1,63}$').hasMatch(manifest.id)) {
        throw const FormatException('"id" must be 2–64 lowercase letters, digits, "-" or "_".');
      }
      if (bytes.length > 25 * 1024 * 1024) throw const FormatException('The zip must be 25 MB or smaller.');
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Not a valid extension: ${e is FormatException ? e.message : e}'), backgroundColor: WebDeckTheme.accentRed));
      return;
    }
    if (!context.mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: Text('Submit ${manifest.name}?'),
        content: Text(
          'id: ${manifest.id} · version ${manifest.version}\n'
          'Permissions: ${manifest.permissions.isEmpty ? 'none' : manifest.permissions.join(', ')}\n\n'
          'It will appear in everyone\'s Store after the WebDeck team reviews and approves it. '
          'You can keep using it on your own devices right away.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit for review')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await cloud.start();
      await cloud.submitExtension(zip: bytes, manifest: manifestJson);
      messenger.showSnackBar(SnackBar(content: Text('${manifest.name} submitted. Status: waiting for review.')));
    } on CloudException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message), backgroundColor: WebDeckTheme.accentRed));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Submit failed: $e'), backgroundColor: WebDeckTheme.accentRed));
    }
  }

  Future<void> _showSubmissions(BuildContext context) async {
    final cloud = context.read<CloudService>();
    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: WebDeckTheme.surface,
        title: const Text('My submissions'),
        content: SizedBox(
          width: 460,
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: cloud.start().then((_) => cloud.mySubmissions()),
            builder: (_, snap) {
              if (snap.hasError) return Text('${snap.error}');
              if (!snap.hasData) return const SizedBox(height: 80, child: Center(child: CircularProgressIndicator()));
              final rows = snap.data!;
              if (rows.isEmpty) return const Text('Nothing submitted yet.');
              return ListView(
                shrinkWrap: true,
                children: [
                  for (final r in rows)
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(switch (r['status']) {
                        'approved' => Icons.check_circle,
                        'rejected' => Icons.cancel,
                        _ => Icons.hourglass_top,
                      }, color: switch (r['status']) {
                        'approved' => WebDeckTheme.accentGreen,
                        'rejected' => WebDeckTheme.accentRed,
                        _ => WebDeckTheme.textSecondary,
                      }),
                      title: Text('${r['name']} · v${r['version']}'),
                      subtitle: Text([
                        switch (r['status']) { 'approved' => 'Approved: live in the Store', 'rejected' => 'Not approved', _ => 'Waiting for review' },
                        if ((r['review_note'] as String?)?.isNotEmpty == true) r['review_note'],
                      ].join(' · ')),
                    ),
                ],
              );
            },
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  Future<void> _copySkill(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: await loadExtensionSkill()));
    messenger.showSnackBar(
      const SnackBar(content: Text('Skill copied. Paste it into any AI chat, then describe your extension.')),
    );
  }

  Future<void> _installLocal(BuildContext context) async {
    final catalog = context.read<CatalogViewModel>();
    if (!context.mounted) return;
    final navigator = Navigator.of(context);
    final rootContext = navigator.context;
    navigator.pop();
    if (!rootContext.mounted) return;
    await showDialog(
      context: rootContext,
      barrierDismissible: !catalog.isInstalling,
      builder: (_) => InstallAppDialog(
        viewModel: catalog,
        onInstalledLaunch: (app) {
          if (app.isRuntimeApp && rootContext.mounted) {
            openRuntimeApp(rootContext, catalog, app);
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 600;
    return Dialog(
      backgroundColor: WebDeckTheme.surface,
      insetPadding: EdgeInsets.symmetric(horizontal: narrow ? 12 : 40, vertical: 24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 8, 6),
              child: Row(
                children: [
                  const Icon(Icons.extension, color: WebDeckTheme.primary),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text('Build an extension', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Extensions are small tools made of HTML, CSS and JavaScript plus a webdeck.json file. '
                      'WebDeck gives them storage, internet access, files, notifications and background checks, '
                      'so they need no server. You can write one yourself or have an AI build it for you.',
                      style: TextStyle(color: WebDeckTheme.textSecondary, height: 1.45),
                    ),
                    _Step(
                      n: 1,
                      title: 'Give your AI the WebDeck skill',
                      body: 'The skill teaches any AI assistant how WebDeck extensions work.\n'
                          '• Claude: save the .zip and upload it in Settings → Capabilities → Skills.\n'
                          '• ChatGPT, Gemini and others: copy it and paste it at the start of the chat, or attach it as a file.',
                      actions: [
                        FilledButton.icon(
                          onPressed: () => _saveSkillZip(context),
                          icon: const Icon(Icons.download, size: 18),
                          label: const Text('Save skill (.zip)'),
                        ),
                        OutlinedButton.icon(
                          onPressed: () => _copySkill(context),
                          icon: const Icon(Icons.copy, size: 18),
                          label: const Text('Copy for any AI'),
                        ),
                        OutlinedButton.icon(
                          onPressed: () => _saveTemplate(context),
                          icon: const Icon(Icons.folder_zip_outlined, size: 18),
                          label: const Text('Starter template'),
                        ),
                      ],
                    ),
                    _Step(
                      n: 2,
                      title: 'Describe what you want',
                      body: 'Say what it should do, what it shows, and whether it should check things in the background. For example:',
                      extra: Container(
                        width: double.infinity,
                        margin: const EdgeInsets.only(top: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: WebDeckTheme.surfaceSubtle,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: WebDeckTheme.border),
                        ),
                        child: const SelectableText(_examplePrompt, style: TextStyle(fontSize: 13, height: 1.4)),
                      ),
                      actions: [
                        TextButton.icon(
                          onPressed: () async {
                            final messenger = ScaffoldMessenger.of(context);
                            await Clipboard.setData(const ClipboardData(text: _examplePrompt));
                            messenger.showSnackBar(const SnackBar(content: Text('Example prompt copied')));
                          },
                          icon: const Icon(Icons.copy, size: 16),
                          label: const Text('Copy example'),
                        ),
                      ],
                    ),
                    _Step(
                      n: 3,
                      title: 'Install and test it',
                      body: 'Put the files the AI gives you in one folder (or zip it), then install it here. '
                          'Anyone can run their own extensions locally; no approval needed. '
                          'Bump "version" in webdeck.json and install again to update; your data is kept.',
                      actions: [
                        FilledButton.tonalIcon(
                          onPressed: () => _installLocal(context),
                          icon: const Icon(Icons.upload_file, size: 18),
                          label: const Text('Install from zip or folder'),
                        ),
                      ],
                    ),
                    _Step(
                      n: 4,
                      title: 'Publish it to the WebDeck Store',
                      body: 'Submit your zip for review. Once approved, everyone can install it from the Store '
                          '(Community). Updates are reviewed too: bump "version" and submit again.\n'
                          'Prefer to host it yourself? Put the zip and a catalog JSON on GitHub and add the URL '
                          'in Settings → Store sources.',
                      actions: [
                        FilledButton.icon(
                          onPressed: () => _submit(context),
                          icon: const Icon(Icons.publish, size: 18),
                          label: const Text('Submit for review'),
                        ),
                        TextButton.icon(
                          onPressed: () => _showSubmissions(context),
                          icon: const Icon(Icons.list_alt, size: 18),
                          label: const Text('My submissions'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  final int n;
  final String title;
  final String body;
  final Widget? extra;
  final List<Widget> actions;

  const _Step({required this.n, required this.title, required this.body, this.extra, this.actions = const []});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: WebDeckTheme.primary.withValues(alpha: 0.2),
            child: Text('$n', style: const TextStyle(fontWeight: FontWeight.w800, color: WebDeckTheme.primary)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(color: WebDeckTheme.textSecondary, height: 1.45)),
                ?extra,
                if (actions.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Wrap(spacing: 8, runSpacing: 8, children: actions),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
