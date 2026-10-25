import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:webdeck/data/models/backend_requirement.dart';
import 'package:webdeck/data/models/installed_app.dart';
import 'package:webdeck/data/repositories/app_repository.dart';
import 'package:webdeck/data/services/archive_extractor_service.dart';
import 'package:webdeck/data/services/github_service.dart';
import 'package:webdeck/data/services/local_server_service.dart';
import 'package:webdeck/data/services/storage_service.dart';
import 'package:webdeck/ui/features/catalog/view_models/catalog_view_model.dart';
import 'package:webdeck/ui/features/catalog/views/app_card.dart';
import 'package:webdeck/ui/features/catalog/views/home_screen.dart';
import 'package:webdeck/ui/features/catalog/views/setup_requirement_dialog.dart';

void main() {
  testWidgets('WebDeck HomeScreen smoke test', (WidgetTester tester) async {
    Directory? tempDir;

    await tester.runAsync(() async {
      tempDir = await Directory.systemTemp.createTemp('webdeck_widget_test_');
    });

    addTearDown(() {
      if (tempDir != null && tempDir!.existsSync()) {
        tempDir!.deleteSync(recursive: true);
      }
    });

    final storage = StorageService(customBaseDir: tempDir);
    final repository = AppRepository(
      gitHubService: GitHubService(),
      extractorService: ArchiveExtractorService(),
      storageService: storage,
      serverService: LocalServerService(),
    );

    final viewModel = CatalogViewModel(repository);
    await tester.runAsync(() async {
      await viewModel.loadApps();
    });

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: viewModel),
        ],
        child: const MaterialApp(
          home: HomeScreen(),
        ),
      ),
    );

    await tester.pump();

    // Verify header and empty state
    expect(find.text('WebDeck'), findsOneWidget);
    expect(find.text('Your WebDeck Shelf is Empty'), findsOneWidget);
    expect(find.text('Add from GitHub'), findsOneWidget);
    expect(find.text('Install App'), findsOneWidget);
  });

  testWidgets('AppCard displays Stop beside Play when running, and Launch when stopped',
      (WidgetTester tester) async {
    final sampleApp = InstalledApp(
      id: 'test_app',
      name: 'Sample Web App',
      description: 'A test web application',
      version: '1.0.0',
      repoUrl: 'https://github.com/example/app',
      installedPath: '/tmp/test_app',
      entryHtml: 'index.html',
      framework: 'React / Vite',
      installedAt: DateTime.now(),
      sizeBytes: 1024 * 512,
    );

    var stopPressed = false;
    var launchPressed = false;

    // 1. When running: should show both Stop and Play buttons
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppCard(
            app: sampleApp,
            isRunning: true,
            runningPort: 54321,
            onLaunch: () => launchPressed = true,
            onStop: () => stopPressed = true,
            onUninstall: () {},
            onOpenBrowser: () {},
            onUpdateIcon: () {},
            onCheckUpdate: () {},
          ),
        ),
      ),
    );

    expect(find.text('Stop'), findsOneWidget);
    expect(find.text('Play'), findsOneWidget);
    expect(find.text('Launch'), findsNothing);

    // Tap Stop
    await tester.tap(find.text('Stop'));
    expect(stopPressed, isTrue);

    // Tap Play
    await tester.tap(find.text('Play'));
    expect(launchPressed, isTrue);

    // 2. When not running: should show Launch button and no Stop button
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AppCard(
            app: sampleApp,
            isRunning: false,
            onLaunch: () {},
            onStop: () {},
            onUninstall: () {},
            onOpenBrowser: () {},
            onUpdateIcon: () {},
            onCheckUpdate: () {},
          ),
        ),
      ),
    );

    expect(find.text('Launch'), findsOneWidget);
    expect(find.text('Stop'), findsNothing);
    expect(find.text('Play'), findsNothing);
  });

  testWidgets('SetupRequirementDialog renders requirements, terminal command, and triggers actions',
      (WidgetTester tester) async {
    const backendReq = BackendRequirement(
      requiresPython: true,
      pythonScript: 'serve.py',
      hasDatabase: true,
      databasePath: 'library.db',
      backendPort: 8765,
      setupInstructions: 'Run "python3 serve.py" to start the companion server on port 8765.',
    );

    final testApp = InstalledApp(
      id: 'playstore_tracker',
      name: 'PlayStorePurchaseTracker',
      description: 'App with companion python server and database',
      version: '1.0.0',
      repoUrl: 'https://github.com/ChinmayaGit/PlayStorePurchaseTracker',
      installedPath: '/tmp/playstore_tracker',
      entryHtml: 'index.html',
      framework: 'HTML5 App',
      backendRequirement: backendReq,
      installedAt: DateTime.now(),
      sizeBytes: 1024 * 1024,
    );

    Directory? tempDir;
    await tester.runAsync(() async {
      tempDir = await Directory.systemTemp.createTemp('webdeck_setup_dialog_test_');
    });

    addTearDown(() {
      if (tempDir != null && tempDir!.existsSync()) {
        tempDir!.deleteSync(recursive: true);
      }
    });

    final storage = StorageService(customBaseDir: tempDir);
    final repo = AppRepository(storageService: storage);
    final vm = CatalogViewModel(repo);

    var launchTriggered = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SetupRequirementDialog(
            app: testApp,
            requirement: backendReq,
            viewModel: vm,
            onProceedToLaunch: () => launchTriggered = true,
          ),
        ),
      ),
    );

    await tester.pump();

    // Verify dialog header and badges
    expect(find.text('PlayStorePurchaseTracker'), findsOneWidget);
    expect(find.text('BACKEND REQUIRED'), findsOneWidget);
    expect(find.text('Companion Server & Local Database Setup'), findsOneWidget);

    // Verify detected details
    expect(find.text('Python Script'), findsOneWidget);
    expect(find.text('serve.py'), findsOneWidget);
    expect(find.text('Database'), findsOneWidget);
    expect(find.text('library.db'), findsOneWidget);
    expect(find.text('Required Port'), findsOneWidget);
    expect(find.text('http://127.0.0.1:8765'), findsOneWidget);

    // Verify command snippet
    expect(find.text('Manual Terminal Command:'), findsOneWidget);
    expect(find.text('cd "/tmp/playstore_tracker" && python3 serve.py'), findsOneWidget);

    // Verify buttons
    expect(find.text('Open Folder'), findsOneWidget);
    expect(find.text('Run in Terminal'), findsOneWidget);
    expect(find.text('Launch Anyway'), findsOneWidget);
    expect(find.text('Start Backend & Launch'), findsOneWidget);

    // Tap "Launch Anyway"
    await tester.tap(find.text('Launch Anyway'));
    await tester.pump();
    expect(launchTriggered, isTrue);
  });
}
