import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:archive/archive.dart';
import 'package:path/path.dart' as p;
import '../models/backend_requirement.dart';

class ExtractedBundleInfo {
  final String appDir;
  final String webRootRelative;
  final String entryHtmlRelative;
  final String detectedFramework;
  final String? manifestName;
  final String? manifestDescription;
  final String? manifestVersion;
  final String? localIconPath;
  final BackendRequirement? backendRequirement;
  final int totalSizeBytes;

  const ExtractedBundleInfo({
    required this.appDir,
    required this.webRootRelative,
    required this.entryHtmlRelative,
    required this.detectedFramework,
    this.manifestName,
    this.manifestDescription,
    this.manifestVersion,
    this.localIconPath,
    this.backendRequirement,
    required this.totalSizeBytes,
  });
}

class ArchiveExtractorService {
  /// Unzips a byte buffer into targetDir safely and inspects the bundle
  Future<ExtractedBundleInfo> extractAndInspect({
    required Uint8List zipBytes,
    required Directory targetDir,
  }) async {
    if (await targetDir.exists()) {
      await targetDir.delete(recursive: true);
    }
    await targetDir.create(recursive: true);

    final archive = ZipDecoder().decodeBytes(zipBytes);
    final targetCanonical = p.canonicalize(targetDir.path);

    for (final file in archive) {
      final filename = file.name;
      // Prevent Zip-Slip security vulnerability
      final destinationPath = p.canonicalize(p.join(targetDir.path, filename));
      if (!destinationPath.startsWith(targetCanonical)) {
        throw SecurityException(
          'Zip entry attempts to escape sandboxed destination: $filename',
        );
      }

      if (file.isFile) {
        final outFile = File(destinationPath);
        await outFile.parent.create(recursive: true);
        final data = file.content as List<int>;
        await outFile.writeAsBytes(data, flush: true);
      } else {
        await Directory(destinationPath).create(recursive: true);
      }
    }

    return await inspectDirectory(targetDir);
  }

  /// Copies an existing local build directory directly into target sandboxed storage
  Future<ExtractedBundleInfo> copyDirectoryAndInspect({
    required Directory sourceDir,
    required Directory targetDir,
  }) async {
    if (await targetDir.exists()) {
      await targetDir.delete(recursive: true);
    }
    await targetDir.create(recursive: true);

    // followLinks: false so npm `.bin/*` symlinks stay symlinks. Flattening them
    // breaks tools like Vite whose CLI uses relative imports from vite/bin/.
    await for (final entity in sourceDir.list(recursive: true, followLinks: false)) {
      final rel = p.relative(entity.path, from: sourceDir.path);
      final destPath = p.join(targetDir.path, rel);
      if (entity is Link) {
        final target = await entity.target();
        await Link(destPath).parent.create(recursive: true);
        await Link(destPath).create(target, recursive: true);
      } else if (entity is Directory) {
        await Directory(destPath).create(recursive: true);
      } else if (entity is File) {
        await File(destPath).parent.create(recursive: true);
        await entity.copy(destPath);
      }
    }

    return await inspectDirectory(targetDir);
  }

