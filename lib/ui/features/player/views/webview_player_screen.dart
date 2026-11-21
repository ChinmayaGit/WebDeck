import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import 'package:provider/provider.dart';

import '../../../../data/models/installed_app.dart';
import '../../../../runtime/app_icons.dart';
import '../../../../runtime/shortcut_service.dart';
import '../../../core/theme.dart';
import '../../catalog/view_models/catalog_view_model.dart';
import '../../catalog/views/backend_console_dialog.dart';

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
  String? _initError;
  String? _pageLoadError;

  @override
  void initState() {
    super.initState();
    _initWebView();
  }

  /// The WebView can only use the mic/camera after the app itself holds the
  /// Android runtime permission, so ask for it before granting the page.
  Future<void> _onMediaPermissionRequest(PlatformWebViewPermissionRequest request) async {
    final wanted = <Permission>[
      if (request.types.contains(WebViewPermissionResourceType.microphone)) Permission.microphone,
      if (request.types.contains(WebViewPermissionResourceType.camera)) Permission.camera,
    ];
    if (wanted.isEmpty) return request.grant();
    var ok = true;
    try {
      final results = await wanted.request();
      ok = results.values.every((s) => s.isGranted || s.isLimited);
    } catch (_) {}
    return ok ? request.grant() : request.deny();
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
            if (mounted) {
              setState(() {
                _isLoading = true;
                _pageLoadError = null;
              });
            }
          },
          onPageFinished: (String url) {
            if (mounted) setState(() => _isLoading = false);
          },
          onWebResourceError: (WebResourceError error) {
            debugPrint('WebView resource error: ${error.description}');
            if (error.isForMainFrame ?? true) {
              if (mounted) {
                setState(() {
                  _pageLoadError = error.description;
                  _isLoading = false;
                });
              }
            }
          },
        ),
      );

      if (controller.platform is WebKitWebViewController) {
        // getUserMedia (calls, scanners): macOS shows its own mic/camera prompt.
        controller.platform.setOnPlatformPermissionRequest((request) => request.grant());
      }

      if (controller.platform is AndroidWebViewController) {
        final androidController = controller.platform as AndroidWebViewController;
        AndroidWebViewController.enableDebugging(true);
        androidController.setMediaPlaybackRequiresUserGesture(false);
        androidController.setAllowFileAccess(true);
        androidController.setAllowContentAccess(true);
        androidController.setMixedContentMode(MixedContentMode.alwaysAllow);
        androidController.setOnPlatformPermissionRequest(_onMediaPermissionRequest);
        androidController.setOnShowFileSelector((FileSelectorParams params) async {
          try {
            FileType pickerType = FileType.any;
            List<String>? allowedExtensions;

            if (params.acceptTypes.isNotEmpty) {
              final types = params.acceptTypes
                  .map((t) => t.trim().toLowerCase())
                  .where((t) => t.isNotEmpty)
                  .toList();
              final allImages = types.isNotEmpty &&
                  types.every((t) => t.startsWith('image/') || t == 'image/*');
              final allAudio = types.isNotEmpty &&
                  types.every((t) => t.startsWith('audio/') || t == 'audio/*');
              final allVideo = types.isNotEmpty &&
                  types.every((t) => t.startsWith('video/') || t == 'video/*');

              if (allImages) {
                pickerType = FileType.image;
              } else if (allAudio) {
                pickerType = FileType.audio;
              } else if (allVideo) {
                pickerType = FileType.video;
              } else {
                final exts = types
                    .where((t) => t.startsWith('.'))
                    .map((t) => t.substring(1))
                    .toList();
                if (exts.isNotEmpty) {
                  pickerType = FileType.custom;
                  allowedExtensions = exts;
                }
              }
            }

            final List<PlatformFile> files;
            if (params.mode == FileSelectorMode.openMultiple) {
              files = await FilePicker.pickFiles(
                type: pickerType,
                allowedExtensions: allowedExtensions,
              );
            } else {
              final single = await FilePicker.pickFile(
                type: pickerType,
                allowedExtensions: allowedExtensions,
              );
              files = single != null ? [single] : [];
            }
            if (files.isNotEmpty) {
              return files
                  .where((f) => f.path != null)
                  .map((f) => Uri.file(f.path!).toString())
                  .toList();
            }
          } catch (e) {
            debugPrint('Android file picker error: $e');
          }
          return [];
        });
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

  void _openBackendConsole() {
    final req = widget.app.backendRequirement;
    if (req == null) return;
    final viewModel = context.read<CatalogViewModel>();
    showDialog(
      context: context,
      builder: (ctx) => BackendConsoleDialog(
        app: widget.app,
        requirement: req,
        viewModel: viewModel,
      ),
    );
  }

  Future<void> _goBack() async {
    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
    } else {
      await _close();
    }
  }

  /// Opened from a home-screen shortcut: closing returns to the home screen,
  /// like a native app, instead of revealing WebDeck.
  Future<void> _close() async {
    final standalone = ShortcutService.isStandalone(widget.app.id);
    if (mounted) Navigator.of(context).pop();
    if (standalone) await ShortcutService.leaveStandalone();
  }

  Future<void> _addShortcut() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      messenger.showSnackBar(SnackBar(content: Text(await ShortcutService.create(widget.app))));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e'), backgroundColor: WebDeckTheme.accentRed));
    }
  }

  PreferredSizeWidget _appBar() {
    final m = widget.app.manifest;
    final ready = _isWebViewSupported && _controller != null;
    return AppBar(
      toolbarHeight: 48,
      backgroundColor: WebDeckTheme.surface,
      surfaceTintColor: Colors.transparent,
      titleSpacing: 0,
      leading: IconButton(
        tooltip: 'Back',
        icon: const Icon(Icons.arrow_back),
        onPressed: _goBack,
      ),
      title: Row(
        children: [
          if (m != null) ...[
            AppGlyphTile(glyph: m.icon, color: m.color, size: 26),
            const SizedBox(width: 10),
          ],
          Flexible(
            child: Text(
              widget.app.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
      actions: [
        if (ready)
          IconButton(
            tooltip: 'Reload',
            icon: const Icon(Icons.refresh),
            onPressed: () => _controller?.reload(),
          ),
        IconButton(
          tooltip: 'Open in system browser',
          icon: const Icon(Icons.open_in_browser),
          onPressed: _openInExternalBrowser,
        ),
        if (widget.app.backendRequirement?.hasRequirements == true)
          IconButton(
            tooltip: 'Backend console (DB / Test API)',
            icon: const Icon(Icons.dns_rounded),
            onPressed: _openBackendConsole,
          ),
        if (ShortcutService.platformSupported)
          IconButton(
            tooltip: Platform.isAndroid ? 'Add to home screen' : 'Create app shortcut',
            icon: const Icon(Icons.add_to_home_screen),
            onPressed: _addShortcut,
          ),
        IconButton(
          tooltip: 'Close app',
          icon: const Icon(Icons.close),
          onPressed: _close,
        ),
        const SizedBox(width: 4),
      ],
      bottom: _isLoading && _isWebViewSupported
          ? const PreferredSize(
              preferredSize: Size.fromHeight(2.5),
              child: LinearProgressIndicator(
                minHeight: 2.5,
                backgroundColor: Colors.transparent,
                valueColor: AlwaysStoppedAnimation(WebDeckTheme.primary),
              ),
            )
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (!didPop) await _goBack();
      },
      child: Scaffold(
        backgroundColor: WebDeckTheme.background,
        appBar: _appBar(),
        body: SafeArea(
          top: false,
          bottom: false,
          child: !_isWebViewSupported
              ? _buildFallbackView()
              : _pageLoadError != null
                  ? _buildPageLoadErrorView()
                  : WebViewWidget(controller: _controller!),
        ),
      ),
    );
  }

  void _retryLoading() {
    setState(() {
      _pageLoadError = null;
      _isLoading = true;
    });
    if (_controller != null) {
      _controller!.loadRequest(Uri.parse(widget.launchUrl));
    } else {
      _initWebView();
    }
  }

  Widget _buildPageLoadErrorView() {
    final req = widget.app.backendRequirement;
    final isVite = req?.requiresViteDev == true;
    final isPython = req?.requiresPython == true;
    final isNode = req?.requiresNode == true;
    final isDotnet = req?.requiresDotnet == true;

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: WebDeckTheme.accentRed.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: WebDeckTheme.accentRed.withValues(alpha: 0.3),
                    width: 2,
                  ),
                ),
                child: const Icon(
                  Icons.wifi_off_rounded,
                  color: WebDeckTheme.accentRed,
                  size: 32,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Web App Server Not Responding',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: WebDeckTheme.textPrimary,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: WebDeckTheme.surfaceSubtle,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: WebDeckTheme.border),
                ),
                child: Text(
                  '${widget.launchUrl} • ${_pageLoadError ?? "ERR_EMPTY_RESPONSE"}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: Color(0xFFD29922),
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: WebDeckTheme.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: WebDeckTheme.border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Why is this happening?',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: WebDeckTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (isVite)
                      Text(
                        '• This app requires an active Vite dev server (npm run dev) on port ${widget.port}.',
                        style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                      ),
                    if (isPython)
                      Text(
                        '• This app requires a Python companion server (${req?.pythonScript ?? "serve.py"}) on port ${widget.port}.',
                        style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                      ),
                    if (isNode)
                      Text(
                        '• This app requires a Node.js companion (${req?.nodeScript ?? "server.js"}) on port ${widget.port}.',
                        style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                      ),
                    if (isDotnet)
                      Text(
                        '• This app requires a .NET backend (${req?.dotnetProject ?? "server"}) on port ${widget.port}.',
                        style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                      ),
                    if (Platform.isAndroid) ...[
                      const SizedBox(height: 6),
                      Text(
                        '• On Android connected via USB, forward your computer port with:\n   adb reverse tcp:${widget.port} tcp:${widget.port}',
                        style: const TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 12,
                runSpacing: 10,
                alignment: WrapAlignment.center,
                children: [
                  ElevatedButton.icon(
                    onPressed: _retryLoading,
                    icon: const Icon(Icons.refresh, size: 16),
                    label: const Text('Retry Connection'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: WebDeckTheme.primary,
                      foregroundColor: Colors.white,
                    ),
                  ),
                  if (req?.hasRequirements == true)
                    OutlinedButton.icon(
                      onPressed: _openBackendConsole,
                      icon: const Icon(Icons.dns_rounded, size: 16),
                      label: const Text('Backend Setup'),
                    ),
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.arrow_back, size: 16),
                    label: const Text('Back to Apps'),
                  ),
                ],
              ),
            ],
          ),
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
