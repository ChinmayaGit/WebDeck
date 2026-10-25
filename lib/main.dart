import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';
import 'data/repositories/app_repository.dart';
import 'data/services/archive_extractor_service.dart';
import 'data/services/github_service.dart';
import 'data/services/local_server_service.dart';
import 'data/services/storage_service.dart';
import 'ui/core/theme.dart';
import 'ui/features/catalog/view_models/catalog_view_model.dart';
import 'ui/features/catalog/views/home_screen.dart';

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

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(
          create: (_) => CatalogViewModel(repository),
        ),
      ],
      child: const WebDeckApp(),
    ),
  );
}

class WebDeckApp extends StatelessWidget {
  const WebDeckApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WebDeck - Local App Store',
      debugShowCheckedModeBanner: false,
      theme: WebDeckTheme.darkTheme,
      home: const HomeScreen(),
    );
  }
}