  /// Inspect a directory for web app structure, frameworks, web roots, and backend requirements
  Future<ExtractedBundleInfo> inspectDirectory(Directory dir) async {
    String? webRootRelative;
    String? entryHtmlRelative;
    String? manifestName;
    String? manifestDescription;
    String? manifestVersion;
    String? localIconPath;
    var totalSize = 0;

    final allEntities = await dir.list(recursive: true).toList();

    // 1. Calculate total size
    for (final entity in allEntities) {
      if (entity is File) {
        totalSize += await entity.length();
      }
    }

    // 2. Discover index.html locations prioritizing standard build output directories
    final candidateDirs = <Directory>[];

    for (final entity in allEntities) {
      if (entity is File && p.basename(entity.path).toLowerCase() == 'index.html') {
        final relative = p.relative(entity.path, from: dir.path);
        if (isIgnoredBundlePath(relative)) continue;
        candidateDirs.add(entity.parent);
      }
    }

    if (candidateDirs.isEmpty) {
      throw const FormatException(
        'Could not find index.html in the bundle. Ensure the archive contains a compiled static web build (e.g. dist, build/web, out, or root index.html).',
      );
    }

    // Prefer compiled app outputs (dist/build/web/out) over Vite source / docs trees.
    Future<int> scoreWebRoot(Directory candidate) async {
      final pathLower = candidate.path.toLowerCase().replaceAll('\\', '/');
      var score = 10;
      if (pathLower.endsWith('/build/web')) {
        score = 100;
      } else if (pathLower.endsWith('/dist')) {
        score = 90;
      } else if (pathLower.endsWith('/out')) {
        score = 80;
      } else if (pathLower.endsWith('/build')) {
        score = 70;
      } else if (pathLower.endsWith('/public')) {
        score = 40;
      }

      // Penalize unbuilt Vite/React source indexes (need npm run dev, not static serve).
      final indexFile = File(p.join(candidate.path, 'index.html'));
      if (await indexFile.exists()) {
        try {
          final html = await indexFile.readAsString();
          if (html.contains('/src/main.') ||
              RegExp(r'''src=["']/src/[^"']+\.(tsx?|jsx?)["']''').hasMatch(html)) {
            score -= 50;
          }
        } catch (_) {}
      }
      return score;
    }

    final scored = <({Directory dir, int score})>[];
    for (final candidate in candidateDirs) {
      scored.add((dir: candidate, score: await scoreWebRoot(candidate)));
    }
    scored.sort((a, b) {
      final scoreDiff = b.score.compareTo(a.score);
      if (scoreDiff != 0) return scoreDiff;
      // Prefer shallower paths when scores tie.
      return p.split(a.dir.path).length.compareTo(p.split(b.dir.path).length);
    });
    final chosenWebRootDir = scored.first.dir;

    webRootRelative = p.relative(chosenWebRootDir.path, from: dir.path);
    if (webRootRelative == '.') {
      entryHtmlRelative = 'index.html';
    } else {
      entryHtmlRelative = p.join(webRootRelative, 'index.html');
    }

    // 3. Look for manifest (webdeck.json, manifest.json)
    for (final entity in allEntities) {
      if (entity is File) {
        final basename = p.basename(entity.path).toLowerCase();
        if (basename == 'webdeck.json' || basename == 'manifest.json') {
          try {
            final content = await entity.readAsString();
            final json = jsonDecode(content) as Map<String, dynamic>;
            manifestName ??= json['name'] as String? ?? json['short_name'] as String?;
            manifestDescription ??= json['description'] as String?;
            manifestVersion ??= json['version'] as String?;

            final icons = json['icons'];
            if (icons is List && icons.isNotEmpty) {
              final firstIcon = icons.first;
              final iconSrc = firstIcon is Map ? firstIcon['src'] as String? : null;
              if (iconSrc != null) {
                final possibleIconFile = File(p.join(entity.parent.path, iconSrc));
                if (await possibleIconFile.exists()) {
                  localIconPath = possibleIconFile.path;
                }
              }
            }
          } catch (_) {
            // Ignore malformed manifest
          }
        }
      }
    }

    // 4. Locate an icon if not yet found
    if (localIconPath == null) {
      final iconCandidates = ['icon.png', 'logo.png', 'favicon.png', 'favicon.ico', 'icon.svg'];
      for (final entity in allEntities) {
        if (entity is File) {
          final name = p.basename(entity.path).toLowerCase();
          if (iconCandidates.contains(name)) {
            localIconPath = entity.path;
            break;
          }
        }
      }
    }

    // 5. Detect framework
    final detectedFramework = _detectFramework(allEntities);

    // 6. Detect Backend / Database / Script requirements
    final backendReq = await detectBackendRequirements(dir, allEntities);

    return ExtractedBundleInfo(
      appDir: dir.path,
      webRootRelative: webRootRelative,
      entryHtmlRelative: entryHtmlRelative,
      detectedFramework: detectedFramework,
      manifestName: manifestName,
      manifestDescription: manifestDescription,
      manifestVersion: manifestVersion,
      localIconPath: localIconPath,
      backendRequirement: backendReq,
      totalSizeBytes: totalSize,
    );
  }

  /// True for paths inside dependency / VCS trees that must not be treated as
  /// app companion backends (e.g. Vite's internal `node_modules/.../server.js`).
  bool isIgnoredBundlePath(String relativePath) {
    final parts = p.split(relativePath);
    const ignored = {
      'node_modules',
      '.git',
      'vendor',
      '__pycache__',
      '.venv',
      'venv',
      '.tox',
      'bower_components',
      '.history',
      'bin',
      'obj',
      '.dart_tool',
    };
    return parts.any((part) => ignored.contains(part.toLowerCase()));
  }

