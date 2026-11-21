import 'package:flutter/material.dart';

import '../../../../data/models/installed_app.dart';
import '../../../../runtime/app_icons.dart';
import '../../../core/theme.dart';
import '../view_models/catalog_view_model.dart';

/// Asks for a website and saves it as a web shortcut. Returns the new entry.
Future<InstalledApp?> showAddWebShortcutDialog(BuildContext context, CatalogViewModel viewModel) {
  return showDialog<InstalledApp>(context: context, builder: (_) => _AddShortcutDialog(viewModel: viewModel));
}

class _AddShortcutDialog extends StatefulWidget {
  final CatalogViewModel viewModel;
  const _AddShortcutDialog({required this.viewModel});

  @override
  State<_AddShortcutDialog> createState() => _AddShortcutDialogState();
}

class _AddShortcutDialogState extends State<_AddShortcutDialog> {
  final _url = TextEditingController();
  final _name = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final icon = await AppGlyphs.renderPng('globe', '#2563EB');
      final app = await widget.viewModel.addWebShortcut(name: _name.text, url: _url.text, fallbackIconPng: icon);
      if (mounted) Navigator.pop(context, app);
    } on FormatException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: WebDeckTheme.surface,
      title: const Row(
        children: [
          Icon(Icons.bookmark_add_outlined, color: WebDeckTheme.primary),
          SizedBox(width: 10),
          Text('Add web shortcut'),
        ],
      ),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Any website, opened inside WebDeck like an app. You can also pin it to your home screen.',
              style: TextStyle(color: WebDeckTheme.textSecondary, height: 1.4),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _url,
              autofocus: true,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'Website address', hintText: 'https://example.com'),
              onSubmitted: (_) => _busy ? null : _save(),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Name (optional)'),
              onSubmitted: (_) => _busy ? null : _save(),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: WebDeckTheme.accentRed)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: _busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Add'),
        ),
      ],
    );
  }
}
