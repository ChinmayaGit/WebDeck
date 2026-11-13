import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart' show rootBundle;
import 'package:mime/mime.dart' as mime;
import 'package:path/path.dart' as p;
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as io;
import 'package:shelf_static/shelf_static.dart';
import '../models/backend_requirement.dart';
import '../models/installed_app.dart';

class RunningAppInstance {
  final String appId;
  final int port;
  /// Null when the UI is served by an external companion (e.g. Vite `npm run dev`).
  final HttpServer? server;
  final String launchUrl;

  const RunningAppInstance({
    required this.appId,
    required this.port,
    this.server,
    required this.launchUrl,
  });
}

class LocalServerService {
  final Map<String, RunningAppInstance> _runningInstances = {};
  final Map<String, int> _assignedPorts = {};
  final Map<String, List<Process>> _companionProcesses = {};
  final Map<String, List<String>> _companionLogs = {};

  bool isAppRunning(String appId) => _runningInstances.containsKey(appId);

  bool isCompanionRunning(String appId) {
    final procs = _companionProcesses[appId];
    return procs != null && procs.isNotEmpty;
  }

  List<String> getCompanionLogs(String appId) =>
      List.unmodifiable(_companionLogs[appId] ?? const []);

  /// Checks if a local port is actively accepting connections and serving traffic.
  /// Handles dead reverse tunnels (such as `adb reverse` on Android where the local ADB
  /// daemon accepts the initial TCP handshake but immediately drops the socket when no
  /// host server is listening).
  Future<bool> isPortListening(int port) async {
    // 1. Try an HTTP probe first since WebDeck backends and dev servers are HTTP.
    HttpClient? client;
    try {
      client = HttpClient();
      client.connectionTimeout = const Duration(milliseconds: 400);
      final request = await client
          .openUrl('GET', Uri.parse('http://127.0.0.1:$port/'))
          .timeout(const Duration(milliseconds: 500));
      final response = await request.close().timeout(const Duration(milliseconds: 500));
      return response.statusCode > 0;
    } on SocketException {
      return false;
    } on HttpException {
      // Empty response or closed prematurely (e.g. adb reverse dead tunnel)
      return false;
    } catch (_) {
      // 2. Fallback for non-HTTP raw TCP servers: connect and check if connection holds
      Socket? socket;
      try {
        socket = await Socket.connect(
          InternetAddress.loopbackIPv4,
          port,
          timeout: const Duration(milliseconds: 400),
        );
        var dropped = false;
        final sub = socket.listen(
          (_) {},
          onError: (_) => dropped = true,
          onDone: () => dropped = true,
          cancelOnError: true,
        );
        socket.add([10]);
        await socket.flush().catchError((_) => null);
        await Future.delayed(const Duration(milliseconds: 60));
        await sub.cancel();
        await socket.close();
        return !dropped;
      } catch (_) {
        return false;
      } finally {
        socket?.destroy();
      }
    } finally {
      client?.close(force: true);
    }
  }

  /// GETs an API URL and returns true for any HTTP response (2xx–4xx).
  Future<bool> checkApiHealth(String url) async {
    final result = await testApi(url);
    return result.ok;
  }

  /// Runs an HTTP request against a companion API and returns status + body preview.
  Future<ApiTestResult> testApi(
    String url, {
    String method = 'GET',
  }) async {
    HttpClient? client;
    try {
      client = HttpClient();
      client.connectionTimeout = const Duration(seconds: 3);
      final uri = Uri.parse(url);
      final request = await client.openUrl(method.toUpperCase(), uri);
      request.headers.set('Accept', 'application/json, text/plain, */*');
      final response = await request.close().timeout(const Duration(seconds: 5));
      final body = await response.transform(utf8.decoder).join();
      final preview = body.length > 4000 ? '${body.substring(0, 4000)}\n…' : body;
      final code = response.statusCode;
      return ApiTestResult(
        url: url,
        method: method.toUpperCase(),
        statusCode: code,
        bodyPreview: preview,
        ok: code >= 200 && code < 500,
      );
    } catch (e) {
      return ApiTestResult(
        url: url,
        method: method.toUpperCase(),
        bodyPreview: '',
        ok: false,
        error: e.toString(),
      );
    } finally {
      client?.close(force: true);
    }
  }

