import 'dart:async';
import 'dart:convert';
import 'dart:ffi' show Abi;
import 'dart:io' hide BytesBuilder;
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;

/// A helper program WebDeck can locate or install for apps (desktop only).
class ToolSpec {
  final String id;
  final String name;
  final String description;
  final List<String> binaries;
  final bool installable;
  final String homepage;

  const ToolSpec({
    required this.id,
    required this.name,
    required this.description,
    required this.binaries,
    required this.homepage,
    this.installable = true,
  });

  String get primaryBinary => binaries.first;
}

class ToolStatus {
  final ToolSpec spec;
  final String? path;
  final String? source; // 'managed' | 'system'
  final String? version;

  const ToolStatus(this.spec, {this.path, this.source, this.version});

  bool get installed => path != null;

  Map<String, dynamic> toJson() => {
        'id': spec.id,
        'name': spec.name,
        'installed': installed,
        'source': source,
        'version': version,
        'installable': spec.installable,
      };
}

enum ToolTaskStatus { running, done, failed, cancelled }

class ToolTask {
  final String id;
  final String appId;
  final String appName;
  final String tool;
  final List<String> args;
  final String cwd;
  final DateTime startedAt;
  final List<String> lines = [];
  int droppedLines = 0;
  ToolTaskStatus status = ToolTaskStatus.running;
  int? exitCode;
  DateTime? endedAt;
  String? error;
  List<String> outputFiles = const [];
  Process? _process;

  ToolTask({
    required this.id,
    required this.appId,
    required this.appName,
    required this.tool,
    required this.args,
    required this.cwd,
  }) : startedAt = DateTime.now();

  static const maxLines = 1500;

  /// Total lines ever produced, used as a cursor by the SDK's polling.
  int get lineCount => droppedLines + lines.length;

  String get lastLine => lines.isEmpty ? '' : lines.last;

  Map<String, dynamic> toJson({int since = 0}) {
    final start = (since - droppedLines).clamp(0, lines.length);
    return {
      'id': id,
      'tool': tool,
      'status': status.name,
      'exitCode': exitCode,
      'error': error,
      'cwd': cwd,
      'lines': lines.sublist(start),
      'cursor': lineCount,
      'outputFiles': outputFiles,
      'startedAt': startedAt.toIso8601String(),
      'endedAt': endedAt?.toIso8601String(),
    };
  }
}

class ToolInstallState {
  final double? progress;
  final String message;
  const ToolInstallState(this.message, [this.progress]);
}

/// Finds, installs and runs helper binaries on behalf of runtime apps.
class ToolsService extends ChangeNotifier {
  final Future<Directory> Function() _baseDir;
  final http.Client _http;

  ToolsService(this._baseDir, {http.Client? httpClient}) : _http = httpClient ?? http.Client();

  static const specs = <ToolSpec>[
    ToolSpec(
      id: 'yt-dlp',
      name: 'yt-dlp',
      description: 'Downloads video and audio from YouTube and 1,000+ other sites.',
      binaries: ['yt-dlp'],
      homepage: 'https://github.com/yt-dlp/yt-dlp',
    ),
    ToolSpec(
      id: 'ffmpeg',
      name: 'FFmpeg',
      description: 'Merges, converts and extracts audio/video streams.',
      binaries: ['ffmpeg', 'ffprobe'],
      homepage: 'https://ffmpeg.org',
    ),
    ToolSpec(
      id: 'pandoc',
      name: 'Pandoc',
      description: 'Converts between Markdown, Word, HTML, ODT, EPUB, RTF and more.',
      binaries: ['pandoc'],
      homepage: 'https://pandoc.org',
    ),
    ToolSpec(
      id: 'rclone',
      name: 'rclone',
      description: 'Connects to FTP, SFTP, WebDAV, SMB, S3 and 70+ storage services.',
      binaries: ['rclone'],
      homepage: 'https://rclone.org',
    ),
    ToolSpec(
      id: 'libreoffice',
      name: 'LibreOffice',
      description: 'Office ↔ PDF conversion. Install it yourself from libreoffice.org.',
      binaries: ['soffice'],
      homepage: 'https://www.libreoffice.org/download/',
      installable: false,
    ),
  ];