  /// Prefer project-owned scripts (shallowest path) over nested copies.
  String? _preferShallowest(String? current, String candidate) {
    if (current == null) return candidate;
    final currentDepth = p.split(current).length;
    final candidateDepth = p.split(candidate).length;
    if (candidateDepth < currentDepth) return candidate;
    return current;
  }

  /// Detects Python/Node/.NET/Vite companions, SQLite/SQL Server, and API ports.
  Future<BackendRequirement?> detectBackendRequirements(
    Directory rootDir,
    List<FileSystemEntity> entities,
  ) async {
    String? pythonScript;
    String? nodeScript;
    String? dotnetProject;
    String? viteProjectDir;
    String? databasePath;
    String? apiCheckUrl;
    String? openApiUrl;
    String? connectionString;
    int? detectedPort;
    int? viteDevPort;
    var usesSqlite = false;
    var usesSqlServer = false;
    var requiresViteDev = false;
    var hasCompiledWebRoot = false;

    final pythonCandidates = ['serve.py', 'app.py', 'server.py', 'backend.py', 'main.py'];
    final portRegex = RegExp(
      r'(?:127\.0\.0\.1|localhost):(\d{4,5})|PORT\s*=\s*(?:int\(.*?\)\s*if.*?\s*else\s*)?(\d{4,5})|port\s*=\s*(\d{4,5})',
      caseSensitive: false,
    );
    final apiUrlRegex = RegExp(
      r'''https?://(?:127\.0\.0\.1|localhost):(\d{4,5})(/api/[A-Za-z0-9_/-]*)''',
      caseSensitive: false,
    );
    final sqlServerHints = RegExp(
      r'SqlConnection|SqlClient|UseSqlServer|Microsoft\.Data\.SqlClient|'
      r'System\.Data\.SqlClient|Initial Catalog|Data Source=|'
      r'TrustServerCertificate|Server=.*,\s*\d+|SQL Server',
      caseSensitive: false,
    );

    for (final entity in entities) {
      if (entity is! File) continue;
      final relative = p.relative(entity.path, from: rootDir.path);
      if (isIgnoredBundlePath(relative)) continue;

      final name = p.basename(entity.path).toLowerCase();
      final parts = p.split(relative);

      if (pythonCandidates.contains(name)) {
        pythonScript = _preferShallowest(pythonScript, relative);
      } else if (name == 'server.js' || name == 'backend.js') {
        nodeScript = _preferShallowest(nodeScript, relative);
      } else if (name.endsWith('.csproj')) {
        dotnetProject = _preferShallowest(dotnetProject, relative);
      } else if (name == 'vite.config.ts' ||
          name == 'vite.config.js' ||
          name == 'vite.config.mts' ||
          name == 'vite.config.mjs') {
        viteProjectDir = _preferShallowest(viteProjectDir, p.dirname(relative));
      } else if (name.endsWith('.db') ||
          name.endsWith('.sqlite') ||
          name.endsWith('.sqlite3') ||
          name.endsWith('.sql')) {
        databasePath ??= relative;
        usesSqlite = true;
      }

      if (name == 'index.html' &&
          parts.length >= 2 &&
          (parts[parts.length - 2].toLowerCase() == 'dist' ||
              relative.toLowerCase().replaceAll('\\', '/').contains('/build/web/'))) {
        hasCompiledWebRoot = true;
      }
    }

    // Scan companion / config / UI sources for ports, API URLs, and DB tech.
    for (final entity in entities) {
      if (entity is! File) continue;
      final relative = p.relative(entity.path, from: rootDir.path);
      if (isIgnoredBundlePath(relative)) continue;

      final name = p.basename(entity.path).toLowerCase();
      final isCompanionScript = (pythonScript != null && p.equals(relative, pythonScript)) ||
          (nodeScript != null && p.equals(relative, nodeScript)) ||
          (dotnetProject != null && p.equals(relative, dotnetProject));
      final isLaunchSettings = name == 'launchsettings.json';
      final isAppSettings = name.startsWith('appsettings') && name.endsWith('.json');
      final isRootIndex = name == 'index.html' && p.split(relative).length <= 2;
      final isUiSource = name.endsWith('.tsx') ||
          name.endsWith('.ts') ||
          name.endsWith('.jsx') ||
          name.endsWith('.js');
      final isCsFile = name.endsWith('.cs');
      final shouldScan = isCompanionScript ||
          isLaunchSettings ||
          isAppSettings ||
          isRootIndex ||
          (isUiSource && p.split(relative).length <= 4) ||
          (isCsFile && p.split(relative).length <= 4);

      if (!shouldScan) continue;

      try {
        final content = await entity.readAsString();
        if (content.contains('sqlite3') ||
            content.contains('SQLite') ||
            content.contains('sqlite')) {
          usesSqlite = true;
        }
        if (sqlServerHints.hasMatch(content)) {
          usesSqlServer = true;
        }

        if (isAppSettings && connectionString == null) {
          final connMatch = RegExp(
            r'''"(?:Default(?:Connection)?|ConnectionString|SqlServer|Database)"\s*:\s*"([^"]+)"''',
            caseSensitive: false,
          ).firstMatch(content);
          if (connMatch != null) {
            final conn = connMatch.group(1)!;
            connectionString = conn;
            final lower = conn.toLowerCase();
            if (lower.contains('server=') || lower.contains('data source=')) {
              usesSqlServer = true;
            }
          }
        }

        if (name == 'index.html' &&
            (content.contains('/src/main.') ||
                RegExp(r'''src=["']/src/[^"']+\.(tsx?|jsx?)["']''').hasMatch(content))) {
          requiresViteDev = true;
          if (viteProjectDir == null) {
            viteProjectDir = p.dirname(relative);
            if (viteProjectDir == '.') viteProjectDir = '';
          }
        }

        final apiMatch = apiUrlRegex.firstMatch(content);
        if (apiMatch != null) {
          final portStr = apiMatch.group(1);
          final pathStr = apiMatch.group(2);
          if (portStr != null) {
            final pVal = int.tryParse(portStr);
            if (pVal != null && pVal > 1024 && pVal < 65535) {
              detectedPort ??= pVal;
              if (pathStr != null && pathStr.isNotEmpty) {
                apiCheckUrl ??= 'http://127.0.0.1:$pVal$pathStr';
              }
            }
          }
        }

        if (detectedPort == null || isLaunchSettings) {
          // Prefer launchSettings applicationUrl for .NET backends.
          if (isLaunchSettings) {
            final appUrlMatch = RegExp(
              r'''applicationUrl"\s*:\s*"([^"]+)"''',
              caseSensitive: false,
            ).firstMatch(content);
            if (appUrlMatch != null) {
              final urls = appUrlMatch.group(1)!.split(';');
              for (final url in urls) {
                final m = RegExp(r'https?://[^:]+:(\d{4,5})', caseSensitive: false)
                    .firstMatch(url.trim());
                if (m != null) {
                  final pVal = int.tryParse(m.group(1)!);
                  if (pVal != null && pVal > 1024 && pVal < 65535) {
                    // Prefer http over https for local checks.
                    if (!url.trim().toLowerCase().startsWith('https')) {
                      detectedPort = pVal;
                      break;
                    }
                    detectedPort ??= pVal;
                  }
                }
              }
            }
          } else {
            final match = portRegex.firstMatch(content);
            if (match != null) {
              final portStr = match.group(1) ?? match.group(2) ?? match.group(3);
              if (portStr != null) {
                final pVal = int.tryParse(portStr);
                if (pVal != null && pVal > 1024 && pVal < 65535) {
                  detectedPort ??= pVal;
                }
              }
            }
          }
        }

        if (viteDevPort == null &&
            (name.startsWith('vite.config') ||
                (isUiSource && content.contains('localhost:5173')))) {
          final vitePortMatch =
              RegExp(r'''port\s*:\s*(\d{4,5})''', caseSensitive: false).firstMatch(content);
          if (vitePortMatch != null) {
            viteDevPort = int.tryParse(vitePortMatch.group(1)!);
          } else if (content.contains('localhost:5173') || content.contains('127.0.0.1:5173')) {
            viteDevPort = 5173;
          }
        }
      } catch (_) {}
    }

    if (requiresViteDev && !hasCompiledWebRoot) {
      viteDevPort ??= 5173;
      if (viteProjectDir != null && viteProjectDir.isEmpty) {
        viteProjectDir = '.';
      }
    } else if (hasCompiledWebRoot) {
      // Built assets exist — static serve is enough for the UI.
      requiresViteDev = false;
      viteDevPort = null;
    }

    if (dotnetProject != null && detectedPort != null) {
      apiCheckUrl ??= 'http://127.0.0.1:$detectedPort/api';
      openApiUrl ??= 'http://127.0.0.1:$detectedPort/openapi/v1.json';
    }

    if (pythonScript == null &&
        nodeScript == null &&
        dotnetProject == null &&
        !requiresViteDev &&
        databasePath == null &&
        detectedPort == null &&
        !usesSqlite &&
        !usesSqlServer) {
      return null;
    }

    final instructionParts = <String>[];
    if (dotnetProject != null) {
      var part = 'Run "dotnet run --project $dotnetProject" to start the .NET API';
      if (detectedPort != null) part += ' on port $detectedPort';
      if (usesSqlServer) {
        part += ' (SQL Server)';
      } else if (databasePath != null) {
        part += ' (uses $databasePath)';
      }
      instructionParts.add('$part.');
    }
    if (pythonScript != null) {
      var part = 'Run "python3 $pythonScript" to start the companion server';
      if (detectedPort != null) part += ' on port $detectedPort';
      if (databasePath != null) {
        part += ' (uses $databasePath database)';
      } else if (usesSqlite) {
        part += ' (uses SQLite database)';
      }
      instructionParts.add('$part.');
    } else if (nodeScript != null && !requiresViteDev) {
      var part = 'Run "node $nodeScript" to start the companion backend';
      if (detectedPort != null) part += ' on port $detectedPort';
      instructionParts.add('$part.');
    }
    if (requiresViteDev && viteProjectDir != null) {
      final dir = viteProjectDir == '.' ? '.' : viteProjectDir;
      instructionParts.add(
        'Run "npm run dev" in $dir for the Vite UI on port ${viteDevPort ?? 5173}.',
      );
    }
    if (apiCheckUrl != null) {
      instructionParts.add('API check: $apiCheckUrl');
    }

    return BackendRequirement(
      requiresPython: pythonScript != null,
      pythonScript: pythonScript,
      requiresNode: nodeScript != null && !requiresViteDev,
      nodeScript: nodeScript,
      requiresDotnet: dotnetProject != null,
      dotnetProject: dotnetProject,
      requiresViteDev: requiresViteDev,
      viteProjectDir: viteProjectDir,
      viteDevPort: viteDevPort,
      hasDatabase: databasePath != null || usesSqlite || usesSqlServer,
      usesSqlServer: usesSqlServer,
      databasePath: databasePath ??
          (usesSqlServer
              ? 'SQL Server'
              : (usesSqlite ? 'SQLite' : null)),
      backendPort: detectedPort,
      apiCheckUrl: apiCheckUrl,
      openApiUrl: openApiUrl,
      connectionString: connectionString,
      setupInstructions:
          instructionParts.isEmpty ? null : instructionParts.join(' '),
    );
  }

