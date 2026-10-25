import 'dart:io';
import 'dart:typed_data';
import 'package:path/path.dart' as p;
import '../models/backend_requirement.dart';
import '../models/install_progress.dart';
import '../models/installed_app.dart';
import '../services/archive_extractor_service.dart';
import '../services/backup_service.dart';
import '../services/github_service.dart';
import '../services/local_server_service.dart';
import '../services/storage_service.dart';

class AppRepository {
  final GitHubService _gitHubService;
  final ArchiveExtractorService _extractorService;
  final StorageService _storageService;
  final LocalServerService _serverService;
  final BackupService _backupService;

  AppRepository({
    GitHubService? gitHubService,
    ArchiveExtractorService? extractorService,
    StorageService? storageService,
    LocalServerService? serverService,
    BackupService? backupService,
  })  : _gitHubService = gitHubService ?? GitHubService(),
        _extractorService = extractorService ?? ArchiveExtractorService(),
        _storageService = storageService ?? StorageService(),
        _serverService = serverService ?? LocalServerService(),
        _backupService = backupService ?? BackupService(storageService: storageService);

  LocalServerService get serverService => _serverService;
  BackupService get backupService => _backupService;

  Future<List<InstalledApp>> getInstalledApps() async {
    return await _storageService.loadRegistry();
  }

  Future<RunningAppInstance> launchApp(InstalledApp app) async {
    return await _serverService.startAppServer(app);
  }

  Future<void> stopApp(String appId) async {
    await _serverService.stopAppServer(appId);
  }

  bool isAppRunning(String appId) => _serverService.isAppRunning(appId);

  bool isCompanionRunning(String appId) => _serverService.isCompanionRunning(appId);

  List<String> getCompanionLogs(String appId) => _serverService.getCompanionLogs(appId);

  Future<bool> isPortListening(int port) => _serverService.isPortListening(port);

  Future<Process> startCompanionBackend(
    InstalledApp app, {
    BackendRequirement? requirement,
  }) =>
      _serverService.startCompanionBackend(app, requirement: requirement);

  Future<void> stopCompanionBackend(String appId) =>
      _serverService.stopCompanionBackend(appId);

  /// Checks if an app has or needs backend requirements detection
  Future<BackendRequirement?> resolveBackendRequirement(InstalledApp app) async {
    if (app.backendRequirement != null) {
      return app.backendRequirement;
    }
    final targetDir = Directory(app.installedPath);
    if (await targetDir.exists()) {
      final entities = await targetDir.list(recursive: true).toList();
      final req = await _extractorService.detectBackendRequirements(targetDir, entities);
      if (req != null) {
        final updated = app.copyWith(backendRequirement: req);
        await _storageService.saveOrUpdateApp(updated);
        return req;
      }
    }
    return null;
  }

  Future<void> uninstallApp(String appId) async {
    await _serverService.stopAppServer(appId);
    await _storageService.deleteApp(appId);
  }

  /// Updates an app's custom display icon from an image file on the user's computer
  Future<InstalledApp> updateAppIcon(String appId, File imageFile) async {
    final apps = await _storageService.loadRegistry();
    final index = apps.indexWhere((a) => a.id == appId);
    if (index < 0) {
      throw Exception('App with ID $appId not found.');
    }

    final app = apps[index];
    final ext = p.extension(imageFile.path).isNotEmpty ? p.extension(imageFile.path) : '.png';
    final targetPath = p.join(app.installedPath, 'custom_icon$ext');

    // Copy to app directory
    await imageFile.copy(targetPath);

    final updatedApp = app.copyWith(localIconPath: targetPath);
    await _storageService.saveOrUpdateApp(updatedApp);
    return updatedApp;
  }

  /// Checks for updates and pulls latest code from the app's repoUrl
  Future<InstalledApp> checkAndUpdateApp(
    String appId, {
    String? token,
    void Function(InstallProgress)? onProgress,
  }) async {
    final apps = await _storageService.loadRegistry();
    final index = apps.indexWhere((a) => a.id == appId);
    if (index < 0) {
      throw Exception('App with ID $appId not found.');
    }

    final app = apps[index];
    if (app.repoUrl.isEmpty || app.repoUrl.startsWith('local://') || app.repoUrl.startsWith('file://')) {
      throw Exception('Cannot update locally imported app from remote repository.');
    }

    await _serverService.stopAppServer(appId);

    return await installFromSource(
      sourceInput: app.repoUrl,
      token: token,
      customName: app.name,
      onProgress: onProgress,
    );
  }

  /// Creates a .zip backup of all apps and database records
  Future<File> createBackup(Directory destinationDir) async {
    return await _backupService.createBackupArchive(destinationDir);
  }

