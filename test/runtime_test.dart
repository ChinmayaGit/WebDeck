import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:webdeck/data/models/installed_app.dart';
import 'package:webdeck/data/repositories/app_repository.dart';
import 'package:webdeck/data/services/local_server_service.dart';
import 'package:webdeck/data/services/storage_service.dart';
import 'package:webdeck/runtime/app_data_store.dart';
import 'package:webdeck/runtime/manifest.dart';
import 'package:webdeck/runtime/notification_service.dart';
import 'package:webdeck/runtime/runtime_host.dart';
import 'package:webdeck/runtime/settings_service.dart';
import 'package:webdeck/runtime/store_service.dart';
import 'package:webdeck/runtime/tools_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tmp;
  setUp(() async => tmp = await Directory.systemTemp.createTemp('webdeck_rt_'));
  tearDown(() async {
    if (await tmp.exists()) await tmp.delete(recursive: true);
  });

  WebDeckManifest manifest({Set<String> perms = const {}}) => WebDeckManifest(
        id: 'demo-app',
        name: 'Demo App',
        version: '1.0.0',
        permissions: perms,
      );

  InstalledApp app(WebDeckManifest m, {String? path}) => InstalledApp(
        id: m.id,
        name: m.name,
        description: '',
        version: m.version,
        repoUrl: 'store://${m.id}',
        installedPath: path ?? p.join(tmp.path, 'apps', m.id),
        entryHtml: 'index.html',
        installedAt: DateTime(2026),
        sizeBytes: 0,
        manifest: m,
      );

  RuntimeHost host() {
    Future<Directory> base() async => tmp;
    final settings = SettingsService(base);
    return RuntimeHost(
      data: AppDataStore(base),
      settings: settings,
      notifications: NotificationService(base, settings),
      tools: ToolsService(base),
      baseDir: base,
    );
  }

  group('manifest', () {
    test('parses jobs and permissions', () {
      final m = WebDeckManifest.fromJson({
        'id': 'price-tracker',
        'name': 'Price Tracker',
        'permissions': ['net', 'jobs'],
        'jobs': [
          {'id': 'check', 'every': '4h'},
        ],
      });
      expect(m.has('net'), isTrue);
      expect(m.has('tools'), isFalse);
      expect(m.jobs.single.every, const Duration(hours: 4));
      expect(WebDeckManifest.fromJson(m.toJson()).toJson(), m.toJson());
    });

    test('rejects unknown permissions and bad ids', () {
      expect(() => WebDeckManifest.fromJson({'id': 'x-y', 'name': 'X', 'permissions': ['root']}),
          throwsFormatException);
      expect(() => WebDeckManifest.fromJson({'id': '../evil', 'name': 'X'}), throwsFormatException);
    });

    test('job intervals clamp to 5 minutes', () {
      expect(JobSpec.parseInterval('1m'), const Duration(minutes: 5));
      expect(JobSpec.parseInterval('2d'), const Duration(days: 2));
      expect(() => JobSpec.parseInterval('soon'), throwsFormatException);
    });

    test('compareVersions', () {
      expect(compareVersions('1.2.10', '1.2.9'), greaterThan(0));
      expect(compareVersions('1.0', '1.0.0'), 0);
      expect(compareVersions('0.9.9', '1.0.0'), lessThan(0));
    });

    test('InstalledApp round-trips its manifest', () {
      final a = app(manifest(perms: {'net'}));
      final back = InstalledApp.fromJson(jsonDecode(jsonEncode(a.toJson())) as Map<String, dynamic>);
      expect(back.isRuntimeApp, isTrue);
      expect(back.manifest!.has('net'), isTrue);
    });
  });

  group('AppDataStore', () {
    test('CRUD, queries and persistence', () async {
      final store = AppDataStore(() async => tmp);
      final a = await store.insert('app', 'items', {'name': 'A', 'price': 10});
      await store.insert('app', 'items', {'name': 'B', 'price': 25});
      await store.insert('app', 'items', {'name': 'C', 'price': 5, 'paused': true});

      expect((await store.find('app', 'items', where: {'price': {r'$gte': 10}})).length, 2);
      expect((await store.find('app', 'items', where: {'paused': {r'$ne': true}})).length, 2);
      expect((await store.find('app', 'items', sort: '-price', limit: 1)).single['name'], 'B');
      expect((await store.find('app', 'items', where: {'name': {r'$contains': 'b'}})).single['name'], 'B');

      final updated = await store.update('app', 'items', a['_id'] as String, {'price': 8, '_id': 'hijack'});
      expect(updated!['price'], 8);
      expect(updated['_id'], a['_id']);

      expect(await store.removeWhere('app', 'items', {'price': {r'$lt': 9}}), 2);
      await store.kvSet('app', 'seen', [1, 2]);

      // A fresh instance reads everything back from disk.
      final reopened = AppDataStore(() async => tmp);
      expect((await reopened.find('app', 'items')).single['name'], 'B');
      expect(await reopened.kvGet('app', 'seen'), [1, 2]);

      await reopened.deleteAppData('app');
      expect(await AppDataStore(() async => tmp).find('app', 'items'), isEmpty);
    });

    test('rejects path-like collection names', () async {
      final store = AppDataStore(() async => tmp);
      expect(() => store.find('app', '../secrets'), throwsFormatException);
    });

    test('first-touch read racing an insert does not lose the insert', () async {
      final store = AppDataStore(() async => tmp);
      final results = await Future.wait([
        store.find('app', 'items'),
        store.insert('app', 'items', {'n': 1}),
        store.find('app', 'items'),
      ]);
      final inserted = results[1] as Map<String, dynamic>;
      expect(await store.update('app', 'items', inserted['_id'] as String, {'n': 2}), isNotNull);
      expect((await store.find('app', 'items')).single['n'], 2);
    });

    test('concurrent inserts are all kept', () async {
      final store = AppDataStore(() async => tmp);
      await Future.wait(List.generate(25, (i) => store.insert('app', 'log', {'i': i})));
      expect((await AppDataStore(() async => tmp).find('app', 'log')).length, 25);
    });
  });

  group('RuntimeHost API', () {
    test('storage is always available, other features need permissions', () async {
      final h = host();
      final m = manifest();
      final a = app(m);
      final doc = await h.call(a, m, 'db.insert', {'collection': 'x', 'doc': {'v': 1}}) as Map;
      expect(doc['_id'], isNotNull);
      expect(await h.call(a, m, 'db.find', {'collection': 'x'}), hasLength(1));

      expect(
        () => h.call(a, m, 'net.fetch', {'url': 'https://example.com'}),
        throwsA(isA<RuntimeError>().having((e) => e.code, 'code', 'permission_denied')),
      );
      expect(
        () => h.call(a, m, 'tools.run', {'tool': 'yt-dlp'}),
        throwsA(isA<RuntimeError>().having((e) => e.code, 'code', 'permission_denied')),
      );
    });

    test('net.fetch refuses local addresses', () async {
      final h = host();
      final m = manifest(perms: {'net'});
      for (final url in ['http://127.0.0.1:8080/', 'http://localhost/', 'http://169.254.169.254/latest']) {
        expect(
          () => h.call(app(m), m, 'net.fetch', {'url': url}),
          throwsA(isA<RuntimeError>().having((e) => e.code, 'code', 'forbidden')),
          reason: url,
        );
      }
      expect(RuntimeHost.isBlockedHost('[::1]'), isTrue);
      expect(RuntimeHost.isBlockedHost('example.com'), isFalse);
    });

    test('files.save stays inside the app folder', () async {
      final h = host();
      final m = manifest(perms: {'files'});
      final a = app(m);
      final saved = await h.call(a, m, 'files.save', {'name': '../../evil.txt', 'text': 'hi'}) as Map;
      final path = saved['path'] as String;
      expect(p.basename(path), 'evil.txt');
      expect(p.isWithin(tmp.path, path), isTrue);
      expect(await File(path).readAsString(), 'hi');
      final second = await h.call(a, m, 'files.save', {'name': 'evil.txt', 'text': 'again'}) as Map;
      expect(second['name'], 'evil (2).txt');

      expect(
        () => h.call(a, m, 'files.reveal', {'path': '/etc/hosts'}),
        throwsA(isA<RuntimeError>().having((e) => e.code, 'code', 'forbidden')),
      );
    });

    test('handler blocks cross-origin requests and serves the SDK', () async {
      final h = host();
      final m = manifest();
      final handler = h.handlerFor(app(m), m);
      Request req(String path, {String method = 'GET', Map<String, String>? headers, String? body}) =>
          Request(method, Uri.parse('http://127.0.0.1:15123/$path'), headers: headers, body: body);

      final sdk = await handler(req('__webdeck/sdk.js'));
      expect(sdk.statusCode, 200);
      expect(await sdk.readAsString(), contains('window.webdeck'));

      final body = jsonEncode({'method': 'app.info'});
      final evil = await handler(req('__webdeck/api',
          method: 'POST', body: body, headers: {'origin': 'https://evil.example', 'x-webdeck': '1'}));
      expect(evil.statusCode, 403);

      final noHeader = await handler(req('__webdeck/api', method: 'POST', body: body));
      expect(noHeader.statusCode, 403);

      final ok = await handler(req('__webdeck/api',
          method: 'POST', body: body, headers: {'origin': 'http://127.0.0.1:15123', 'x-webdeck': '1'}));
      expect(ok.statusCode, 200);
      expect(jsonDecode(await ok.readAsString())['result']['id'], 'demo-app');
    });
  });

  group('tools', () {
    test('blocks options that execute arbitrary programs', () {
      expect(() => ToolsService.validateArgs('yt-dlp', ['--exec', 'rm -rf ~']), throwsArgumentError);
      expect(() => ToolsService.validateArgs('yt-dlp', ['--exec=echo']), throwsArgumentError);
      expect(() => ToolsService.validateArgs('pandoc', ['--lua-filter', 'x.lua']), throwsArgumentError);
      expect(() => ToolsService.validateArgs('libreoffice', ['-env:UserInstallation=file:///tmp']), throwsArgumentError);
      ToolsService.validateArgs('yt-dlp', ['-f', 'bv*+ba/b', '--', 'https://youtu.be/x']);
    });
  });

  group('SDK injection', () {
    test('adds the SDK as the first script in <head>', () {
      final html = LocalServerService.injectSdk('<html><HEAD lang="x"><title>t</title></head></html>');
      expect(html, '<html><HEAD lang="x"><script src="/__webdeck/sdk.js"></script><title>t</title></head></html>');
      expect(LocalServerService.injectSdk(html), html);
    });
  });

  group('store', () {
    test('every bundled app has a valid manifest and entry page', () async {
      final catalog = jsonDecode(await rootBundle.loadString('assets/store/catalog.json')) as Map<String, dynamic>;
      final assets = await AssetManifest.loadFromAssetBundle(rootBundle);
      final keys = assets.listAssets().toSet();
      for (final id in (catalog['apps'] as List).cast<String>()) {
        final m = WebDeckManifest.fromJson(
          jsonDecode(await rootBundle.loadString('assets/store/$id/webdeck.json')) as Map<String, dynamic>,
        );
        expect(m.id, id);
        expect(keys, contains('assets/store/$id/${m.entry}'));
        for (final j in m.jobs) {
          expect(m.has(RuntimePermission.jobs), isTrue, reason: '$id declares jobs without the jobs permission');
          expect(keys, contains('assets/store/$id/${j.entry}'));
        }
      }
    });

    test('unpackZip strips a single root folder', () {
      final archive = Archive()
        ..addFile(ArchiveFile.bytes('my-app/webdeck.json', utf8.encode('{}')))
        ..addFile(ArchiveFile.bytes('my-app/index.html', utf8.encode('<p>')))
        ..addFile(ArchiveFile.bytes('__MACOSX/junk', [1]));
      final files = StoreService.unpackZip(Uint8List.fromList(ZipEncoder().encode(archive)));
      expect(files.keys.toSet(), {'webdeck.json', 'index.html'});
    });
  });

  group('end to end', () {
    test('install a runtime bundle, serve it, and call the API over HTTP', () async {
      final storage = StorageService(customBaseDir: tmp);
      final server = LocalServerService()..runtimeHost = host();
      final repo = AppRepository(storageService: storage, serverService: server)
        ..dataStore = AppDataStore(() async => tmp);

      final installed = await repo.installRuntimeBundle(files: {
        'webdeck.json': utf8.encode(jsonEncode({'id': 'e2e-app', 'name': 'E2E', 'version': '1.2.0'})),
        'index.html': utf8.encode('<!doctype html><html><head><title>x</title></head><body>hi</body></html>'),
      });
      expect(installed.isRuntimeApp, isTrue);
      expect((await repo.getInstalledApps()).single.manifest!.version, '1.2.0');
      expect(await repo.resolveBackendRequirement(installed), isNull);

      final instance = await repo.launchApp(installed);
      // flutter_test replaces HttpClient with a mock that always answers 400.
      final previousOverrides = HttpOverrides.current;
      HttpOverrides.global = null;
      final client = HttpClient();
      HttpOverrides.global = previousOverrides;
      try {
        final pageReq = await client.getUrl(Uri.parse(instance.launchUrl));
        final page = await (await pageReq.close()).transform(utf8.decoder).join();
        expect(page, contains('<script src="/__webdeck/sdk.js"></script>'));

        Future<Map<String, dynamic>> api(String method, Map<String, dynamic> params) async {
          final r = await client.postUrl(Uri.parse('${instance.launchUrl}__webdeck/api'));
          r.headers
            ..set('content-type', 'application/json')
            ..set('x-webdeck', '1')
            ..set('origin', 'http://127.0.0.1:${instance.port}');
          r.write(jsonEncode({'method': method, 'params': params}));
          return jsonDecode(await (await r.close()).transform(utf8.decoder).join()) as Map<String, dynamic>;
        }

        expect((await api('db.insert', {'collection': 'notes', 'doc': {'t': 'hello'}}))['ok'], isTrue);
        final found = await api('db.find', {'collection': 'notes'});
        expect((found['result'] as List).single['t'], 'hello');
        final denied = await api('notify', {'title': 'x'});
        expect(denied['code'], 'permission_denied');
      } finally {
        client.close(force: true);
        await server.stopAll();
      }

      await repo.uninstallApp('e2e-app');
      expect(await repo.getInstalledApps(), isEmpty);
      expect(await Directory(p.join(tmp.path, 'appdata', 'e2e-app')).exists(), isFalse);
    });
  });
}
