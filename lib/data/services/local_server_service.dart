import 'dart:convert';
import 'dart:io';
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

  /// Checks if a local port is actively accepting connections
  Future<bool> isPortListening(int port) async {
    try {
      final socket = await Socket.connect(
        InternetAddress.loopbackIPv4,
        port,
        timeout: const Duration(milliseconds: 500),
      );
      await socket.close();
      return true;
    } catch (_) {
      return false;
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
      if (await isPortListening(vitePort)) {
        final instance = RunningAppInstance(
          appId: app.id,
          port: vitePort,
          launchUrl: 'http://127.0.0.1:$vitePort/',
        );
        _runningInstances[app.id] = instance;
        return instance;
      }
      throw StateError(
        'Vite UI is not running on port $vitePort. Start the companion backend first.',
      );
    }

    final targetDir = Directory(app.installedPath);
    if (!await targetDir.exists()) {
      throw FileSystemException(
        'App directory not found on disk: ${app.installedPath}',
      );
    }

    // 1. Locate index.html
    File? resolvedIndexFile;
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

    if (resolvedIndexFile == null) {
      throw FileSystemException(
        'Could not locate index.html inside ${app.installedPath}',
      );
    }

    // 2. Primary web root is the directory containing index.html
    final indexFileToServe = resolvedIndexFile;
    final webRootDir = indexFileToServe.parent;

    // 3. Handlers
    final primaryHandler = createStaticHandler(
      webRootDir.path,
      defaultDocument: 'index.html',
      serveFilesOutsidePath: false,
    );

    Handler? rootFallbackHandler;
    if (webRootDir.path != targetDir.path) {
      rootFallbackHandler = createStaticHandler(
        targetDir.path,
        defaultDocument: 'index.html',
        serveFilesOutsidePath: false,
      );
    }

    // 4. Custom router with SPA history API fallback
    Future<Response> spaHandler(Request request) async {
      var response = await primaryHandler(request);

      if (response.statusCode == 404 && rootFallbackHandler != null) {
        response = await rootFallbackHandler(request);
      }

      // SPA Fallback for client-side routing (React, Angular, Vue, Flutter Web)
      if (response.statusCode == 404 && request.method == 'GET') {
        final path = request.url.path;
        final hasExtension = p.extension(path).isNotEmpty;

        if (!hasExtension && await indexFileToServe.exists()) {
          final content = await indexFileToServe.readAsBytes();
          return Response.ok(
            content,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
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
          });
        }
        final response = await innerHandler(request);
        return response.change(headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
          'Access-Control-Allow-Headers': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          // Allow local caching while preserving offline revalidations
          'Cache-Control': 'no-cache',
        });
      };
    };
  }
}
