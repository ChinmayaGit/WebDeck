import 'dart:async';
import 'dart:io';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;

import '../data/models/installed_app.dart';
import '../ui/features/catalog/view_models/catalog_view_model.dart';
import '../ui/features/shell/app_launcher.dart';
import 'app_icons.dart';

/// Home-screen / desktop shortcuts that open one WebDeck app directly, and the
/// `webdeck://open/<appId>` links they use.
class ShortcutService {
  static const _channel = MethodChannel('webdeck/shortcuts');

  static bool get platformSupported => Platform.isAndroid || Platform.isMacOS;

  static Uri linkFor(InstalledApp app) => Uri(scheme: 'webdeck', host: 'open', pathSegments: [app.id]);

  /// Creates a shortcut for [app]. Returns a short message for the user.
  static Future<String> create(InstalledApp app) async {
    final icon = await _iconPng(app);
    if (Platform.isAndroid) {
      final supported = await _channel.invokeMethod<bool>('supported') ?? false;
      if (!supported) throw StateError('Your launcher does not support pinned shortcuts');
      final ok = await _channel.invokeMethod<bool>('pin', {'id': app.id, 'label': app.name, 'icon': icon}) ?? false;
      if (!ok) throw StateError('The launcher declined the shortcut');
      return 'Confirm on the prompt to add ${app.name} to your home screen';
    }
    if (Platform.isMacOS) {
      final path = await _createMacApp(app, icon);
      await Process.run('open', ['-R', path]); // reveal in Finder
      return '${app.name} is now in Applications › WebDeck Apps. Drag it to your Dock.';
    }
    throw UnsupportedError('Shortcuts are available on Android and macOS for now');
  }

  static Future<Uint8List> _iconPng(InstalledApp app) async {
    final path = app.localIconPath;
    if (path != null && path.toLowerCase().endsWith('.png') && await File(path).exists()) {
      return File(path).readAsBytes();
    }
    final m = app.manifest;
    return AppGlyphs.renderPng(m?.icon ?? (app.isWebShortcut ? 'globe' : 'app'), m?.color ?? '#2563EB', size: 512);
  }

  /// A tiny .app bundle whose only job is `open webdeck://open/<id>`.
  static Future<String> _createMacApp(InstalledApp app, Uint8List iconPng) async {
    final home = Platform.environment['HOME'] ?? '';
    final safeName = app.name.replaceAll(RegExp(r'[/:\\]'), '-').trim();
    final bundle = Directory(p.join(home, 'Applications', 'WebDeck Apps', '$safeName.app'));
    if (await bundle.exists()) await bundle.delete(recursive: true);
    final macos = Directory(p.join(bundle.path, 'Contents', 'MacOS'));
    final res = Directory(p.join(bundle.path, 'Contents', 'Resources'));
    await macos.create(recursive: true);
    await res.create(recursive: true);

    final exe = File(p.join(macos.path, 'launcher'));
    await exe.writeAsString('#!/bin/sh\nexec /usr/bin/open "${linkFor(app)}"\n');
    await Process.run('chmod', ['+x', exe.path]);

    final png = File(p.join(res.path, 'icon.png'));
    await png.writeAsBytes(iconPng);
    await Process.run('sips', ['-z', '512', '512', png.path]);
    final icns = await Process.run('sips', ['-s', 'format', 'icns', png.path, '--out', p.join(res.path, 'icon.icns')]);
    await png.delete();

    String esc(String v) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    final bundleId = 'com.webdeck.shortcut.${app.id.replaceAll(RegExp(r'[^A-Za-z0-9.-]'), '-')}';
    await File(p.join(bundle.path, 'Contents', 'Info.plist')).writeAsString('''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${esc(app.name)}</string>
  <key>CFBundleDisplayName</key><string>${esc(app.name)}</string>
  <key>CFBundleIdentifier</key><string>$bundleId</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  ${icns.exitCode == 0 ? '<key>CFBundleIconFile</key><string>icon</string>' : ''}
  <key>LSUIElement</key><true/>
</dict>
</plist>
''');
    await Process.run('touch', [bundle.path]); // refresh Finder's icon cache
    return bundle.path;
  }

  // ------------------------------------------------------------ incoming links

  static StreamSubscription<Uri>? _sub;
  static String? _launchedFromShortcut;

  /// Was the app currently on screen opened from a shortcut?
  static bool isStandalone(String appId) => _launchedFromShortcut == appId;

  /// Leaves the app the way a native one would: back to the home screen.
  static Future<void> leaveStandalone() async {
    _launchedFromShortcut = null;
    if (Platform.isAndroid) {
      try {
        await _channel.invokeMethod('moveToBack');
      } catch (_) {}
    }
  }

  static Future<void> listen(GlobalKey<NavigatorState> navigatorKey, CatalogViewModel catalog) async {
    final links = AppLinks();
    Future<void> handle(Uri uri) async {
      if (uri.scheme != 'webdeck' || uri.host != 'open' || uri.pathSegments.isEmpty) return;
      final id = uri.pathSegments.first;
      // Apps may still be loading right after a cold start.
      for (var i = 0; i < 40 && catalog.apps.isEmpty; i++) {
        await Future.delayed(const Duration(milliseconds: 100));
      }
      final app = catalog.apps.where((a) => a.id == id).firstOrNull;
      final context = navigatorKey.currentContext;
      if (context == null || !context.mounted) return;
      if (app == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('That app is no longer installed')),
        );
        return;
      }
      _launchedFromShortcut = app.id;
      // Start from the home shell so "close" never leaves a stack of players.
      navigatorKey.currentState?.popUntil((r) => r.isFirst);
      await openRuntimeApp(navigatorKey.currentContext!, catalog, app);
    }

    // The stream also delivers the link that cold-started the app.
    Uri? last;
    DateTime? lastAt;
    _sub ??= links.uriLinkStream.listen((uri) {
      final now = DateTime.now();
      if (uri == last && lastAt != null && now.difference(lastAt!) < const Duration(seconds: 2)) return;
      last = uri;
      lastAt = now;
      handle(uri);
    }, onError: (_) {});
  }
}
