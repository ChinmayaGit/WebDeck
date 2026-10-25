import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:path/path.dart' as p;

import '../models/installed_app.dart';
import 'storage_service.dart';

class BackupService {
  final StorageService _storageService;

  BackupService({StorageService? storageService})
    : _storageService = storageService ?? StorageService();

  /// Creates a complete .zip backup containing apps_registry.json and all installed app directories
  Future<File> createBackupArchive(Directory destinationDir) async {
    final apps = await _storageService.loadRegistry();

    final archive = Archive();

    // 1. Add apps_registry.json
    final registryJson = jsonEncode(apps.map((a) => a.toJson()).toList());
    final registryBytes = utf8.encode(registryJson);
    archive.addFile(
      ArchiveFile('apps_registry.json', registryBytes.length, registryBytes),
    );

    // 2. Add each app directory
    for (final app in apps) {
      final appDir = Directory(app.installedPath);
      if (await appDir.exists()) {
        await for (final entity in appDir.list(recursive: true)) {
          if (entity is File) {
            final rel = p.relative(entity.path, from: appDir.path);
            final archivePath = 'apps/${app.id}/$rel';
            final bytes = await entity.readAsBytes();
            archive.addFile(ArchiveFile(archivePath, bytes.length, bytes));
          }
        }
      }
    }

    final zipData = ZipEncoder().encode(archive);
    final timestamp = DateTime.now().toIso8601String().replaceAll(':', '-');
    final backupFile = File(
      p.join(destinationDir.path, 'webdeck_backup_$timestamp.zip'),
    );

    await backupFile.writeAsBytes(Uint8List.fromList(zipData));
    return backupFile;
  }

  /// Restores all apps and database records from a .zip backup archive
  Future<int> restoreFromBackup(File backupZipFile) async {
    final bytes = await backupZipFile.readAsBytes();
    final archive = ZipDecoder().decodeBytes(bytes);

    final baseDir = await _storageService.getBaseDirectory();
    final appsDir = await _storageService.getAppsDirectory();

    List<InstalledApp> backupApps = [];

    // Extract all files
    for (final file in archive) {
      if (file.name == 'apps_registry.json') {
        final content = utf8.decode(file.content as List<int>);
        final list = jsonDecode(content) as List<dynamic>;
        backupApps = list
            .map((item) => InstalledApp.fromJson(item as Map<String, dynamic>))
            .toList();
        continue;
      }

      if (file.name.startsWith('apps/')) {
        final destPath = p.join(baseDir.path, file.name);
        if (file.isFile) {
          final outFile = File(destPath);
          await outFile.parent.create(recursive: true);
          await outFile.writeAsBytes(file.content as List<int>, flush: true);
        } else {
          await Directory(destPath).create(recursive: true);
        }
      }
    }

    // Merge restored apps with new base directory paths
    final currentApps = await _storageService.loadRegistry();
    var restoredCount = 0;

    for (final backupApp in backupApps) {
      final updatedInstalledPath = p.join(appsDir.path, backupApp.id);
      final mergedApp = backupApp.copyWith(installedPath: updatedInstalledPath);

      final existingIndex = currentApps.indexWhere((a) => a.id == mergedApp.id);
      if (existingIndex >= 0) {
        currentApps[existingIndex] = mergedApp;
      } else {
        currentApps.add(mergedApp);
      }
      restoredCount++;
    }

    await _storageService.saveRegistry(currentApps);
    return restoredCount;
  }
}
