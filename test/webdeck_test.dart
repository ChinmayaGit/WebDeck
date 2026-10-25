import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:webdeck/data/models/installed_app.dart';
import 'package:webdeck/data/repositories/app_repository.dart';
import 'package:webdeck/data/services/archive_extractor_service.dart';
import 'package:webdeck/data/services/demo_apps_factory.dart';
import 'package:webdeck/data/services/github_service.dart';
import 'package:webdeck/data/services/local_server_service.dart';
import 'package:webdeck/data/services/storage_service.dart';

void main() {
  group('GitHubService Tests', () {
    final service = GitHubService();

    test('parses owner/repo shorthand', () {
      final coords = service.parseInput('flutter/gallery');
      expect(coords.owner, 'flutter');
      expect(coords.repo, 'gallery');
      expect(coords.isDirectZip, isFalse);
    });

    test('parses full github.com URL', () {
      final coords = service.parseInput('https://github.com/excalidraw/excalidraw.git');
      expect(coords.owner, 'excalidraw');
      expect(coords.repo, 'excalidraw');
      expect(coords.isDirectZip, isFalse);
    });

    test('parses direct zip url', () {
      final coords = service.parseInput('https://example.com/builds/my-app-v1.zip');
      expect(coords.owner, 'direct');
      expect(coords.repo, 'my-app-v1');
      expect(coords.isDirectZip, isTrue);
      expect(coords.directZipUrl, 'https://example.com/builds/my-app-v1.zip');
    });

    test('throws FormatException on malformed input', () {
      expect(() => service.parseInput('   '), throwsFormatException);
    });
  });

  group('Multi-Framework Support & SPA Routing Tests', () {
    late Directory tempDir;
    late StorageService storage;
    late ArchiveExtractorService extractor;
    late LocalServerService server;
    late AppRepository repository;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('webdeck_framework_test_');
      storage = StorageService(customBaseDir: tempDir);
      extractor = ArchiveExtractorService();
      server = LocalServerService();
      repository = AppRepository(
        storageService: storage,
        extractorService: extractor,
        serverService: server,
      );
    });

    tearDown(() async {
      await server.stopAll();
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('Installs demo web bundle, verifies manifest, and serves via loopback HTTP', () async {
      final zipBytes = DemoAppsFactory.createArcadeDemoZip();

      final app = await repository.installFromBytes(
        appId: 'test_neon_game',
        name: 'Test Neon Game',
        version: '1.0.0',
        description: 'Test Description',
        zipBytes: zipBytes,
      );

      expect(app.id, 'test_neon_game');
      expect(app.name, 'Neon Arcade 2048');
      expect(app.entryHtml, 'index.html');
      expect(app.framework, 'HTML5 App');

      // Spin up embedded loopback server
      final instance = await repository.launchApp(app);
      expect(instance.port, greaterThan(1024));
      expect(repository.isAppRunning(app.id), isTrue);

      final response = await http.get(Uri.parse(instance.launchUrl));
      expect(response.statusCode, 200);
      expect(response.body, contains('Neon Arcade'));
      expect(response.headers['access-control-allow-origin'], '*');

      await repository.stopApp(app.id);
    });

    test('Supports React/Vue/Angular SPA Client-Side Routing (History API Fallback)', () async {
      // Create a mock React app inside a dist/ folder
      final archive = Archive();
      const reactIndex = '<!DOCTYPE html><html><body><div id="root">React App</div></body></html>';
      const reactJs = 'console.log("react bundle");';

      archive.addFile(ArchiveFile('dist/index.html', reactIndex.length, utf8.encode(reactIndex)));
      archive.addFile(ArchiveFile('dist/assets/index-react.js', reactJs.length, utf8.encode(reactJs)));

      final zipBytes = Uint8List.fromList(ZipEncoder().encode(archive));

      final app = await repository.installFromBytes(
        appId: 'my_react_spa',
        name: 'React SPA',
        version: '2.0.0',
        description: 'Vite React App',
        zipBytes: zipBytes,
      );

      expect(app.framework, 'React / Vite');
      expect(app.webRootRelative, 'dist');

      final instance = await repository.launchApp(app);

      // 1. Direct root access
      final rootRes = await http.get(Uri.parse(instance.launchUrl));
      expect(rootRes.statusCode, 200);
      expect(rootRes.body, contains('React App'));

      // 2. Direct asset access
      final assetRes = await http.get(Uri.parse('${instance.launchUrl}assets/index-react.js'));
      expect(assetRes.statusCode, 200);
      expect(assetRes.body, contains('react bundle'));

      // 3. SPA Route (e.g. /dashboard/analytics): Should return index.html with 200 OK
      final spaRouteRes = await http.get(Uri.parse('${instance.launchUrl}dashboard/analytics'));
      expect(spaRouteRes.statusCode, 200);
      expect(spaRouteRes.body, contains('React App'));

      await repository.stopApp(app.id);
    });

    test('Supports Flutter Web builds (build/web/ with WASM/JS)', () async {
      final archive = Archive();
      const flutterIndex = '<!DOCTYPE html><html><head><base href="/"></head><body>Flutter Web</body></html>';
      const flutterJs = 'window._flutter = {};';

      archive.addFile(ArchiveFile('build/web/index.html', flutterIndex.length, utf8.encode(flutterIndex)));
      archive.addFile(ArchiveFile('build/web/flutter.js', flutterJs.length, utf8.encode(flutterJs)));

      final zipBytes = Uint8List.fromList(ZipEncoder().encode(archive));

      final app = await repository.installFromBytes(
        appId: 'flutter_web_app',
        name: 'Flutter App',
        version: '1.0.0',
        description: 'Compiled Flutter Web Build',
        zipBytes: zipBytes,
      );

      expect(app.framework, 'Flutter Web');
      expect(app.webRootRelative, 'build/web');

      final instance = await repository.launchApp(app);
      final res = await http.get(Uri.parse(instance.launchUrl));
      expect(res.statusCode, 200);
      expect(res.body, contains('Flutter Web'));

      await repository.stopApp(app.id);
    });

    test('Supports Sideloading from Local Directory directly', () async {
      final localBuildDir = Directory('${tempDir.path}/local_angular_build/dist/my-app');
      await localBuildDir.create(recursive: true);

      final indexFile = File('${localBuildDir.path}/index.html');
      await indexFile.writeAsString('<!DOCTYPE html><html><body><app-root></app-root></body></html>');

      final jsFile = File('${localBuildDir.path}/runtime-es2015.js');
      await jsFile.writeAsString('console.log("angular");');

      final app = await repository.installFromLocalDirectory(
        sourceDir: localBuildDir,
        customName: 'Imported Angular App',
      );

      expect(app.name, 'Imported Angular App');
      expect(app.framework, 'Angular');

      final instance = await repository.launchApp(app);
      final res = await http.get(Uri.parse(instance.launchUrl));
      expect(res.statusCode, 200);
      expect(res.body, contains('app-root'));

      await repository.stopApp(app.id);
    });

    test('Correctly serves nested subfolder archives (like GitHub main.zip) without 404', () async {
      final appDir = Directory('${tempDir.path}/nested_repo_app');
      final nestedFolder = Directory('${appDir.path}/MyRepo-main/public');
      await nestedFolder.create(recursive: true);

      final indexFile = File('${nestedFolder.path}/index.html');
      await indexFile.writeAsString('<!DOCTYPE html><html><body><h1>Nested Web App Works</h1></body></html>');

      // Create an app record simulating previously installed nested repo
      final app = InstalledApp(
        id: 'nested_repo_app',
        name: 'Nested Repo App',
        description: 'Repo with nested main folder',
        version: 'main',
        repoUrl: 'https://github.com/test/repo',
        installedPath: appDir.path,
        entryHtml: 'MyRepo-main/public/index.html',
        installedAt: DateTime.now(),
        sizeBytes: 1024,
      );

      final instance = await repository.launchApp(app);
      expect(instance.launchUrl, startsWith('http://127.0.0.1:'));

      // Root request must return 200 OK with the nested index.html content (NOT 404 Not Found)
      final res = await http.get(Uri.parse(instance.launchUrl));
      expect(res.statusCode, 200);
      expect(res.body, contains('Nested Web App Works'));

      await repository.stopApp(app.id);
    });

    test('Consistent port assignment guarantees persistent LocalStorage and IndexedDB origins', () async {
      final port1 = server.getConsistentPortForApp('my_react_spa');
      final port2 = server.getConsistentPortForApp('my_react_spa');
      expect(port1, port2);
      expect(port1, greaterThanOrEqualTo(15000));
    });

    test('BackupService exports all apps and restores them completely', () async {
      final zipBytes = DemoAppsFactory.createArcadeDemoZip();
      await repository.installFromBytes(
        appId: 'backup_test_app',
        name: 'Backup Test App',
        version: '1.0.0',
        description: 'Test Description',
        zipBytes: zipBytes,
      );

      final backupDir = Directory('${tempDir.path}/backups');
      await backupDir.create();

      // Export
      final backupFile = await repository.createBackup(backupDir);
      expect(await backupFile.exists(), isTrue);
      expect(await backupFile.length(), greaterThan(0));

      // Restore to a fresh storage
      final restoreTempDir = Directory('${tempDir.path}/restore_target');
      await restoreTempDir.create();
      final restoreStorage = StorageService(customBaseDir: restoreTempDir);
      final restoreRepo = AppRepository(storageService: restoreStorage);

      final restoredCount = await restoreRepo.restoreBackup(backupFile);
      expect(restoredCount, greaterThan(0));

      final restoredApps = await restoreRepo.getInstalledApps();
      expect(restoredApps.isNotEmpty, isTrue);
    });

    test('Detects Python companion script, SQLite DB, and backend port like PlayStorePurchaseTracker', () async {
      final appDir = Directory('${tempDir.path}/play_store_tracker');
      await appDir.create(recursive: true);

      // Create index.html with the message seen in PlayStorePurchaseTracker
      final indexHtml = File('${appDir.path}/index.html');
      await indexHtml.writeAsString('''
<!DOCTYPE html>
<html>
<body>
  <h1>No apps yet</h1>
  <p>The library is stored on disk. Run python3 serve.py and open http://127.0.0.1:8765 — do not open this HTML file in the browser.</p>
</body>
</html>
''');

      // Create serve.py that uses sqlite3
      final servePy = File('${appDir.path}/serve.py');
      await servePy.writeAsString('''
import sqlite3
import http.server

PORT = 8765
db = sqlite3.connect("library.db")
print(f"Starting server on port {PORT}")
''');

      // Create dummy library.db SQLite database file
      final dbFile = File('${appDir.path}/library.db');
      await dbFile.writeAsString('SQLite format 3\x00');

      // Inspect directory using ArchiveExtractorService
      final bundleInfo = await extractor.inspectDirectory(appDir);

      expect(bundleInfo.backendRequirement, isNotNull);
      final req = bundleInfo.backendRequirement!;
      expect(req.requiresPython, isTrue);
      expect(req.pythonScript, 'serve.py');
      expect(req.hasDatabase, isTrue);
      expect(req.databasePath, contains('library.db'));
      expect(req.backendPort, 8765);
      expect(req.setupInstructions, contains('python3 serve.py'));
      expect(req.setupInstructions, contains('8765'));

      // Check port probing
      final isListening = await repository.isPortListening(8765);
      // Port is not yet running
      expect(isListening, isFalse);

      // Install and verify backendRequirement is saved on InstalledApp
      final app = await repository.installFromLocalDirectory(
        sourceDir: appDir,
        customName: 'PlayStorePurchaseTracker',
      );

      expect(app.backendRequirement, isNotNull);
      expect(app.backendRequirement!.requiresPython, isTrue);
      expect(app.backendRequirement!.backendPort, 8765);

      // Verify resolveBackendRequirement returns the requirement
      final resolved = await repository.resolveBackendRequirement(app);
      expect(resolved, isNotNull);
      expect(resolved!.backendPort, 8765);

      // Verify startCompanionBackend can start with requirement parameter
      // even if app model had null backendRequirement
      final appWithoutReq = app.copyWith(backendRequirement: null);
      final process = await repository.startCompanionBackend(
        appWithoutReq,
        requirement: resolved,
      );
      expect(process.pid, greaterThan(0));
      expect(repository.isCompanionRunning(app.id), isTrue);

      await repository.stopCompanionBackend(app.id);
      expect(repository.isCompanionRunning(app.id), isFalse);
    });
  });
}
