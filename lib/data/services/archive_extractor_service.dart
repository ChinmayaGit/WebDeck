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

    await for (final entity in sourceDir.list(recursive: true)) {
      final rel = p.relative(entity.path, from: sourceDir.path);
      final destPath = p.join(targetDir.path, rel);
      if (entity is Directory) {
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
        candidateDirs.add(entity.parent);
      }
    }

    if (candidateDirs.isEmpty) {
      throw const FormatException(
        'Could not find index.html in the bundle. Ensure the archive contains a compiled static web build (e.g. dist, build/web, out, or root index.html).',
      );
    }

    // Pick the best candidate directory
    Directory chosenWebRootDir = candidateDirs.first;
    for (final candidate in candidateDirs) {
      final pathLower = candidate.path.toLowerCase();
      if (pathLower.endsWith('/build/web') ||
          pathLower.endsWith('/dist') ||
          pathLower.endsWith('/out') ||
          pathLower.endsWith('/build') ||
          pathLower.endsWith('/public')) {
        chosenWebRootDir = candidate;
        break;
      }
    }

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

  /// Detects whether the app has Python scripts, SQLite DBs, or Node backends
  Future<BackendRequirement?> detectBackendRequirements(
    Directory rootDir,
    List<FileSystemEntity> entities,
  ) async {
    String? pythonScript;
    String? nodeScript;
    String? databasePath;
    int? detectedPort;
    var usesSqlite = false;

    // Search for Python and Node scripts, and DB/SQL files
    final pythonCandidates = ['serve.py', 'app.py', 'server.py', 'backend.py', 'main.py'];
    for (final entity in entities) {
      if (entity is File) {
        final name = p.basename(entity.path).toLowerCase();
        if (pythonCandidates.contains(name)) {
          pythonScript ??= p.relative(entity.path, from: rootDir.path);
        } else if (name == 'server.js' || name == 'backend.js') {
          nodeScript ??= p.relative(entity.path, from: rootDir.path);
        } else if (name.endsWith('.db') ||
            name.endsWith('.sqlite') ||
            name.endsWith('.sqlite3') ||
            name.endsWith('.sql')) {
          databasePath ??= p.relative(entity.path, from: rootDir.path);
          usesSqlite = true;
        }
      }
    }

    // Detect port numbers and database usage by scanning index.html and scripts
    final portRegex = RegExp(
      r'(?:127\.0\.0\.1|localhost):(\d{4,5})|PORT\s*=\s*(?:int\(.*?\)\s*if.*?\s*else\s*)?(\d{4,5})|port\s*=\s*(\d{4,5})',
      caseSensitive: false,
    );

    for (final entity in entities) {
      if (entity is File) {
        final name = p.basename(entity.path).toLowerCase();
        if (name == 'index.html' || (pythonScript != null && entity.path.endsWith(pythonScript))) {
          try {
            final content = await entity.readAsString();
            if (content.contains('sqlite3') || content.contains('SQLite') || content.contains('sqlite')) {
              usesSqlite = true;
            }
            if (detectedPort == null) {
              final match = portRegex.firstMatch(content);
              if (match != null) {
                final portStr = match.group(1) ?? match.group(2) ?? match.group(3);
                if (portStr != null) {
                  final pVal = int.tryParse(portStr);
                  if (pVal != null && pVal > 1024 && pVal < 65535) {
                    detectedPort = pVal;
                  }
                }
              }
            }
          } catch (_) {}
        }
      }
    }

    if (pythonScript == null && nodeScript == null && databasePath == null && detectedPort == null && !usesSqlite) {
      return null;
    }

    String? instructions;
    if (pythonScript != null) {
      instructions = 'Run "python3 $pythonScript" to start the companion server';
      if (detectedPort != null) {
        instructions += ' on port $detectedPort';
      }
      if (databasePath != null) {
        instructions += ' (uses $databasePath database)';
      } else if (usesSqlite) {
        instructions += ' (uses SQLite database)';
      }
      instructions += '.';
    } else if (nodeScript != null) {
      instructions = 'Run "node $nodeScript" to start the companion backend';
      if (detectedPort != null) {
        instructions += ' on port $detectedPort';
      }
      instructions += '.';
    }

    return BackendRequirement(
      requiresPython: pythonScript != null,
      pythonScript: pythonScript,
      requiresNode: nodeScript != null,
      nodeScript: nodeScript,
      hasDatabase: databasePath != null || usesSqlite,
      databasePath: databasePath ?? (usesSqlite ? 'SQLite' : null),
      backendPort: detectedPort,
      setupInstructions: instructions,
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
