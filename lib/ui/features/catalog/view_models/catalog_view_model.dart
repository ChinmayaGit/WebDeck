import 'dart:io';
import 'package:flutter/foundation.dart';
import '../../../../data/models/backend_requirement.dart';
import '../../../../data/models/install_progress.dart';
import '../../../../data/models/installed_app.dart';
import '../../../../data/repositories/app_repository.dart';
import '../../../../data/services/demo_apps_factory.dart';
import '../../../../data/services/local_server_service.dart';

enum ViewMode {
  grid,
  list,
  iconOnly,
}

enum AppSortOption {
  nameAsc,
  nameDesc,
  dateNewest,
  dateOldest,
  sizeLargest,
}

class CatalogViewModel extends ChangeNotifier {
  final AppRepository _repository;

  List<InstalledApp> _apps = [];
  bool _isLoading = false;
  bool _isInstalling = false;
  InstallProgress? _currentInstallProgress;
  String _searchQuery = '';
  String? _errorMessage;

  ViewMode _viewMode = ViewMode.grid;
  AppSortOption _sortOption = AppSortOption.dateNewest;
  String? _selectedFramework;
  bool _onlyRunning = false;

  CatalogViewModel(this._repository) {
    loadApps();
  }

  List<InstalledApp> get apps => _apps;
  bool get isLoading => _isLoading;
  bool get isInstalling => _isInstalling;
  InstallProgress? get currentInstallProgress => _currentInstallProgress;
  String get searchQuery => _searchQuery;
  String? get errorMessage => _errorMessage;

  ViewMode get viewMode => _viewMode;
  AppSortOption get sortOption => _sortOption;
  String? get selectedFramework => _selectedFramework;
  bool get onlyRunning => _onlyRunning;

  List<InstalledApp> get filteredApps {
    var result = List<InstalledApp>.from(_apps);

    // 1. Search Query
    if (_searchQuery.trim().isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      result = result.where((app) {
        return app.name.toLowerCase().contains(q) ||
            app.description.toLowerCase().contains(q) ||
            app.framework.toLowerCase().contains(q) ||
            app.repoUrl.toLowerCase().contains(q);
      }).toList();
    }

    // 2. Framework Filter
    if (_selectedFramework != null && _selectedFramework != 'All') {
      result = result.where((app) => app.framework == _selectedFramework).toList();
    }

    // 3. Only Running Filter
    if (_onlyRunning) {
      result = result.where((app) => isAppRunning(app.id)).toList();
    }

    // 4. Sorting
    result.sort((a, b) {
      switch (_sortOption) {
        case AppSortOption.nameAsc:
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case AppSortOption.nameDesc:
          return b.name.toLowerCase().compareTo(a.name.toLowerCase());
        case AppSortOption.dateNewest:
          return b.installedAt.compareTo(a.installedAt);
        case AppSortOption.dateOldest:
          return a.installedAt.compareTo(b.installedAt);
        case AppSortOption.sizeLargest:
          return b.sizeBytes.compareTo(a.sizeBytes);
      }
    });

    return result;
  }

  List<String> get availableFrameworks {
    final set = {'All'};
    for (final app in _apps) {
      set.add(app.framework);
    }
    return set.toList();
  }

  int get runningCount => _repository.serverService.activeInstances.length;

  bool isAppRunning(String appId) => _repository.serverService.isAppRunning(appId);

  RunningAppInstance? getAppInstance(String appId) =>
      _repository.serverService.getInstance(appId);

