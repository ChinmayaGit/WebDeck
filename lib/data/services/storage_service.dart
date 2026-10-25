import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import '../models/installed_app.dart';

class StorageService {
  final Directory? customBaseDir;

  StorageService({this.customBaseDir});

  Future<Directory> getBaseDirectory() async {
    final custom = customBaseDir;
    if (custom != null) {
      if (!await custom.exists()) {
        await custom.create(recursive: true);
      }
      return custom;
    }

    final docDir = await getApplicationDocumentsDirectory();
    final webDeckDir = Directory(p.join(docDir.path, 'WebDeck'));

    // Seamless fallback to previously installed sandboxed container data if present on macOS
    if (Platform.isMacOS) {
      final home = Platform.environment['HOME'];
      if (home != null) {
        final sandboxedWebDeck = Directory(
          p.join(home, 'Library/Containers/com.webdeck.launcher.webdeck/Data/Documents/WebDeck'),
        );
        final sandboxedRegistry = File(p.join(sandboxedWebDeck.path, 'apps_registry.json'));
        final regularRegistry = File(p.join(webDeckDir.path, 'apps_registry.json'));

        if (await sandboxedRegistry.exists() && !await regularRegistry.exists()) {
          return sandboxedWebDeck;
        }
      }
    }

    if (!await webDeckDir.exists()) {
      await webDeckDir.create(recursive: true);
    }
    return webDeckDir;
  }

  Future<Directory> getAppsDirectory() async {
    final baseDir = await getBaseDirectory();
    final appsDir = Directory(p.join(baseDir.path, 'apps'));
    if (!await appsDir.exists()) {
      await appsDir.create(recursive: true);
    }
    return appsDir;
  }

  Future<File> _getRegistryFile() async {
    final baseDir = await getBaseDirectory();
    return File(p.join(baseDir.path, 'apps_registry.json'));
  }

  Future<List<InstalledApp>> loadRegistry() async {
    final file = await _getRegistryFile();
    if (!await file.exists()) {
      return [];
    }
    try {
      final content = await file.readAsString();
      final list = jsonDecode(content) as List<dynamic>;
      return list
          .map((item) => InstalledApp.fromJson(item as Map<String, dynamic>))
          .toList();
    } catch (e) {
      // If corrupted, fallback gracefully
      return [];
    }
  }

  Future<void> saveRegistry(List<InstalledApp> apps) async {
    final file = await _getRegistryFile();
    final jsonString = jsonEncode(apps.map((a) => a.toJson()).toList());
    await file.writeAsString(jsonString, flush: true);
  }

  Future<void> saveOrUpdateApp(InstalledApp app) async {
    final apps = await loadRegistry();
    final index = apps.indexWhere((a) => a.id == app.id);
    if (index >= 0) {
      apps[index] = app;
    } else {
      apps.add(app);
    }
    await saveRegistry(apps);
  }

  Future<void> deleteApp(String appId) async {
    final apps = await loadRegistry();
    final index = apps.indexWhere((a) => a.id == appId);
    if (index >= 0) {
      final app = apps[index];
      final appDir = Directory(app.installedPath);
      if (await appDir.exists()) {
        await appDir.delete(recursive: true);
      }
      apps.removeAt(index);
      await saveRegistry(apps);
    }
  }
}
