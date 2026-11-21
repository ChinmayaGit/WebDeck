import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';
import 'data/repositories/app_repository.dart';
import 'data/services/archive_extractor_service.dart';
import 'data/services/github_service.dart';
import 'data/services/local_server_service.dart';
import 'data/services/storage_service.dart';
import 'runtime/app_data_store.dart';
import 'runtime/cloud_service.dart';
import 'runtime/job_scheduler.dart';
import 'runtime/link_service.dart';
import 'runtime/notification_service.dart';
import 'runtime/runtime_host.dart';
import 'runtime/settings_service.dart';
import 'runtime/shortcut_service.dart';
import 'runtime/store_service.dart';
import 'runtime/tools_service.dart';
import 'ui/core/theme.dart';
import 'ui/features/catalog/view_models/catalog_view_model.dart';
import 'ui/features/jobs/job_runner_host.dart';
import 'ui/features/shell/app_launcher.dart';
import 'ui/features/auth/auth_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Register native platform WebView implementations for macOS, iOS and Android
  if (WebViewPlatform.instance == null) {
    if (!kIsWeb && (Platform.isMacOS || Platform.isIOS)) {
      WebKitWebViewPlatform.registerWith();
    } else if (!kIsWeb && Platform.isAndroid) {
      AndroidWebViewPlatform.registerWith();
    }
  }

  final storageService = StorageService();
  final gitHubService = GitHubService();
  final extractorService = ArchiveExtractorService();
  final serverService = LocalServerService();

  final repository = AppRepository(
    gitHubService: gitHubService,
    extractorService: extractorService,
    storageService: storageService,
    serverService: serverService,
  );

  // ---- WebDeck runtime: the shared backend every runtime app uses.
  final baseDir = storageService.getBaseDirectory;
  final settings = SettingsService(baseDir);
  await settings.load();
  final notifications = NotificationService(baseDir, settings);
  await notifications.load();
  final dataStore = AppDataStore(baseDir);
  final tools = ToolsService(baseDir);
  final runtime = RuntimeHost(
    data: dataStore,
    settings: settings,
    notifications: notifications,
    tools: tools,
    baseDir: baseDir,
  );
  serverService.runtimeHost = runtime;
  final link = LinkService(baseDir, notifications);
  await link.load();
  runtime.link = link;
  final cloud = CloudService(notifications);
  runtime.cloud = cloud;
  unawaited(cloud.start());
  repository.dataStore = dataStore;

  final scheduler = JobScheduler(
    apps: repository.getInstalledApps,
    ensureServer: (app) async {
      final wasRunning = repository.isAppRunning(app.id);
      final instance = await repository.launchApp(app);
      return ServerHandle(instance.launchUrl, wasRunning);
    },
    stopServer: repository.stopApp,
    settings: settings,
    store: dataStore,
  );
  runtime.jobs = scheduler;
  runtime.confirm = _confirmPrompt;
  runtime.openExternalUrl = (uri) => launchUrl(uri, mode: LaunchMode.externalApplication);
  final localAuth = LocalAuthentication();
  runtime.biometricAvailable = () async =>
      await localAuth.isDeviceSupported() && (await localAuth.getAvailableBiometrics()).isNotEmpty;
  runtime.biometricVerify = (reason) =>
      localAuth.authenticate(localizedReason: reason, biometricOnly: true, persistAcrossBackgrounding: true);

  final store = StoreService(repository: repository, settings: settings)..cloud = cloud;
  final catalog = CatalogViewModel(repository, settings: settings);
  unawaited(
    store.refresh().then((_) => store.updateBundledApps()).then((n) {
      if (n > 0) catalog.loadApps();
    }),
  );
  scheduler.start();

  unawaited(ShortcutService.listen(navigatorKey, catalog));
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: catalog),
        ChangeNotifierProvider.value(value: settings),
        ChangeNotifierProvider.value(value: notifications),
        ChangeNotifierProvider.value(value: tools),
        ChangeNotifierProvider.value(value: scheduler),
        ChangeNotifierProvider.value(value: store),
        ChangeNotifierProvider.value(value: link),
        ChangeNotifierProvider.value(value: cloud),
        ChangeNotifierProvider(create: (_) => ShellNavigation()),
        Provider.value(value: storageService),
        Provider.value(value: runtime),
      ],
      child: const WebDeckApp(),
    ),
  );
}

/// Permission-style prompt shown when a runtime app asks for something sensitive.
Future<bool> _confirmPrompt(String title, String message) async {
  final context = navigatorKey.currentContext;
  if (context == null) return false;
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: WebDeckTheme.surface,
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Allow')),
      ],
    ),
  );
  return result ?? false;
}

class WebDeckApp extends StatelessWidget {
  const WebDeckApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WebDeck',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: WebDeckTheme.darkTheme,
      home: const AuthGate(),
      builder: (context, child) => Stack(
        textDirection: TextDirection.ltr,
        children: [
          if (child != null) Positioned.fill(child: child),
          const JobRunnerHost(),
        ],
      ),
    );
  }
}