  static ToolSpec? spec(String id) {
    for (final s in specs) {
      if (s.id == id) return s;
    }
    return null;
  }

  static bool get isSupportedPlatform => Platform.isMacOS || Platform.isWindows || Platform.isLinux;

  final Map<String, ToolInstallState> _installing = {};
  final Map<String, String> _versionCache = {};
  final Map<String, ToolTask> _tasks = {};
  int _taskCounter = 0;

  ToolInstallState? installState(String id) => _installing[id];

  List<ToolTask> get tasks =>
      _tasks.values.toList()..sort((a, b) => b.startedAt.compareTo(a.startedAt));

  int get runningTaskCount => _tasks.values.where((t) => t.status == ToolTaskStatus.running).length;

  ToolTask? task(String id) => _tasks[id];

  // ---------------------------------------------------------------- resolving

  Future<Directory> _toolDir(String id) async {
    final dir = Directory(p.join((await _baseDir()).path, 'tools', id));
    return dir;
  }

  static String _exe(String name) => Platform.isWindows ? '$name.exe' : name;

  Future<String?> _managedPath(String toolId, String binary) async {
    final f = File(p.join((await _toolDir(toolId)).path, _exe(binary)));
    return await f.exists() ? f.path : null;
  }

  static List<String> _systemDirs() {
    final dirs = <String>[
      if (Platform.isMacOS) ...['/opt/homebrew/bin', '/usr/local/bin'],
      if (Platform.isLinux) ...['/usr/local/bin', '/usr/bin', '/snap/bin'],
    ];
    final path = Platform.environment['PATH'] ?? '';
    dirs.addAll(path.split(Platform.isWindows ? ';' : ':').where((d) => d.isNotEmpty));
    return dirs.toSet().toList();
  }

  static String? _systemPath(String binary) {
    if (binary == 'soffice') {
      final known = <String>[
        if (Platform.isMacOS) '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        if (Platform.isWindows) r'C:\Program Files\LibreOffice\program\soffice.exe',
        if (Platform.isLinux) ...['/usr/bin/soffice', '/usr/bin/libreoffice'],
      ];
      for (final k in known) {
        if (File(k).existsSync()) return k;
      }
    }
    for (final dir in _systemDirs()) {
      final candidate = File(p.join(dir, _exe(binary)));
      if (candidate.existsSync()) return candidate.path;
    }
    return null;
  }

  /// Path to a tool's binary: WebDeck-managed copy first, then the system install.
  Future<String?> resolve(String toolId, {String? binary}) async {
    final s = spec(toolId);
    if (s == null) return null;
    final bin = binary ?? s.primaryBinary;
    return await _managedPath(toolId, bin) ?? _systemPath(bin);
  }

  Future<ToolStatus> status(String toolId, {bool withVersion = false}) async {
    final s = spec(toolId)!;
    final managed = await _managedPath(toolId, s.primaryBinary);
    final path = managed ?? _systemPath(s.primaryBinary);
    String? version;
    if (path != null && withVersion) version = await _version(toolId, path);
    return ToolStatus(
      s,
      path: path,
      source: path == null ? null : (managed != null ? 'managed' : 'system'),
      version: version,
    );
  }

  Future<List<ToolStatus>> statuses({bool withVersion = false}) =>
      Future.wait(specs.map((s) => status(s.id, withVersion: withVersion)));

  Future<String?> _version(String toolId, String path) async {
    final cached = _versionCache[path];
    if (cached != null) return cached;
    if (toolId == 'libreoffice') return null; // starting soffice is slow
    try {
      final flag = toolId == 'ffmpeg' ? '-version' : '--version';
      final r = await Process.run(path, [flag]).timeout(const Duration(seconds: 15));
      final first = (r.stdout as String).split('\n').first.trim();
      final v = first.isEmpty ? null : first;
      if (v != null) _versionCache[path] = v;
      return v;
    } catch (_) {
      return null;
    }
  }

  // --------------------------------------------------------------- installing

  bool get _isArm64 => Abi.current() == Abi.macosArm64 || Abi.current() == Abi.linuxArm64 || Abi.current() == Abi.windowsArm64;

