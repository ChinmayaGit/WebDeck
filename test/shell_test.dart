import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:webdeck/data/repositories/app_repository.dart';
import 'package:webdeck/data/services/local_server_service.dart';
import 'package:webdeck/data/services/storage_service.dart';
import 'package:webdeck/runtime/app_data_store.dart';
import 'package:webdeck/runtime/app_icons.dart';
import 'package:webdeck/runtime/job_scheduler.dart';
import 'package:webdeck/runtime/link_service.dart';
import 'package:webdeck/runtime/notification_service.dart';
import 'package:webdeck/runtime/settings_service.dart';
import 'package:webdeck/runtime/store_service.dart';
import 'package:webdeck/runtime/tools_service.dart';
import 'package:webdeck/ui/core/theme.dart';
import 'package:webdeck/ui/features/catalog/view_models/catalog_view_model.dart';
import 'package:webdeck/ui/features/shell/app_launcher.dart';
import 'package:webdeck/ui/features/shell/shell_screen.dart';

void main() {
  for (final size in const [Size(1280, 820), Size(390, 844)]) {
    testWidgets('shell renders Store, Activity and Settings at ${size.width.toInt()}px', (tester) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      late Directory tmp;
      await tester.runAsync(() async => tmp = await Directory.systemTemp.createTemp('webdeck_shell_'));
      addTearDown(() => tmp.deleteSync(recursive: true));
      Future<Directory> base() async => tmp;

      final storage = StorageService(customBaseDir: tmp);
      final repo = AppRepository(storageService: storage, serverService: LocalServerService());
      final settings = SettingsService(base);
      final notifications = NotificationService(base, settings);
      final tools = ToolsService(base);
      final data = AppDataStore(base);
      final scheduler = JobScheduler(
        apps: repo.getInstalledApps,
        ensureServer: (_) async => const ServerHandle('http://127.0.0.1:1/', true),
        stopServer: (_) async {},
        settings: settings,
        store: data,
      );
      final store = StoreService(repository: repo, settings: settings);
      final link = LinkService(base, notifications);
      final catalog = CatalogViewModel(repo);
      await tester.runAsync(() async {
        await store.refresh();
        await catalog.loadApps();
        await notifications.post(appId: 'free-games', appName: 'Free Games', title: 'Free now: Test Game');
      });

      await tester.pumpWidget(MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: catalog),
          ChangeNotifierProvider.value(value: settings),
          ChangeNotifierProvider.value(value: notifications),
          ChangeNotifierProvider.value(value: tools),
          ChangeNotifierProvider.value(value: scheduler),
          ChangeNotifierProvider.value(value: store),
          ChangeNotifierProvider.value(value: link),
          ChangeNotifierProvider(create: (_) => ShellNavigation()),
          Provider.value(value: storage),
        ],
        child: MaterialApp(theme: WebDeckTheme.darkTheme, home: const ShellScreen()),
      ));
      await tester.pump();

      final nav = Provider.of<ShellNavigation>(tester.element(find.byType(ShellScreen)), listen: false);

      nav.value = ShellNavigation.store;
      await tester.pump();
      expect(store.entries.length, 51);
      expect(store.categories.take(4), ['PDF', 'Image', 'Video', 'Audio']);
      expect(find.text('WebDeck Store'), findsOneWidget);
      final scroller = find.byType(Scrollable).first;
      await tester.scrollUntilVisible(find.text('Categories'), 200, scrollable: scroller);
      await tester.scrollUntilVisible(find.text('Featured'), 200, scrollable: scroller);
      // Category rows further down offer "See all", which opens the filtered grid.
      for (var i = 0; i < 40 && find.text('See all').hitTestable().evaluate().isEmpty; i++) {
        await tester.drag(scroller, const Offset(0, -200));
        await tester.pump();
      }
      await tester.pump();
      await tester.tap(find.text('See all').hitTestable().first);
      await tester.pump();
      expect(find.byTooltip('Back to Store'), findsOneWidget);
      await tester.tap(find.byTooltip('Back to Store'));
      await tester.pump();
      for (var i = 0; i < 40 && find.text('Media Downloader').evaluate().isEmpty; i++) {
        await tester.drag(find.byType(Scrollable).first, const Offset(0, -250));
        await tester.pump();
      }
      expect(find.text('Media Downloader'), findsWidgets);
      await tester.tap(find.text('Media Downloader').first);
      await tester.pump();
      expect(find.text('Run helper programs (yt-dlp, ffmpeg, pandoc, LibreOffice)'), findsOneWidget);
      await tester.tap(find.text('Close'));
      await tester.pump();

      nav.value = ShellNavigation.activity;
      await tester.pump();
      expect(find.text('Free now: Test Game'), findsOneWidget);

      nav.value = ShellNavigation.settings;
      await tester.pump();
      expect(find.text('Developer mode'), findsOneWidget);
      expect(find.text('Background checks'), findsWidgets);

      // Leaving Activity marked the inbox read.
      expect(notifications.unreadCount, 0);
    });
  }

  testWidgets('glyph icons render to PNG', (tester) async {
    final png = await tester.runAsync(() => AppGlyphs.renderPng('download', '#EF4444', size: 64));
    expect(png!.sublist(1, 4), [0x50, 0x4E, 0x47]); // "PNG"
  });
}
