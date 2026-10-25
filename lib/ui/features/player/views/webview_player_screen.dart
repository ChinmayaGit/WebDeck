import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';

class WebViewPlayerScreen extends StatefulWidget {
  final InstalledApp app;
  final String launchUrl;
  final int port;

  const WebViewPlayerScreen({
    super.key,
    required this.app,
    required this.launchUrl,
    required this.port,
  });

  @override
  State<WebViewPlayerScreen> createState() => _WebViewPlayerScreenState();
}

class _WebViewPlayerScreenState extends State<WebViewPlayerScreen> {
  WebViewController? _controller;
  bool _isLoading = true;
  bool _isWebViewSupported = true;
  bool _showControls = false;
  String? _initError;

  @override
  void initState() {
    super.initState();
    _initWebView();
  }

  void _initWebView() {
    try {
      // Ensure platform WebView implementation is registered
      if (WebViewPlatform.instance == null) {
        if (!kIsWeb && (Platform.isMacOS || Platform.isIOS)) {
          WebKitWebViewPlatform.registerWith();
        } else if (!kIsWeb && Platform.isAndroid) {
          AndroidWebViewPlatform.registerWith();
        }
      }

      late final PlatformWebViewControllerCreationParams params;
      if (WebViewPlatform.instance is WebKitWebViewPlatform) {
        params = WebKitWebViewControllerCreationParams(
          allowsInlineMediaPlayback: true,
          mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
        );
      } else if (WebViewPlatform.instance is AndroidWebViewPlatform) {
        params = AndroidWebViewControllerCreationParams();
      } else {
        params = const PlatformWebViewControllerCreationParams();
      }

      final controller = WebViewController.fromPlatformCreationParams(params)
        ..setJavaScriptMode(JavaScriptMode.unrestricted);

      // setBackgroundColor calls setOpaque which is only supported on iOS/Android, not macOS NSView
      if (!kIsWeb && !Platform.isMacOS) {
        controller.setBackgroundColor(WebDeckTheme.background);
      }

      controller.setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (String url) {
            if (mounted) setState(() => _isLoading = true);
          },
          onPageFinished: (String url) {
            if (mounted) setState(() => _isLoading = false);
          },
          onWebResourceError: (WebResourceError error) {
            debugPrint('WebView resource error: ${error.description}');
          },
        ),
      );

      if (controller.platform is AndroidWebViewController) {
        AndroidWebViewController.enableDebugging(true);
        (controller.platform as AndroidWebViewController)
            .setMediaPlaybackRequiresUserGesture(false);
      }

      controller.loadRequest(Uri.parse(widget.launchUrl));

      _controller = controller;
      _isWebViewSupported = true;
    } catch (e, stack) {
      debugPrint('WebView initialization error: $e\n$stack');
      setState(() {
        _isWebViewSupported = false;
        _initError = e.toString();
        _isLoading = false;
      });
    }
  }

  void _openInExternalBrowser() async {
    final uri = Uri.parse(widget.launchUrl);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    // True in-app native browser experience without external browser windows or URL bars
    return Scaffold(
      backgroundColor: WebDeckTheme.background,
      body: SafeArea(
        top: !_showControls,
        bottom: false,
        child: Stack(
          children: [
            // Embedded Native WebView (Full Screen)
            Positioned.fill(
              child: _isWebViewSupported && _controller != null
                  ? WebViewWidget(controller: _controller!)
                  : _buildFallbackView(),
            ),

            // Subtle top progress bar while loading
            if (_isLoading && _isWebViewSupported)
              const Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(
                  minHeight: 2.5,
                  backgroundColor: Colors.transparent,
                  valueColor: AlwaysStoppedAnimation(WebDeckTheme.primary),
                ),
              ),

            // Floating Minimal Control Capsule (Hover or tap to reveal)
            Positioned(
              top: 12,
              right: 16,
              child: MouseRegion(
                onEnter: (_) => setState(() => _showControls = true),
                onExit: (_) => setState(() => _showControls = false),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: WebDeckTheme.surface.withValues(
                      alpha: _showControls ? 0.95 : 0.6,
                    ),
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                      color: WebDeckTheme.border.withValues(
                        alpha: _showControls ? 0.9 : 0.4,
                      ),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.3),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_showControls) ...[
                        Text(
                          widget.app.name,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: WebDeckTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (_isWebViewSupported && _controller != null)
                          IconButton(
                            icon: const Icon(Icons.refresh, size: 16),
                            tooltip: 'Reload',
                            visualDensity: VisualDensity.compact,
                            onPressed: () => _controller?.reload(),
                          ),
                        IconButton(
                          icon: const Icon(Icons.open_in_browser, size: 16),
                          tooltip: 'Open in System Browser',
                          visualDensity: VisualDensity.compact,
                          onPressed: _openInExternalBrowser,
                        ),
                        const SizedBox(width: 4),
                      ],
                      IconButton(
                        icon: const Icon(Icons.close, size: 18),
                        tooltip: 'Exit App',
                        visualDensity: VisualDensity.compact,
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFallbackView() {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  color: WebDeckTheme.accentRed.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: WebDeckTheme.accentRed.withValues(alpha: 0.3),
                    width: 2,
                  ),
                ),
                child: const Icon(
                  Icons.error_outline,
                  color: WebDeckTheme.accentRed,
                  size: 36,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'In-App WebView Error',
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: WebDeckTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'The embedded in-app browser could not initialize on this host:\n${_initError ?? "Unknown platform view error"}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  color: WebDeckTheme.textSecondary,
                ),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: _initWebView,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry In-App Browser'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
