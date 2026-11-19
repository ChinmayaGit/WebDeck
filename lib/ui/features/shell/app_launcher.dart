import 'package:flutter/material.dart';

import '../../../data/models/installed_app.dart';
import '../../core/theme.dart';
import '../catalog/view_models/catalog_view_model.dart';
import '../player/views/webview_player_screen.dart';

/// Opens a runtime app (no backend checks needed: WebDeck is its backend).
Future<void> openRuntimeApp(BuildContext context, CatalogViewModel viewModel, InstalledApp app) async {
  try {
    final instance = await viewModel.launchApp(app);
    if (!context.mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => WebViewPlayerScreen(app: app, launchUrl: instance.launchUrl, port: instance.port),
      ),
    );
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Failed to open ${app.name}: $e'), backgroundColor: WebDeckTheme.accentRed),
    );
  }
}

/// Selected tab of the main shell, shared so screens can jump to e.g. the Store.
class ShellNavigation extends ValueNotifier<int> {
  ShellNavigation() : super(0);

  static const apps = 0;
  static const store = 1;
  static const activity = 2;
  static const settings = 3;
}
