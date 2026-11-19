import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

/// Version of the WebDeck runtime API exposed to apps through `window.webdeck`.
const String kRuntimeApiVersion = '1.0.0';

/// Permissions an app can request in `webdeck.json`.
///
/// Storage (`webdeck.db` / `webdeck.kv`) is always granted and scoped to the app.
class RuntimePermission {
  static const net = 'net';
  static const files = 'files';
  static const notify = 'notify';
  static const jobs = 'jobs';
  static const tools = 'tools';

  static const all = [net, files, notify, jobs, tools];

  static String describe(String permission) {
    switch (permission) {
      case net:
        return 'Fetch web pages and APIs on the internet';
      case files:
        return 'Open files you pick and save files to Downloads/WebDeck';
      case notify:
        return 'Show notifications';
      case jobs:
        return 'Run background checks on a schedule';
      case tools:
        return 'Run helper programs (yt-dlp, ffmpeg, pandoc, LibreOffice)';
      default:
        return permission;
    }
  }
}

/// A background job declared by an app.
class JobSpec {
  final String id;
  final String title;
  final Duration every;
  final String entry;

  const JobSpec({
    required this.id,
    required this.title,
    required this.every,
    this.entry = 'index.html',
  });

  factory JobSpec.fromJson(Map<String, dynamic> json) {
    final id = (json['id'] as String?)?.trim();
    if (id == null || id.isEmpty) {
      throw const FormatException('Job is missing an "id"');
    }
    return JobSpec(
      id: id,
      title: json['title'] as String? ?? id,
      every: parseInterval(json['every'] as String? ?? '6h'),
      entry: json['entry'] as String? ?? 'index.html',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'every': formatInterval(every),
        'entry': entry,
      };

  /// Parses "30m", "6h", "1d" style intervals. Minimum is 5 minutes.
  static Duration parseInterval(String raw) {
    final match = RegExp(r'^\s*(\d+)\s*([mhd])\s*$').firstMatch(raw.toLowerCase());
    if (match == null) {
      throw FormatException('Invalid job interval "$raw" (use e.g. 30m, 6h, 1d)');
    }
    final value = int.parse(match.group(1)!);
    final unit = match.group(2)!;
    final duration = switch (unit) {
      'm' => Duration(minutes: value),
      'h' => Duration(hours: value),
      _ => Duration(days: value),
    };
    return duration < const Duration(minutes: 5) ? const Duration(minutes: 5) : duration;
  }

  static String formatInterval(Duration d) {
    if (d.inMinutes % (60 * 24) == 0) return '${d.inDays}d';
    if (d.inMinutes % 60 == 0) return '${d.inHours}h';
    return '${d.inMinutes}m';
  }
}

/// Parsed `webdeck.json`. Its presence marks a bundle as a WebDeck runtime app:
/// a static web app that uses the host for storage, network, files and jobs
/// instead of shipping its own backend.
class WebDeckManifest {
  final String id;
  final String name;
  final String version;
  final String description;
  final String category;
  final String icon;
  final String color;
  final String entry;
  final Set<String> permissions;
  final List<JobSpec> jobs;
  final List<String> platforms;
  final String? author;

  const WebDeckManifest({
    required this.id,
    required this.name,
    required this.version,
    this.description = '',
    this.category = 'Utilities',
    this.icon = 'app',
    this.color = '#388BFD',
    this.entry = 'index.html',
    this.permissions = const {},
    this.jobs = const [],
    this.platforms = const [],
    this.author,
  });

  static const fileName = 'webdeck.json';

  bool has(String permission) => permissions.contains(permission);

  /// True when the app supports the current OS (an empty list means all).
  bool get supportsCurrentPlatform =>
      platforms.isEmpty || platforms.contains(currentPlatformId);

  static String get currentPlatformId {
    if (Platform.isMacOS) return 'macos';
    if (Platform.isWindows) return 'windows';
    if (Platform.isLinux) return 'linux';
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    return 'unknown';
  }

  factory WebDeckManifest.fromJson(Map<String, dynamic> json) {
    final id = (json['id'] as String?)?.trim();
    final name = (json['name'] as String?)?.trim();
    if (id == null || id.isEmpty) throw const FormatException('webdeck.json: "id" is required');
    if (!RegExp(r'^[a-z0-9][a-z0-9_-]{1,63}$').hasMatch(id)) {
      throw FormatException('webdeck.json: invalid id "$id" (use lowercase letters, digits, - and _)');
    }
    if (name == null || name.isEmpty) throw const FormatException('webdeck.json: "name" is required');

    final rawPerms = (json['permissions'] as List?)?.cast<String>() ?? const <String>[];
    final unknown = rawPerms.where((perm) => !RuntimePermission.all.contains(perm)).toList();
    if (unknown.isNotEmpty) {
      throw FormatException('webdeck.json: unknown permissions ${unknown.join(', ')}');
    }

    return WebDeckManifest(
      id: id,
      name: name,
      version: json['version'] as String? ?? '1.0.0',
      description: json['description'] as String? ?? '',
      category: json['category'] as String? ?? 'Utilities',
      icon: json['icon'] as String? ?? 'app',
      color: json['color'] as String? ?? '#388BFD',
      entry: json['entry'] as String? ?? 'index.html',
      permissions: rawPerms.toSet(),
      jobs: ((json['jobs'] as List?) ?? const [])
          .map((j) => JobSpec.fromJson(j as Map<String, dynamic>))
          .toList(),
      platforms: (json['platforms'] as List?)?.cast<String>() ?? const [],
      author: json['author'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'version': version,
        'description': description,
        'category': category,
        'icon': icon,
        'color': color,
        'entry': entry,
        'permissions': permissions.toList(),
        'jobs': jobs.map((j) => j.toJson()).toList(),
        'platforms': platforms,
        if (author != null) 'author': author,
      };

  /// Loads `webdeck.json` from an app directory, or returns null when absent/invalid.
  static Future<WebDeckManifest?> tryLoad(String appDir) async {
    final file = File(p.join(appDir, fileName));
    if (!await file.exists()) return null;
    try {
      return WebDeckManifest.fromJson(
        jsonDecode(await file.readAsString()) as Map<String, dynamic>,
      );
    } catch (_) {
      return null;
    }
  }
}

/// Compares dotted versions ("1.2.10" > "1.2.9"). Non-numeric parts compare as 0.
int compareVersions(String a, String b) {
  List<int> parts(String v) =>
      v.split(RegExp(r'[.+-]')).map((s) => int.tryParse(s) ?? 0).toList();
  final pa = parts(a), pb = parts(b);
  for (var i = 0; i < (pa.length > pb.length ? pa.length : pb.length); i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}