  /// Ensures ASP.NET CORS policies allow both localhost and 127.0.0.1 Vite origins.
  Future<void> ensureDotnetLocalCors(String projectDir, int vitePort) async {
    final program = File(p.join(projectDir, 'Program.cs'));
    if (!await program.exists()) return;
    try {
      var content = await program.readAsString();
      final localOrigin = 'http://localhost:$vitePort';
      final loopbackOrigin = 'http://127.0.0.1:$vitePort';
      if (content.contains(localOrigin) && content.contains(loopbackOrigin)) {
        return;
      }
      if (!content.contains('WithOrigins')) return;

      final updated = content.replaceFirstMapped(
        RegExp(r'WithOrigins\s*\(([\s\S]*?)\)'),
        (match) {
          final inside = match.group(1) ?? '';
          final origins = <String>{};
          for (final m in RegExp(r'"([^"]+)"').allMatches(inside)) {
            origins.add(m.group(1)!);
          }
          origins.add(localOrigin);
          origins.add(loopbackOrigin);
          final listed = origins.map((o) => '                "$o"').join(',\n');
          return 'WithOrigins(\n$listed\n            )';
        },
      );
      if (updated != content) {
        await program.writeAsString(updated);
      }
    } catch (_) {}
  }

  Map<String, String> _augmentedEnv() {
    final currentPath = Platform.environment['PATH'] ?? '';
    final env = Map<String, String>.from(Platform.environment);
    env['PATH'] = '$currentPath:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
    return env;
  }

  List<String> _macosCandidates(List<String> preferred, List<String> fallback) {
    final out = <String>[];
    if (Platform.isMacOS) {
      for (final bin in preferred) {
        if (File(bin).existsSync()) out.add(bin);
      }
    }
    out.addAll(fallback);
    return out;
  }