  void _setInstall(String id, String msg, [double? progress]) {
    _installing[id] = ToolInstallState(msg, progress);
    notifyListeners();
  }

  /// Downloads the latest build of a tool into `<WebDeck>/tools/<id>/`.
  Future<void> install(String toolId) async {
    final s = spec(toolId);
    if (s == null) throw ArgumentError('Unknown tool "$toolId"');
    if (!s.installable) throw StateError('${s.name} must be installed manually from ${s.homepage}');
    if (!isSupportedPlatform) throw UnsupportedError('Tools are only available on desktop.');
    if (_installing.containsKey(toolId)) throw StateError('${s.name} is already being installed');

    final dir = await _toolDir(toolId);
    final staging = Directory('${dir.path}.staging');
    try {
      _setInstall(toolId, 'Preparing…');
      if (await staging.exists()) await staging.delete(recursive: true);
      await staging.create(recursive: true);

      switch (toolId) {
        case 'yt-dlp':
          await _installYtDlp(staging);
        case 'ffmpeg':
          await _installFfmpeg(staging);
        case 'pandoc':
          await _installPandoc(staging);
        case 'rclone':
          await _installRclone(staging);
      }

      for (final bin in s.binaries) {
        final f = File(p.join(staging.path, _exe(bin)));
        if (!await f.exists()) throw StateError('Download did not contain ${_exe(bin)}');
        if (!Platform.isWindows) await Process.run('chmod', ['755', f.path]);
      }
      if (await dir.exists()) await dir.delete(recursive: true);
      await staging.rename(dir.path);
      _versionCache.clear();
    } finally {
      if (await staging.exists()) await staging.delete(recursive: true);
      _installing.remove(toolId);
      notifyListeners();
    }
  }

  Future<void> uninstall(String toolId) async {
    final dir = await _toolDir(toolId);
    if (await dir.exists()) await dir.delete(recursive: true);
    _versionCache.clear();
    notifyListeners();
  }

