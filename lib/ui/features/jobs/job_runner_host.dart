import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../../../runtime/job_scheduler.dart';

/// Hosts a tiny, invisible WebView that executes background jobs.
///
/// Job pages are the app's own HTML, so they can use DOMParser and the full
/// `window.webdeck` SDK. Mounted once above the navigator in `MaterialApp.builder`.
class JobRunnerHost extends StatefulWidget {
  const JobRunnerHost({super.key});

  @override
  State<JobRunnerHost> createState() => _JobRunnerHostState();
}

class _JobRunnerHostState extends State<JobRunnerHost> {
  late final JobScheduler _scheduler;
  WebViewController? _controller;
  String? _runId;

  static bool get _supported =>
      !kIsWeb && (Platform.isMacOS || Platform.isIOS || Platform.isAndroid) && WebViewPlatform.instance != null;

  @override
  void initState() {
    super.initState();
    _scheduler = context.read<JobScheduler>();
    _scheduler.hostAttached = _supported;
    _scheduler.addListener(_sync);
  }

  @override
  void dispose() {
    _scheduler.removeListener(_sync);
    _scheduler.hostAttached = false;
    super.dispose();
  }

  void _sync() {
    final run = _scheduler.current;
    if (run?.runId == _runId) return;
    if (run == null) {
      setState(() {
        _controller = null;
        _runId = null;
      });
      return;
    }
    final controller = _createController(run);
    setState(() {
      _controller = controller;
      _runId = run.runId;
    });
    controller.loadRequest(Uri.parse(run.url));
  }

  WebViewController _createController(JobRun run) {
    final PlatformWebViewControllerCreationParams params =
        WebViewPlatform.instance is WebKitWebViewPlatform
            ? WebKitWebViewControllerCreationParams()
            : const PlatformWebViewControllerCreationParams();
    final controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted);
    controller.setNavigationDelegate(NavigationDelegate(
      onWebResourceError: (error) {
        if (error.isForMainFrame ?? true) {
          _scheduler.failCurrent(run.runId, 'Job page failed to load: ${error.description}');
        }
      },
      onHttpError: (error) {
        final uri = error.request?.uri.toString();
        if (uri != null && uri.split('?').first == run.url.split('?').first) {
          _scheduler.failCurrent(run.runId, 'Job page returned HTTP ${error.response?.statusCode}');
        }
      },
    ));
    return controller;
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) return const SizedBox.shrink();
    // Must be in the tree for the platform view to run; kept 1px and non-interactive.
    return Positioned(
      right: 0,
      bottom: 0,
      width: 1,
      height: 1,
      child: IgnorePointer(
        child: ExcludeSemantics(
          child: Opacity(opacity: 0.01, child: WebViewWidget(key: ValueKey(_runId), controller: controller)),
        ),
      ),
    );
  }
}