  String get totalStorageFormatted {
    final totalBytes = _apps.fold<int>(0, (sum, a) => sum + a.sizeBytes);
    if (totalBytes < 1024 * 1024) {
      return '${(totalBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(totalBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  void setViewMode(ViewMode mode) {
    _viewMode = mode;
    notifyListeners();
  }

  void setSortOption(AppSortOption option) {
    _sortOption = option;
    notifyListeners();
  }

  void setSelectedFramework(String? framework) {
    _selectedFramework = framework;
    notifyListeners();
  }

  void toggleOnlyRunning() {
    _onlyRunning = !_onlyRunning;
    notifyListeners();
  }

  void setSearchQuery(String query) {
    _searchQuery = query;
    notifyListeners();
  }

  Future<void> loadApps() async {
    _isLoading = true;
    _errorMessage = null;
    notifyListeners();

    try {
      _apps = await _repository.getInstalledApps();
    } catch (e) {
      _errorMessage = 'Failed to load installed apps: $e';
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> installFromSource({
    required String sourceUrl,
    String? token,
    String? customName,
  }) async {
    _isInstalling = true;
    _errorMessage = null;
    _currentInstallProgress = InstallProgress.resolving(sourceUrl);
    notifyListeners();

    try {
      await _repository.installFromSource(
        sourceInput: sourceUrl,
        token: token,
        customName: customName,
        onProgress: (progress) {
          _currentInstallProgress = progress;
          notifyListeners();
        },
      );
      await loadApps();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _currentInstallProgress = InstallProgress.failed(e.toString());
      notifyListeners();
      return false;
    } finally {
      _isInstalling = false;
      notifyListeners();
    }
  }

  Future<bool> installFromLocalZipFile({
    required File zipFile,
    String? customName,
  }) async {
    _isInstalling = true;
    _errorMessage = null;
    _currentInstallProgress = const InstallProgress(
      status: InstallStatus.extracting,
      progress: 0.3,
      message: 'Extracting and inspecting local .zip bundle...',
    );
    notifyListeners();

    try {
      await _repository.installFromLocalZipFile(
        zipFile: zipFile,
        customName: customName,
        onProgress: (progress) {
          _currentInstallProgress = progress;
          notifyListeners();
        },
      );
      await loadApps();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _currentInstallProgress = InstallProgress.failed(e.toString());
      notifyListeners();
      return false;
    } finally {
      _isInstalling = false;
      notifyListeners();
    }
  }

  Future<bool> installFromLocalDirectory({
    required Directory directory,
    String? customName,
  }) async {
    _isInstalling = true;
    _errorMessage = null;
    _currentInstallProgress = const InstallProgress(
      status: InstallStatus.extracting,
      progress: 0.3,
      message: 'Importing and copying local build folder...',
    );
    notifyListeners();

    try {
      await _repository.installFromLocalDirectory(
        sourceDir: directory,
        customName: customName,
        onProgress: (progress) {
          _currentInstallProgress = progress;
          notifyListeners();
        },
      );
      await loadApps();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _currentInstallProgress = InstallProgress.failed(e.toString());
      notifyListeners();
      return false;
    } finally {
      _isInstalling = false;
      notifyListeners();
    }
  }

  Future<bool> updateAppIcon(String appId, File imageFile) async {
    try {
      await _repository.updateAppIcon(appId, imageFile);
      await loadApps();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      notifyListeners();
      return false;
    }
  }

  Future<bool> checkAndUpdateApp(String appId) async {
    _isInstalling = true;
    _errorMessage = null;
    _currentInstallProgress = const InstallProgress(
      status: InstallStatus.resolvingRelease,
      progress: 0.2,
      message: 'Checking and updating app from source...',
    );
    notifyListeners();

    try {
      await _repository.checkAndUpdateApp(
        appId,
        onProgress: (progress) {
          _currentInstallProgress = progress;
          notifyListeners();
        },
      );
      await loadApps();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _currentInstallProgress = InstallProgress.failed(e.toString());
      notifyListeners();
      return false;
    } finally {
      _isInstalling = false;
      notifyListeners();
    }
  }

  Future<File> exportBackup(Directory destinationDir) async {
    return await _repository.createBackup(destinationDir);
  }

  Future<int> restoreBackup(File backupZipFile) async {
    final count = await _repository.restoreBackup(backupZipFile);
    await loadApps();
    return count;
  }

  Future<bool> installDemoApp() async {
    _isInstalling = true;
    _errorMessage = null;
    _currentInstallProgress = const InstallProgress(
      status: InstallStatus.extracting,
      progress: 0.5,
      message: 'Generating and unpacking built-in Neon Arcade demo...',
    );
    notifyListeners();

    try {
      final zipBytes = DemoAppsFactory.createArcadeDemoZip();
      await _repository.installFromBytes(
        appId: 'neon_arcade_2048',
        name: 'Neon Arcade 2048',
        version: '1.0.4',
        description: 'An offline mini retro web game built directly into WebDeck.',
        zipBytes: zipBytes,
        onProgress: (progress) {
          _currentInstallProgress = progress;
          notifyListeners();
        },
      );
      await loadApps();
      return true;
    } catch (e) {
      _errorMessage = e.toString();
      _currentInstallProgress = InstallProgress.failed(e.toString());
      notifyListeners();
      return false;
    } finally {
      _isInstalling = false;
      notifyListeners();
    }
  }

  Future<RunningAppInstance> launchApp(InstalledApp app) async {
    final instance = await _repository.launchApp(app);
    notifyListeners();
    return instance;
  }

  Future<void> stopApp(String appId) async {
    await _repository.stopApp(appId);
    notifyListeners();
  }

  Future<bool> isPortListening(int port) => _repository.isPortListening(port);

  Future<BackendRequirement?> resolveBackendRequirement(InstalledApp app) async {
    final req = await _repository.resolveBackendRequirement(app);
    if (req != null && app.backendRequirement == null) {
      final index = _apps.indexWhere((a) => a.id == app.id);
      if (index >= 0) {
        _apps[index] = _apps[index].copyWith(backendRequirement: req);
        notifyListeners();
      }
    }
    return req;
  }

  bool isCompanionRunning(String appId) => _repository.isCompanionRunning(appId);

  List<String> getCompanionLogs(String appId) => _repository.getCompanionLogs(appId);

  Future<void> startCompanionBackend(
    InstalledApp app, {
    BackendRequirement? requirement,
  }) async {
    await _repository.startCompanionBackend(app, requirement: requirement);
    if (requirement != null && app.backendRequirement == null) {
      final index = _apps.indexWhere((a) => a.id == app.id);
      if (index >= 0) {
        _apps[index] = _apps[index].copyWith(backendRequirement: requirement);
      }
    }
    notifyListeners();
  }

  Future<void> stopCompanionBackend(String appId) async {
    await _repository.stopCompanionBackend(appId);
    notifyListeners();
  }

  Future<void> uninstallApp(String appId) async {
    await _repository.uninstallApp(appId);
    await loadApps();
  }
}