  /// Restores apps from a .zip backup archive
  Future<int> restoreBackup(File backupZipFile) async {
    return await _backupService.restoreFromBackup(backupZipFile);
  }

  /// Installs an application from GitHub repo (release or default branch) or direct release zip URL
  Future<InstalledApp> installFromSource({
    required String sourceInput,
    String? token,
    String? customName,
    void Function(InstallProgress)? onProgress,
  }) async {
    void report(InstallProgress progress) {
      if (onProgress != null) onProgress(progress);
    }

    try {
      final coords = _gitHubService.parseInput(sourceInput);
      String downloadUrl;
      String releaseTag;
      String? releaseDescription;

      if (coords.isDirectZip) {
        downloadUrl = coords.directZipUrl!;
        releaseTag = 'direct';
        report(InstallProgress(
          status: InstallStatus.downloading,
          progress: 0.1,
          message: 'Connecting to direct zip source...',
        ));
      } else {
        report(InstallProgress.resolving('${coords.owner}/${coords.repo}'));
        final release = await _gitHubService.fetchLatestRelease(
          coords.owner,
          coords.repo,
          token: token,
        );

        final zipAsset = release.preferredZipAsset;
        if (zipAsset == null) {
          throw Exception(
            'No web build archives found for ${coords.owner}/${coords.repo}.',
          );
        }

        downloadUrl = zipAsset.browserDownloadUrl;
        releaseTag = release.tagName;
        releaseDescription = release.name.isNotEmpty ? release.name : release.body;
      }

      // Download Asset
      report(InstallProgress.downloading(0.0, '0 MB'));
      final zipBytes = await _gitHubService.downloadAsset(
        downloadUrl,
        token: token,
        onProgress: (received, total) {
          final progressFraction = total > 0 ? (received / total).clamp(0.0, 1.0) : 0.5;
          final receivedMb = (received / (1024 * 1024)).toStringAsFixed(1);
          final totalMb = total > 0 ? (total / (1024 * 1024)).toStringAsFixed(1) : '?';
          report(InstallProgress.downloading(
            progressFraction,
            '$receivedMb MB / $totalMb MB',
          ));
        },
      );

      // Extract to apps/<app_id>/
      report(InstallProgress.extracting());
      final appId = _sanitizeId('${coords.owner}_${coords.repo}');
      final appsDir = await _storageService.getAppsDirectory();
      final targetAppDir = Directory(p.join(appsDir.path, appId));

      final bundleInfo = await _extractorService.extractAndInspect(
        zipBytes: zipBytes,
        targetDir: targetAppDir,
      );

      // Verify and register
      report(InstallProgress.verifying());

      final appName = customName?.trim().isNotEmpty == true
          ? customName!
          : (bundleInfo.manifestName ?? coords.repo);

      final app = InstalledApp(
        id: appId,
        name: appName,
        description: bundleInfo.manifestDescription ?? releaseDescription ?? 'Installed from $sourceInput',
        version: bundleInfo.manifestVersion ?? releaseTag,
        repoUrl: sourceInput,
        iconUrl: null,
        localIconPath: bundleInfo.localIconPath,
        installedPath: targetAppDir.path,
        webRootRelative: bundleInfo.webRootRelative,
        entryHtml: bundleInfo.entryHtmlRelative,
        framework: bundleInfo.detectedFramework,
        backendRequirement: bundleInfo.backendRequirement,
        installedAt: DateTime.now(),
        sizeBytes: bundleInfo.totalSizeBytes,
      );

      await _storageService.saveOrUpdateApp(app);
      report(InstallProgress.completed(app.name));
      return app;
    } catch (e) {
      report(InstallProgress.failed(e.toString()));
      rethrow;
    }
  }