  Future<Process> _startProcess({
    required String appId,
    required String label,
    required List<String> candidates,
    required List<String> args,
    required String workingDir,
    Map<String, String>? extraEnv,
  }) async {
    final env = _augmentedEnv();
    if (extraEnv != null) env.addAll(extraEnv);

    Process? process;
    Object? lastError;
    for (final bin in candidates) {
      try {
        process = await Process.start(
          bin,
          args,
          workingDirectory: workingDir,
          environment: env,
        );
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (process == null) {
      throw ProcessException(
        candidates.first,
        args,
        'Could not start $label: $lastError',
      );
    }

    final procs = _companionProcesses.putIfAbsent(appId, () => []);
    procs.add(process);
    final captured = process;

    captured.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      final logs = _companionLogs[appId] ??= [];
      if (logs.length > 200) logs.removeAt(0);
      logs.add('[$label:stdout] $line');
    });
    captured.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      final logs = _companionLogs[appId] ??= [];
      if (logs.length > 200) logs.removeAt(0);
      logs.add('[$label:stderr] $line');
    });
    captured.exitCode.then((code) {
      final list = _companionProcesses[appId];
      list?.remove(captured);
      if (list != null && list.isEmpty) {
        _companionProcesses.remove(appId);
      }
      final logs = _companionLogs[appId] ??= [];
      logs.add('[system] $label exited with code $code');
    });

    return captured;
  }

  /// Starts companion backends (.NET, Python, Node, and/or Vite) for an app.
  /// Starts only what is missing so a crashed Vite can be recreated while the API stays up.
  Future<void> startCompanionBackend(
    InstalledApp app, {
    BackendRequirement? requirement,
  }) async {
    final req = requirement ?? app.backendRequirement;
    if (req == null) {
      throw StateError('App does not have any backend requirements.');
    }

    _companionLogs[app.id] ??= [];
    Process? primary =
        _companionProcesses[app.id]?.isNotEmpty == true
            ? _companionProcesses[app.id]!.first
            : null;

    if (req.requiresDotnet && req.dotnetProject != null) {
      final projectPath = p.join(app.installedPath, req.dotnetProject!);
      final projectFile = File(projectPath);
      final workingDir = await projectFile.exists()
          ? projectFile.parent.path
          : (await Directory(projectPath).exists()
              ? projectPath
              : app.installedPath);
      final projectArg = await projectFile.exists()
          ? p.basename(projectFile.path)
          : (workingDir == app.installedPath ? req.dotnetProject! : '.');

      await ensureDotnetLocalCors(workingDir, req.viteDevPort ?? 5173);

      final apiUp =
          req.backendPort != null && await isPortListening(req.backendPort!);
      if (!apiUp) {
        primary = await _startProcess(
          appId: app.id,
          label: 'dotnet',
          candidates: _macosCandidates(
            ['/opt/homebrew/bin/dotnet', '/usr/local/share/dotnet/dotnet'],
            ['dotnet'],
          ),
          args: ['run', '--project', projectArg, '--launch-profile', 'http'],
          workingDir: workingDir,
          extraEnv: {'ASPNETCORE_ENVIRONMENT': 'Development'},
        );
      }
    }

    if (req.requiresPython && req.pythonScript != null) {
      final pythonUp =
          req.backendPort != null && await isPortListening(req.backendPort!);
      if (!pythonUp) {
        final scriptFile = File(p.join(app.installedPath, req.pythonScript!));
        final workingDir =
            await scriptFile.exists() ? scriptFile.parent.path : app.installedPath;
        final args = [
          await scriptFile.exists()
              ? p.basename(scriptFile.path)
              : req.pythonScript!,
        ];
        final proc = await _startProcess(
          appId: app.id,
          label: 'python',
          candidates: _macosCandidates(
            [
              '/opt/homebrew/bin/python3',
              '/usr/local/bin/python3',
              '/Library/Developer/CommandLineTools/usr/bin/python3',
              '/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/Current/bin/python3',
            ],
            ['python3', '/usr/bin/python3', 'python'],
          ),
          args: args,
          workingDir: workingDir,
        );
        primary ??= proc;
      }
    }

    if (req.requiresNode && req.nodeScript != null) {
      final nodeUp =
          req.backendPort != null && await isPortListening(req.backendPort!);
      if (!nodeUp) {
        final scriptFile = File(p.join(app.installedPath, req.nodeScript!));
        final workingDir =
            await scriptFile.exists() ? scriptFile.parent.path : app.installedPath;
        final args = [
          await scriptFile.exists() ? p.basename(scriptFile.path) : req.nodeScript!,
        ];
        final proc = await _startProcess(
          appId: app.id,
          label: 'node',
          candidates: _macosCandidates(
            ['/opt/homebrew/bin/node', '/usr/local/bin/node'],
            ['node', '/usr/bin/node'],
          ),
          args: args,
          workingDir: workingDir,
        );
        primary ??= proc;
      }
    }

    if (req.requiresViteDev && req.viteProjectDir != null) {
      final vitePort = req.viteDevPort ?? 5173;
      final viteUp = await isPortListening(vitePort);
      if (!viteUp) {
        final viteDir = req.viteProjectDir == '.' || req.viteProjectDir!.isEmpty
            ? app.installedPath
            : p.join(app.installedPath, req.viteProjectDir!);
        // Prefer the real package entry. Copied `.bin/vite` shims break because
        // directory sideload flattens symlinks and relative imports resolve wrong.
        final viteCli =
            File(p.join(viteDir, 'node_modules', 'vite', 'bin', 'vite.js'));
        final Process proc;
        if (await viteCli.exists()) {
          proc = await _startProcess(
            appId: app.id,
            label: 'vite',
            candidates: _macosCandidates(
              ['/opt/homebrew/bin/node', '/usr/local/bin/node'],
              ['node', '/usr/bin/node'],
            ),
            args: [
              viteCli.path,
              '--host',
              '127.0.0.1',
              '--port',
              '$vitePort',
            ],
            workingDir: viteDir,
          );
        } else {
          proc = await _startProcess(
            appId: app.id,
            label: 'vite',
            candidates: _macosCandidates(
              ['/opt/homebrew/bin/npm', '/usr/local/bin/npm'],
              ['npm'],
            ),
            args: [
              'run',
              'dev',
              '--',
              '--host',
              '127.0.0.1',
              '--port',
              '$vitePort',
            ],
            workingDir: viteDir,
          );
        }
        primary ??= proc;
      }
    }

    final startedSomething = primary != null || isCompanionRunning(app.id);
    if (startedSomething) return;

    // If only Vite is needed, fallback to embedded JIT serving without throwing
    if (req.requiresViteDev &&
        !req.requiresDotnet &&
        !req.requiresPython &&
        !req.requiresNode &&
        req.backendPort == null) {
      final logs = _companionLogs[app.id] ??= [];
      logs.add(
        '[system] Dev server port not detected; WebDeck JIT transpile engine active.',
      );
      return;
    }

    // Nothing new to spawn — succeed if required ports are already serving.
    final ports = <int>{
      if (req.backendPort != null) req.backendPort!,
      if (req.viteDevPort != null) req.viteDevPort!,
    };
    if (ports.isEmpty) {
      throw UnsupportedError(
        'No executable companion backend detected for ${app.name}',
      );
    }
    for (final port in ports) {
      if (!await isPortListening(port)) {
        throw StateError(
          'Could not start companion services; port $port is not listening.',
        );
      }
    }
  }

  Future<void> stopCompanionBackend(String appId) async {
    final procs = _companionProcesses.remove(appId) ?? const <Process>[];
    for (final process in procs) {
      process.kill();
    }
  }

  RunningAppInstance? getInstance(String appId) => _runningInstances[appId];

  List<RunningAppInstance> get activeInstances => _runningInstances.values.toList();

  /// Calculates a deterministic, persistent port for an app.
  /// Keeping the port constant preserves LocalStorage, Cookies, and IndexedDB
  /// across app restarts (because browser origin is scheme + host + port).
  int getConsistentPortForApp(String appId) {
    if (_assignedPorts.containsKey(appId)) {
      return _assignedPorts[appId]!;
    }
    // Hash appId into port range 15000 - 28000
    final hash = appId.hashCode.abs();
    final port = 15000 + (hash % 13000);
    _assignedPorts[appId] = port;
    return port;
  }

  /// Starts an embedded loopback HTTP server, or attaches to a running Vite UI.
  Future<RunningAppInstance> startAppServer(InstalledApp app) async {
    if (_runningInstances.containsKey(app.id)) {
      return _runningInstances[app.id]!;
    }

    final req = app.backendRequirement;
    if (req != null && req.requiresViteDev && req.viteDevPort != null) {
      final vitePort = req.viteDevPort!;
      if (isCompanionRunning(app.id) && await isPortListening(vitePort)) {
        final instance = RunningAppInstance(
          appId: app.id,
          port: vitePort,
          launchUrl: 'http://127.0.0.1:$vitePort/',
        );
        _runningInstances[app.id] = instance;
        return instance;
      }
    }

    final targetDir = Directory(app.installedPath);
    if (!await targetDir.exists()) {
      throw FileSystemException(
        'App directory not found on disk: ${app.installedPath}',
      );
    }

    // 1. Locate index.html - Prefer precompiled outputs (dist, build/web, out)
    // over raw source indexes containing uncompiled /src/main.tsx or .ts.
    File? resolvedIndexFile;

    // Check for precompiled builds first
    await for (final entity in targetDir.list(recursive: true)) {
      if (entity is File && p.basename(entity.path).toLowerCase() == 'index.html') {
        final rel = p.relative(entity.path, from: targetDir.path).replaceAll('\\', '/').toLowerCase();
        if (rel.contains('node_modules') || rel.contains('.history')) continue;
        if (rel.endsWith('/dist/index.html') ||
            rel == 'dist/index.html' ||
            rel.contains('/build/web/index.html') ||
            rel == 'build/web/index.html' ||
            rel.endsWith('/out/index.html') ||
            rel == 'out/index.html') {
          resolvedIndexFile = entity;
          break;
        }
      }
    }

    if (resolvedIndexFile == null) {
      final directEntry = File(p.join(app.installedPath, app.entryHtml));
      if (await directEntry.exists()) {
        resolvedIndexFile = directEntry;
      } else {
        final rootIndex = File(p.join(app.installedPath, 'index.html'));
        if (await rootIndex.exists()) {
          resolvedIndexFile = rootIndex;
        } else {
          await for (final entity in targetDir.list(recursive: true)) {
            if (entity is File && p.basename(entity.path).toLowerCase() == 'index.html') {
              final relative = p.relative(entity.path, from: targetDir.path);
              if (relative.contains('node_modules') || relative.contains('.history')) {
                continue;
              }
              resolvedIndexFile = entity;
              break;
            }
          }
        }
      }
    }

    if (resolvedIndexFile == null) {
      throw FileSystemException(
        'Could not locate index.html inside ${app.installedPath}',
      );
    }

    // 2. Check if this is an uncompiled TypeScript / React / Vite source project
    final rawIndexContent = await resolvedIndexFile.readAsString().catchError((_) => '');
    final isUncompiledVite = rawIndexContent.contains('/src/main.') ||
        RegExp(r'''src=["']/src/[^"']+\.(tsx?|jsx?)["']''').hasMatch(rawIndexContent);
    final hasUncompiledScripts = isUncompiledVite ||
        rawIndexContent.contains('.ts"') ||
        rawIndexContent.contains(".ts'") ||
        rawIndexContent.contains('.tsx"') ||
        rawIndexContent.contains(".tsx'") ||
        rawIndexContent.contains('.jsx"') ||
        rawIndexContent.contains(".jsx'");

    // 3. Primary web root is the directory containing index.html
    final indexFileToServe = resolvedIndexFile;
    final webRootDir = indexFileToServe.parent;

    // 4. Handlers: Web root, public static folder (Vite / CRA convention), and target root fallback
    final primaryHandler = createStaticHandler(
      webRootDir.path,
      defaultDocument: 'index.html',
      serveFilesOutsidePath: false,
    );

    Handler? publicHandler;
    final publicDirInWeb = Directory(p.join(webRootDir.path, 'public'));
    if (await publicDirInWeb.exists()) {
      publicHandler = createStaticHandler(
        publicDirInWeb.path,
        serveFilesOutsidePath: false,
      );
    } else if (webRootDir.path != targetDir.path) {
      final publicDirInTarget = Directory(p.join(targetDir.path, 'public'));
      if (await publicDirInTarget.exists()) {
        publicHandler = createStaticHandler(
          publicDirInTarget.path,
          serveFilesOutsidePath: false,
        );
      }
    }

    Handler? rootFallbackHandler;
    if (webRootDir.path != targetDir.path) {
      rootFallbackHandler = createStaticHandler(
        targetDir.path,
        defaultDocument: 'index.html',
        serveFilesOutsidePath: false,
      );
    }

    // 5. Custom router with JIT Service Worker transpilation & SPA fallback
    Future<Response> spaHandler(Request request) async {
      // A. Deliver Service Worker for client-side JIT transpilation
      if (request.url.path == 'webdeck-sw.js') {
        return Response.ok(
          _webdeckSwScript,
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Service-Worker-Allowed': '/',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          },
        );
      }

      // B. Deliver bundled Babel Standalone compiler
      if (request.url.path == 'webdeck/babel.min.js') {
        final babelData = await _getBabelBytes();
        return Response.ok(
          babelData,
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        );
      }

      // C. Deliver entry index.html with JIT bootstrap injection if uncompiled
      if (request.url.path.isEmpty || request.url.path == 'index.html') {
        if (await indexFileToServe.exists()) {
          final raw = await indexFileToServe.readAsString().catchError((_) => '');
          final content = hasUncompiledScripts ? _injectJitBootstrap(raw) : raw;
          return Response.ok(
            content,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Service-Worker-Allowed': '/',
              'Cache-Control': 'no-cache',
            },
          );
        }
      }

      var response = await primaryHandler(request);

      if (response.statusCode == 404 && publicHandler != null) {
        response = await publicHandler(request);
      }

      if (response.statusCode == 404 && rootFallbackHandler != null) {
        response = await rootFallbackHandler(request);
      }

      // D. Extensionless file resolution (e.g. import from './runtime/game' -> './runtime/game.ts')
      if (response.statusCode == 404 && request.method == 'GET') {
        final path = request.url.path;
        final extensionsToTry = [
          '.ts',
          '.tsx',
          '.js',
          '.jsx',
          '/index.ts',
          '/index.tsx',
          '/index.js',
          '/index.jsx',
        ];
        final searchDirs = [
          webRootDir,
          if (await publicDirInWeb.exists()) publicDirInWeb,
          if (webRootDir.path != targetDir.path) targetDir,
        ];

        for (final dir in searchDirs) {
          for (final ext in extensionsToTry) {
            final candidate = File(p.join(dir.path, path + ext));
            if (await candidate.exists()) {
              final bytes = await candidate.readAsBytes();
              final mimeType =
                  _resolveMimeType(candidate.path) ??
                  'text/javascript; charset=utf-8';
              return Response.ok(
                bytes,
                headers: {
                  'Content-Type': mimeType,
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-cache',
                  'X-WebDeck-Transpile': 'true',
                },
              );
            }
          }
        }
      }

      // E. SPA Fallback for client-side routing (React, Angular, Vue, Flutter Web)
      if (response.statusCode == 404 && request.method == 'GET') {
        final path = request.url.path;
        final hasExtension = p.extension(path).isNotEmpty;

        if (!hasExtension && await indexFileToServe.exists()) {
          final raw = await indexFileToServe.readAsString().catchError((_) => '');
          final content = hasUncompiledScripts ? _injectJitBootstrap(raw) : raw;
          return Response.ok(
            content,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
              'Service-Worker-Allowed': '/',
              'Cache-Control': 'no-cache',
            },
          );
        }
      }

      // Custom MIME resolution
      final customMime = _resolveMimeType(request.url.path);
      if (customMime != null && response.statusCode == 200) {
        return response.change(headers: {
          'Content-Type': customMime,
          'Access-Control-Allow-Origin': '*',
          'Service-Worker-Allowed': '/',
        });
      }

      return response;
    }

    // Middleware for CORS, caching, and cross-origin persistence
    final handler = const Pipeline()
        .addMiddleware(_corsMiddleware())
        .addHandler(spaHandler);

    // 5. Bind to deterministic port to keep IndexedDB and LocalStorage persistent
    HttpServer server;
    var desiredPort = getConsistentPortForApp(app.id);

    try {
      server = await io.serve(
        handler,
        InternetAddress.loopbackIPv4,
        desiredPort,
      );
    } catch (_) {
      // If desired port is occupied, fallback to any available port
      server = await io.serve(
        handler,
        InternetAddress.loopbackIPv4,
        0,
      );
      _assignedPorts[app.id] = server.port;
    }

    final port = server.port;
    final launchUrl = 'http://127.0.0.1:$port/';

    final instance = RunningAppInstance(
      appId: app.id,
      port: port,
      server: server,
      launchUrl: launchUrl,
    );

    _runningInstances[app.id] = instance;
    return instance;
  }

  Future<void> stopAppServer(String appId) async {
    final instance = _runningInstances.remove(appId);
    if (instance?.server != null) {
      await instance!.server!.close(force: true);
    }
    await stopCompanionBackend(appId);
  }

  Future<void> stopAll() async {
    for (final instance in _runningInstances.values) {
      if (instance.server != null) {
        await instance.server!.close(force: true);
      }
    }
    _runningInstances.clear();
    for (final procs in _companionProcesses.values) {
      for (final process in procs) {
        process.kill();
      }
    }
    _companionProcesses.clear();
  }

  static String? _resolveMimeType(String path) {
    final ext = p.extension(path).toLowerCase();
    switch (ext) {
      case '.wasm':
        return 'application/wasm';
      case '.mjs':
      case '.js':
      case '.ts':
      case '.tsx':
      case '.jsx':
        return 'text/javascript; charset=utf-8';
      case '.json':
        return 'application/json; charset=utf-8';
      case '.webmanifest':
        return 'application/manifest+json; charset=utf-8';
      case '.css':
        return 'text/css; charset=utf-8';
      case '.svg':
        return 'image/svg+xml';
      default:
        return mime.lookupMimeType(path);
    }
  }

  static Middleware _corsMiddleware() {
    return (Handler innerHandler) {
      return (Request request) async {
        if (request.method == 'OPTIONS') {
          return Response.ok('', headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': '*',
            'Service-Worker-Allowed': '/',
          });
        }
        final response = await innerHandler(request);
        return response.change(headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Service-Worker-Allowed': '/',
          // Allow local caching while preserving offline revalidations
          'Cache-Control': 'no-cache',
        });
      };
    };
  }

  static List<int>? _cachedBabelBytes;

  static Future<List<int>> _getBabelBytes() async {
    if (_cachedBabelBytes != null) return _cachedBabelBytes!;
    try {
      final byteData = await rootBundle.load('assets/vendor/babel.min.js');
      _cachedBabelBytes = byteData.buffer.asUint8List(
        byteData.offsetInBytes,
        byteData.lengthInBytes,
      );
      return _cachedBabelBytes!;
    } catch (_) {
      final file = File('assets/vendor/babel.min.js');
      if (await file.exists()) {
        _cachedBabelBytes = await file.readAsBytes();
        return _cachedBabelBytes!;
      }
      return utf8.encode('/* babel bundle */');
    }
  }

  static String _injectJitBootstrap(String html) {
    const bootstrapShims = '''
<script>
  window.process = window.process || { env: { NODE_ENV: 'development' } };
  window.global = window.global || window;
  (function() {
    function launchModules() {
      if (window.__webdeckModulesLaunched) return;
      window.__webdeckModulesLaunched = true;
      var tags = document.querySelectorAll('script[data-webdeck-module]');
      tags.forEach(function(tag) {
        var s = document.createElement('script');
        s.type = 'module';
        s.src = tag.getAttribute('data-webdeck-module');
        (document.body || document.head || document.documentElement).appendChild(s);
      });
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/webdeck-sw.js', { scope: '/' }).then(function(reg) {
        if (navigator.serviceWorker.controller) {
          launchModules();
        } else {
          navigator.serviceWorker.addEventListener('controllerchange', function() {
            launchModules();
          }, { once: true });
          setTimeout(launchModules, 500);
        }
      }).catch(function(err) {
        console.warn('WebDeck SW registration failed, loading directly:', err);
        launchModules();
      });
    } else {
      launchModules();
    }
  })();
</script>
''';

    var transformedHtml = html.replaceAllMapped(
      RegExp(r'''<script\s+type=["']module["']\s+src=["']([^"']+\.(?:tsx?|jsx?))["']\s*>\s*</script>''', caseSensitive: false),
      (m) => '<script data-webdeck-module="${m[1]}"></script>',
    );

    transformedHtml = transformedHtml.replaceAllMapped(
      RegExp(r'''<script\s+src=["']([^"']+\.(?:tsx?|jsx?))["']\s+type=["']module["']\s*>\s*</script>''', caseSensitive: false),
      (m) => '<script data-webdeck-module="${m[1]}"></script>',
    );

    if (transformedHtml.contains('<head>')) {
      transformedHtml = transformedHtml.replaceFirst('<head>', '<head>\n$bootstrapShims');
    } else if (transformedHtml.contains('<html>')) {
      transformedHtml = transformedHtml.replaceFirst('<html>', '<html>\n<head>$bootstrapShims</head>');
    } else {
      transformedHtml = '$bootstrapShims\n$transformedHtml';
    }

    return transformedHtml;
  }

  static const String _webdeckSwScript = r'''
/* WebDeck JIT Service Worker - Compiles TypeScript, JSX, and CSS modules client-side */
importScripts('/webdeck/babel.min.js');

const transpileCache = new Map();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function rewriteImports(code) {
  let transformed = code.replace(
    /((?:import|export)\s+(?:(?:[\w*\s{},]*)\s+from\s+)?["'])([^"'\r\n]+)(["'])/g,
    (match, prefix, specifier, suffix) => {
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('http:') ||
        specifier.startsWith('https:') ||
        specifier.startsWith('data:')
      ) {
        return match;
      }
      return prefix + 'https://esm.sh/' + specifier + suffix;
    }
  ).replace(
    /import\s*\(\s*(["'])([^"'\r\n]+)\1\s*\)/g,
    (match, quote, specifier) => {
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('http:') ||
        specifier.startsWith('https:') ||
        specifier.startsWith('data:')
      ) {
        return match;
      }
      return 'import(' + quote + 'https://esm.sh/' + specifier + quote + ')';
    }
  );

  transformed = transformed.replace(
    /import\.meta\.env/g,
    '({ DEV: false, PROD: true, MODE: "production", BASE_URL: "/" })'
  );

  return transformed;
}

async function handleCssModule(request) {
  try {
    const res = await fetch(request);
    if (!res.ok) return res;
    const cssText = await res.text();
    const js = `
const css = ${JSON.stringify(cssText)};
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.setAttribute('data-webdeck-css', ${JSON.stringify(request.url)});
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);
}
export default css;
`;
    return new Response(js, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (e) {
    return new Response('export default "";', {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
    });
  }
}

async function handleTranspile(request) {
  const url = new URL(request.url);
  const cacheKey = url.pathname + url.search;

  if (transpileCache.has(cacheKey)) {
    return new Response(transpileCache.get(cacheKey), {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  try {
    const res = await fetch(request);
    if (!res.ok) return res;
    const rawCode = await res.text();

    let outputJs = rawCode;
    if (self.Babel) {
      try {
        const result = self.Babel.transform(rawCode, {
          presets: [
            'typescript',
            ['react', { runtime: 'automatic' }]
          ],
          filename: url.pathname
        });
        outputJs = result.code;
      } catch (babelErr) {
        try {
          const fallback = self.Babel.transform(rawCode, {
            presets: ['typescript', 'react'],
            filename: url.pathname
          });
          outputJs = fallback.code;
        } catch (_) {}
      }
    }

    outputJs = rewriteImports(outputJs);
    transpileCache.set(cacheKey, outputJs);

    return new Response(outputJs, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return fetch(request);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  const pathname = url.pathname;

  if (pathname.startsWith('/webdeck/') || pathname === '/webdeck-sw.js') {
    return;
  }

  if (
    pathname.endsWith('.css') &&
    (event.request.destination === 'script' ||
     event.request.headers.get('accept')?.includes('*/*'))
  ) {
    event.respondWith(handleCssModule(event.request));
    return;
  }

  if (
    /\.(tsx?|jsx?)($|\?)/i.test(pathname) ||
    event.request.destination === 'script'
  ) {
    if (pathname.endsWith('.js') && event.request.destination !== '') {
      return;
    }
    event.respondWith(handleTranspile(event.request));
    return;
  }
});
''';
}