  Future<void> _installYtDlp(Directory out) async {
    final asset = Platform.isMacOS
        ? 'yt-dlp_macos'
        : Platform.isWindows
            ? 'yt-dlp.exe'
            : (_isArm64 ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux');
    final bytes = await _download(
      'yt-dlp',
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/$asset',
      label: 'yt-dlp',
    );
    await File(p.join(out.path, _exe('yt-dlp'))).writeAsBytes(bytes, flush: true);
  }

  Future<void> _installFfmpeg(Directory out) async {
    if (Platform.isMacOS) {
      final arch = _isArm64 ? 'arm64' : 'amd64';
      for (final bin in ['ffmpeg', 'ffprobe']) {
        final url = await _martinRiedlUrl(arch, bin);
        final zip = await _download('ffmpeg', url, label: bin);
        await _extractZip('ffmpeg', zip, out, [bin]);
      }
    } else if (Platform.isWindows) {
      final zip = await _download(
        'ffmpeg',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
        label: 'FFmpeg',
      );
      await _extractZip('ffmpeg', zip, out, ['ffmpeg', 'ffprobe']);
    } else {
      final flavor = _isArm64 ? 'linuxarm64' : 'linux64';
      final tarXz = await _download(
        'ffmpeg',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-$flavor-gpl.tar.xz',
        label: 'FFmpeg',
      );
      _setInstall('ffmpeg', 'Unpacking…');
      final tar = XZDecoder().decodeBytes(tarXz);
      await _extractFromArchive(TarDecoder().decodeBytes(tar), out, ['ffmpeg', 'ffprobe']);
    }
  }

  /// The "latest" redirect on ffmpeg.martin-riedl.de is intermittently 404, so
  /// retry it and then fall back to reading the newest build link from the homepage.
  Future<String> _martinRiedlUrl(String arch, String bin) async {
    const host = 'https://ffmpeg.martin-riedl.de';
    final redirect = '$host/redirect/latest/macos/$arch/release/$bin.zip';
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        final req = http.Request('HEAD', Uri.parse(redirect));
        final res = await _http.send(req).timeout(const Duration(seconds: 20));
        if (res.statusCode == 200) return redirect;
      } catch (_) {}
      await Future.delayed(const Duration(seconds: 1));
    }
    final page = await _http.get(Uri.parse('$host/')).timeout(const Duration(seconds: 30));
    final match = RegExp('href="(/download/macos/$arch/[^"]+/$bin\\.zip)"').firstMatch(page.body);
    if (match == null) throw StateError('Could not find an FFmpeg build for macOS $arch');
    return '$host${match.group(1)}';
  }

  Future<void> _installPandoc(Directory out) async {
    _setInstall('pandoc', 'Finding latest release…');
    final res = await _http
        .get(Uri.parse('https://api.github.com/repos/jgm/pandoc/releases/latest'),
            headers: {'Accept': 'application/vnd.github+json'})
        .timeout(const Duration(seconds: 30));
    if (res.statusCode != 200) throw StateError('GitHub API returned ${res.statusCode}');
    final assets = ((jsonDecode(res.body) as Map)['assets'] as List).cast<Map<String, dynamic>>();
    final pattern = Platform.isMacOS
        ? RegExp(_isArm64 ? r'arm64-macOS\.zip$' : r'x86_64-macOS\.zip$')
        : Platform.isWindows
            ? RegExp(r'windows-x86_64\.zip$')
            : RegExp(_isArm64 ? r'linux-arm64\.tar\.gz$' : r'linux-amd64\.tar\.gz$');
    final asset = assets.firstWhere(
      (a) => pattern.hasMatch(a['name'] as String),
      orElse: () => throw StateError('No pandoc build for this platform'),
    );
    final bytes = await _download('pandoc', asset['browser_download_url'] as String, label: 'Pandoc');
    if ((asset['name'] as String).endsWith('.zip')) {
      await _extractZip('pandoc', bytes, out, ['pandoc']);
    } else {
      final tar = GZipDecoder().decodeBytes(bytes);
      await _extractFromArchive(TarDecoder().decodeBytes(tar), out, ['pandoc']);
    }
  }

  Future<void> _installRclone(Directory out) async {
    final os = Platform.isMacOS ? 'osx' : Platform.isWindows ? 'windows' : 'linux';
    final arch = _isArm64 ? 'arm64' : 'amd64';
    final zip = await _download('rclone', 'https://downloads.rclone.org/rclone-current-$os-$arch.zip', label: 'rclone');
    await _extractZip('rclone', zip, out, ['rclone']);
  }

  Future<Uint8List> _download(String toolId, String url, {required String label}) async {
    _setInstall(toolId, 'Downloading $label…', 0);
    final res = await _http.send(http.Request('GET', Uri.parse(url)));
    if (res.statusCode != 200) {
      throw HttpException('Download failed (${res.statusCode}) for $url');
    }
    final total = res.contentLength;
    final builder = BytesBuilder(copy: false);
    var received = 0;
    var lastNotify = DateTime.now();
    await for (final chunk in res.stream) {
      builder.add(chunk);
      received += chunk.length;
      if (DateTime.now().difference(lastNotify).inMilliseconds > 150) {
        lastNotify = DateTime.now();
        final mb = (received / 1048576).toStringAsFixed(1);
        _setInstall(
          toolId,
          'Downloading $label… $mb MB',
          total != null && total > 0 ? received / total : null,
        );
      }
    }
    return builder.takeBytes();
  }

  Future<void> _extractZip(String toolId, Uint8List bytes, Directory out, List<String> names) async {
    _setInstall(toolId, 'Unpacking…');
    await _extractFromArchive(ZipDecoder().decodeBytes(bytes), out, names);
  }

  Future<void> _extractFromArchive(Archive archive, Directory out, List<String> names) async {
    final wanted = names.map(_exe).toSet();
    for (final file in archive) {
      if (!file.isFile) continue;
      final base = p.basename(file.name);
      if (wanted.contains(base)) {
        await File(p.join(out.path, base)).writeAsBytes(file.content as List<int>, flush: true);
        wanted.remove(base);
      }
    }
    if (wanted.isNotEmpty) throw StateError('Archive is missing ${wanted.join(', ')}');
  }

  // ------------------------------------------------------------------ running

  /// Options that would let an app make a tool execute arbitrary programs or
  /// load code from outside its bundle.
  static const _blockedArgs = <String, List<String>>{
    'yt-dlp': [
      '--exec', '--exec-before-download', '--netrc-cmd', '--downloader', '--external-downloader',
      '--ffmpeg-location', '--config-location', '--config-locations', '--plugin-dirs', '--use-postprocessor',
    ],
    'pandoc': ['--filter', '-F', '--lua-filter', '-L', '--pdf-engine', '--data-dir'],
    'ffmpeg': [],
    'libreoffice': ['-env:', '--accept', '--infilter'],
    'rclone': ['--password-command', '--config', '--rc', '--rc-addr', '--bwlimit-file'],
  };

  /// rclone can also serve, mount or run remote control servers; apps only get file operations.
  static const _rcloneCommands = {
    'lsjson', 'lsf', 'copyto', 'copy', 'moveto', 'move', 'deletefile', 'delete', 'mkdir', 'rmdir',
    'purge', 'obscure', 'about', 'size', 'version', 'cat', 'touch', 'link', 'md5sum', 'sha1sum',
  };

  static void validateArgs(String tool, List<String> args) {
    if (tool == 'rclone') {
      final command = args.firstWhere((a) => !a.startsWith('-'), orElse: () => '');
      if (!_rcloneCommands.contains(command)) {
        throw ArgumentError('rclone "$command" is not allowed for apps');
      }
    }
    final blocked = _blockedArgs[tool] ?? const [];
    for (final arg in args) {
      for (final b in blocked) {
        if (arg == b || arg.startsWith('$b=') || (b.endsWith(':') && arg.startsWith(b))) {
          throw ArgumentError('The "$b" option is not allowed for $tool');
        }
      }
    }
  }

  /// Runs an arbitrary command line through the user's shell (Terminal app; `shell` permission).
  Future<ToolTask> runShell({
    required String appId,
    required String appName,
    required String command,
    required String cwd,
  }) async {
    final String exe;
    final List<String> args;
    if (Platform.isWindows) {
      exe = 'cmd.exe';
      args = ['/c', command];
    } else {
      exe = Platform.environment['SHELL'] ?? (Platform.isMacOS ? '/bin/zsh' : '/bin/bash');
      args = ['-lc', command];
    }
    return _start(appId: appId, appName: appName, label: 'shell', bin: exe, args: args, cwd: cwd, trackFiles: false);
  }

  Future<ToolTask> run({
    required String appId,
    required String appName,
    required String tool,
    required List<String> args,
    required String cwd,
  }) async {
    final s = spec(tool);
    if (s == null) throw ArgumentError('Unknown tool "$tool"');
    validateArgs(tool, args);
    final bin = await resolve(tool);
    if (bin == null) throw StateError('${s.name} is not installed');

    final finalArgs = [...args];
    final extraDirs = <String>[];
    final ffmpeg = await resolve('ffmpeg');
    if (ffmpeg != null) extraDirs.add(p.dirname(ffmpeg));
    if (tool == 'yt-dlp' && ffmpeg != null) {
      finalArgs.insertAll(0, ['--ffmpeg-location', p.dirname(ffmpeg)]);
    }
    return _start(appId: appId, appName: appName, label: tool, bin: bin, args: finalArgs, cwd: cwd, extraPath: extraDirs);
  }

  Future<ToolTask> _start({
    required String appId,
    required String appName,
    required String label,
    required String bin,
    required List<String> args,
    required String cwd,
    List<String> extraPath = const [],
    bool trackFiles = true,
  }) async {
    final env = Map<String, String>.from(Platform.environment);
    final sep = Platform.isWindows ? ';' : ':';
    env['PATH'] = [...extraPath, env['PATH'] ?? '', ..._systemDirs()].join(sep);
    env['PYTHONIOENCODING'] = 'utf-8';
    final finalArgs = args;
    final tool = label;
    final s = spec(tool) ?? ToolSpec(id: tool, name: tool, description: '', binaries: [tool], homepage: '');

    await Directory(cwd).create(recursive: true);
    final before = trackFiles ? await _snapshot(cwd) : const <String, int>{};

    final task = ToolTask(
      id: 't${++_taskCounter}-${DateTime.now().millisecondsSinceEpoch}',
      appId: appId,
      appName: appName,
      tool: tool,
      args: finalArgs,
      cwd: cwd,
    );
    _tasks[task.id] = task;
    _trimTasks();

    try {
      task._process = await Process.start(bin, finalArgs, workingDirectory: cwd, environment: env);
    } catch (e) {
      task
        ..status = ToolTaskStatus.failed
        ..error = 'Could not start ${s.name}: $e'
        ..endedAt = DateTime.now();
      notifyListeners();
      return task;
    }
    notifyListeners();

    void addLine(String line) {
      final trimmed = line.trimRight();
      if (trimmed.isEmpty) return;
      task.lines.add(trimmed);
      if (task.lines.length > ToolTask.maxLines) {
        task.lines.removeAt(0);
        task.droppedLines++;
      }
    }

    Stream<String> linesOf(Stream<List<int>> s) => s
        .transform(const Utf8Decoder(allowMalformed: true))
        // yt-dlp/ffmpeg redraw progress with \r; treat it as a line break.
        .transform(StreamTransformer.fromHandlers(handleData: (String data, EventSink<String> sink) {
          sink.add(data.replaceAll('\r', '\n'));
        }))
        .transform(const LineSplitter());

    var lastNotify = DateTime.now();
    void onLine(String l) {
      addLine(l);
      if (DateTime.now().difference(lastNotify).inMilliseconds > 500) {
        lastNotify = DateTime.now();
        notifyListeners();
      }
    }

    final out = linesOf(task._process!.stdout).listen(onLine).asFuture<void>();
    final err = linesOf(task._process!.stderr).listen(onLine).asFuture<void>();

    unawaited(() async {
      final code = await task._process!.exitCode;
      await Future.wait([out, err]).catchError((_) => <void>[]);
      task.exitCode = code;
      task.endedAt = DateTime.now();
      if (task.status == ToolTaskStatus.running) {
        task.status = code == 0 ? ToolTaskStatus.done : ToolTaskStatus.failed;
        if (code != 0) task.error = '${s.name} exited with code $code';
      }
      if (trackFiles) task.outputFiles = await _changedFiles(cwd, before);
      task._process = null;
      notifyListeners();
    }());

    return task;
  }

  bool cancel(String taskId) {
    final task = _tasks[taskId];
    if (task == null || task.status != ToolTaskStatus.running) return false;
    task.status = ToolTaskStatus.cancelled;
    task._process?.kill(ProcessSignal.sigterm);
    notifyListeners();
    return true;
  }

  void clearFinished() {
    _tasks.removeWhere((_, t) => t.status != ToolTaskStatus.running);
    notifyListeners();
  }

  void _trimTasks() {
    final finished = _tasks.values.where((t) => t.status != ToolTaskStatus.running).toList()
      ..sort((a, b) => a.startedAt.compareTo(b.startedAt));
    while (finished.length > 50) {
      _tasks.remove(finished.removeAt(0).id);
    }
  }

  static Future<Map<String, int>> _snapshot(String dir) async {
    final map = <String, int>{};
    final d = Directory(dir);
    if (!await d.exists()) return map;
    await for (final e in d.list()) {
      if (e is File) map[e.path] = (await e.stat()).modified.millisecondsSinceEpoch;
    }
    return map;
  }

  static Future<List<String>> _changedFiles(String dir, Map<String, int> before) async {
    final after = await _snapshot(dir);
    return after.entries
        .where((e) => before[e.key] != e.value)
        .map((e) => e.key)
        // Skip yt-dlp/ffmpeg temp fragments.
        .where((path) => !RegExp(r'\.(part|ytdl|temp|tmp)$|\.f\d+\.\w+$|\.part-Frag\d+').hasMatch(path))
        .toList();
  }

  @override
  void dispose() {
    for (final t in _tasks.values) {
      t._process?.kill();
    }
    _http.close();
    super.dispose();
  }
}
