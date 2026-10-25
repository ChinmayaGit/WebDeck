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
  final HttpServer server;
  final String launchUrl;

  const RunningAppInstance({
    required this.appId,
    required this.port,
    required this.server,
    required this.launchUrl,
  });
}

class LocalServerService {
  final Map<String, RunningAppInstance> _runningInstances = {};
  final Map<String, int> _assignedPorts = {};
  final Map<String, Process> _companionProcesses = {};
  final Map<String, List<String>> _companionLogs = {};

  bool isAppRunning(String appId) => _runningInstances.containsKey(appId);

  bool isCompanionRunning(String appId) => _companionProcesses.containsKey(appId);

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

  /// Starts a companion backend process (Python script or Node.js)
  Future<Process> startCompanionBackend(
    InstalledApp app, {
    BackendRequirement? requirement,
  }) async {
    final req = requirement ?? app.backendRequirement;
    if (req == null) {
      throw StateError('App does not have any backend requirements.');
    }

    if (_companionProcesses.containsKey(app.id)) {
      return _companionProcesses[app.id]!;
    }

    String executable;
    List<String> args;
    String workingDir;
    final candidateBinaries = <String>[];

    if (req.requiresPython && req.pythonScript != null) {
      final scriptFile = File(p.join(app.installedPath, req.pythonScript!));
      if (await scriptFile.exists()) {
        workingDir = scriptFile.parent.path;
        args = [p.basename(scriptFile.path)];
      } else {
        workingDir = app.installedPath;
        args = [req.pythonScript!];
      }

      // Prioritize direct non-shim python binaries on macOS
      if (Platform.isMacOS) {
        for (final binPath in [
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
          '/Library/Developer/CommandLineTools/usr/bin/python3',
          '/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/Current/bin/python3',
        ]) {
          if (File(binPath).existsSync()) {
            candidateBinaries.add(binPath);
          }
        }
      }
      candidateBinaries.addAll(['python3', '/usr/bin/python3', 'python']);
      executable = candidateBinaries.first;
    } else if (req.requiresNode && req.nodeScript != null) {
      final scriptFile = File(p.join(app.installedPath, req.nodeScript!));
      if (await scriptFile.exists()) {
        workingDir = scriptFile.parent.path;
        args = [p.basename(scriptFile.path)];
      } else {
        workingDir = app.installedPath;
        args = [req.nodeScript!];
      }
      if (Platform.isMacOS) {
        for (final binPath in ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
          if (File(binPath).existsSync()) {
            candidateBinaries.add(binPath);
          }
        }
      }
      candidateBinaries.addAll(['node', '/usr/bin/node']);
      executable = candidateBinaries.first;
    } else {
      throw UnsupportedError('No executable companion backend detected for ${app.name}');
    }

    _companionLogs[app.id] = [];

    // Ensure common PATH entries (e.g. /usr/local/bin, /opt/homebrew/bin) are included on macOS
    final currentPath = Platform.environment['PATH'] ?? '';
    final augmentedEnv = Map<String, String>.from(Platform.environment);
    augmentedEnv['PATH'] = '$currentPath:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

    Process process;
    try {
      process = await Process.start(
        executable,
        args,
        workingDirectory: workingDir,
        environment: augmentedEnv,
      );
    } catch (e) {
      Process? fallbackProcess;
      for (final bin in candidateBinaries.skip(1)) {
        try {
          fallbackProcess = await Process.start(
            bin,
            args,
            workingDirectory: workingDir,
            environment: augmentedEnv,
          );
          break;
        } catch (_) {}
      }
      if (fallbackProcess != null) {
        process = fallbackProcess;
      } else {
        rethrow;
      }
    }

    _companionProcesses[app.id] = process;

    process.stdout.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      final logs = _companionLogs[app.id] ??= [];
      if (logs.length > 200) logs.removeAt(0);
      logs.add('[stdout] $line');
    });

    process.stderr.transform(utf8.decoder).transform(const LineSplitter()).listen((line) {
      final logs = _companionLogs[app.id] ??= [];
      if (logs.length > 200) logs.removeAt(0);
      logs.add('[stderr] $line');
    });

    process.exitCode.then((code) {
      _companionProcesses.remove(app.id);
      final logs = _companionLogs[app.id] ??= [];
      logs.add('[system] Backend process exited with code $code');
    });

    return process;
  }

  Future<void> stopCompanionBackend(String appId) async {
    final process = _companionProcesses.remove(appId);
    if (process != null) {
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

  /// Starts an embedded loopback HTTP server with persistent port and SPA fallback
  Future<RunningAppInstance> startAppServer(InstalledApp app) async {
    if (_runningInstances.containsKey(app.id)) {
      return _runningInstances[app.id]!;
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
    if (instance != null) {
      await instance.server.close(force: true);
    }
    await stopCompanionBackend(appId);
  }

  Future<void> stopAll() async {
    for (final instance in _runningInstances.values) {
      await instance.server.close(force: true);
    }
    _runningInstances.clear();
    for (final process in _companionProcesses.values) {
      process.kill();
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
