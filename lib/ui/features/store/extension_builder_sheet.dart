import 'dart:convert';

import 'package:archive/archive.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../runtime/settings_service.dart';
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

  Future<void> _copySkill(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: await loadExtensionSkill()));
    messenger.showSnackBar(
      const SnackBar(content: Text('Skill copied. Paste it into any AI chat, then describe your extension.')),
    );
  }

  Future<void> _installLocal(BuildContext context) async {
    final settings = context.read<SettingsService>();
    final catalog = context.read<CatalogViewModel>();
    if (!settings.developerMode) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: WebDeckTheme.surface,
          title: const Text('Turn on Developer mode?'),
          content: const Text(
            'Installing your own extensions from a zip or folder needs Developer mode. '
            'You can turn it off again in Settings.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Turn on')),
          ],
        ),
      );
      if (ok != true) return;
      await settings.setDeveloperMode(true);
    }
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
                          'Bump "version" in webdeck.json and install again to update; your data is kept.',
                      actions: [
                        FilledButton.tonalIcon(
                          onPressed: () => _installLocal(context),
                          icon: const Icon(Icons.upload_file, size: 18),
                          label: const Text('Install from zip or folder'),
                        ),
                      ],
                    ),
                    const _Step(
                      n: 4,
                      title: 'Share it',
                      body: 'Host the zip and a catalog JSON (a GitHub repo with Releases works, for free), '
                          'then add the catalog URL in Settings → Store sources. Everyone who adds that URL '
                          'sees your extensions in their Store and gets your updates.',
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