  /// Installs an app from a local .zip file
  Future<InstalledApp> installFromLocalZipFile({
    required File zipFile,
    String? customName,
    void Function(InstallProgress)? onProgress,
  }) async {
    void report(InstallProgress progress) {
      if (onProgress != null) onProgress(progress);
    }

    try {
      report(InstallProgress.extracting());
      final baseName = p.basenameWithoutExtension(zipFile.path);
      final appId = _sanitizeId('local_zip_$baseName');
      final appsDir = await _storageService.getAppsDirectory();
      final targetAppDir = Directory(p.join(appsDir.path, appId));

      final zipBytes = await zipFile.readAsBytes();
      final bundleInfo = await _extractorService.extractAndInspect(
        zipBytes: zipBytes,
        targetDir: targetAppDir,
      );

      report(InstallProgress.verifying());

      final app = InstalledApp(
        id: appId,
        name: customName?.trim().isNotEmpty == true
            ? customName!
            : (bundleInfo.manifestName ?? baseName),
        description: bundleInfo.manifestDescription ?? 'Local build imported from ${p.basename(zipFile.path)}',
        version: bundleInfo.manifestVersion ?? '1.0.0',
        repoUrl: 'file://${zipFile.path}',
        localIconPath: bundleInfo.localIconPath,
        installedPath: targetAppDir.path,
        webRootRelative: bundleInfo.webRootRelative,
        entryHtml: bundleInfo.entryHtmlRelative,
        framework: bundleInfo.detectedFramework,
        backendRequirement: bundleInfo.backendRequirement,
        installedAt: DateTime.now(),
        sizeBytes: bundleInfo.totalSizeBytes,
      );

      await _storageService.saveOrUpdateApp(app);
      report(InstallProgress.completed(app.name));
      return app;
    } catch (e) {
      report(InstallProgress.failed(e.toString()));
      rethrow;
    }
  }

  /// Installs an app by copying a local compiled folder (e.g. dist/, build/web/, out/)
  Future<InstalledApp> installFromLocalDirectory({
    required Directory sourceDir,
    String? customName,
    void Function(InstallProgress)? onProgress,
  }) async {
    void report(InstallProgress progress) {
      if (onProgress != null) onProgress(progress);
    }

    try {
      report(InstallProgress.extracting());
      final folderName = p.basename(sourceDir.path);
      final appId = _sanitizeId('local_dir_$folderName');
      final appsDir = await _storageService.getAppsDirectory();
      final targetAppDir = Directory(p.join(appsDir.path, appId));

      final bundleInfo = await _extractorService.copyDirectoryAndInspect(
        sourceDir: sourceDir,
        targetDir: targetAppDir,
      );

      report(InstallProgress.verifying());

      final app = InstalledApp(
        id: appId,
        name: customName?.trim().isNotEmpty == true
            ? customName!
            : (bundleInfo.manifestName ?? folderName),
        description: bundleInfo.manifestDescription ?? 'Local build copied from ${sourceDir.path}',
        version: bundleInfo.manifestVersion ?? '1.0.0',
        repoUrl: 'file://${sourceDir.path}',
        localIconPath: bundleInfo.localIconPath,
        installedPath: targetAppDir.path,
        webRootRelative: bundleInfo.webRootRelative,
        entryHtml: bundleInfo.entryHtmlRelative,
        framework: bundleInfo.detectedFramework,
        backendRequirement: bundleInfo.backendRequirement,
        installedAt: DateTime.now(),
        sizeBytes: bundleInfo.totalSizeBytes,
      );

      await _storageService.saveOrUpdateApp(app);
      report(InstallProgress.completed(app.name));
      return app;
    } catch (e) {
      report(InstallProgress.failed(e.toString()));
      rethrow;
    }
  }

  /// Installs a local static web app bundle directly from memory (for demo)
  Future<InstalledApp> installFromBytes({
    required String appId,
    required String name,
    required String version,
    required String description,
    required Uint8List zipBytes,
    void Function(InstallProgress)? onProgress,
  }) async {
    void report(InstallProgress progress) {
      if (onProgress != null) onProgress(progress);
    }

    try {
      report(InstallProgress.extracting());
      final safeId = _sanitizeId(appId);
      final appsDir = await _storageService.getAppsDirectory();
      final targetAppDir = Directory(p.join(appsDir.path, safeId));

      final bundleInfo = await _extractorService.extractAndInspect(
        zipBytes: zipBytes,
        targetDir: targetAppDir,
      );

      report(InstallProgress.verifying());

      final app = InstalledApp(
        id: safeId,
        name: bundleInfo.manifestName ?? name,
        description: bundleInfo.manifestDescription ?? description,
        version: bundleInfo.manifestVersion ?? version,
        repoUrl: 'local://$safeId',
        localIconPath: bundleInfo.localIconPath,
        installedPath: targetAppDir.path,
        webRootRelative: bundleInfo.webRootRelative,
        entryHtml: bundleInfo.entryHtmlRelative,
        framework: bundleInfo.detectedFramework,
        backendRequirement: bundleInfo.backendRequirement,
        installedAt: DateTime.now(),
        sizeBytes: bundleInfo.totalSizeBytes,
      );

      await _storageService.saveOrUpdateApp(app);
      report(InstallProgress.completed(app.name));
      return app;
    } catch (e) {
      report(InstallProgress.failed(e.toString()));
      rethrow;
    }
  }

  String _sanitizeId(String input) {
    return input.toLowerCase().replaceAll(RegExp(r'[^a-z0-9_-]'), '_');
  }
}