  String _detectFramework(List<FileSystemEntity> entities) {
    var hasFlutter = false;
    var hasAngular = false;
    var hasReact = false;
    var hasVue = false;
    var hasSvelte = false;
    var hasNext = false;

    for (final entity in entities) {
      if (entity is File) {
        final name = p.basename(entity.path).toLowerCase();
        if (name == 'flutter.js' || name == 'main.dart.js' || name == 'flutter_bootstrap.js') {
          hasFlutter = true;
        } else if (name.contains('angular') || name.contains('runtime-es2015') || name.contains('polyfills-es2015')) {
          hasAngular = true;
        } else if (name.contains('react') || name.contains('vite')) {
          hasReact = true;
        } else if (name.contains('vue')) {
          hasVue = true;
        } else if (name.contains('svelte')) {
          hasSvelte = true;
        } else if (name.contains('_next') || entity.path.contains('/_next/')) {
          hasNext = true;
        }
      }
    }

    if (hasFlutter) return 'Flutter Web';
    if (hasNext) return 'Next.js';
    if (hasReact) return 'React / Vite';
    if (hasAngular) return 'Angular';
    if (hasVue) return 'Vue.js';
    if (hasSvelte) return 'Svelte';
    return 'HTML5 App';
  }
}

class SecurityException implements Exception {
  final String message;
  const SecurityException(this.message);
  @override
  String toString() => 'SecurityException: $message';
}
