// ignore_for_file: prefer_initializing_formals
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

import '../data/models/installed_app.dart';
import 'app_data_store.dart';
import 'manifest.dart';
import 'settings_service.dart';

class JobState {
  final DateTime? lastRun;
  final String? lastStatus; // ok | failed | timeout
  final String? lastSummary;
  final bool enabled;

  const JobState({this.lastRun, this.lastStatus, this.lastSummary, this.enabled = true});

  JobState copyWith({DateTime? lastRun, String? lastStatus, String? lastSummary, bool? enabled}) => JobState(
        lastRun: lastRun ?? this.lastRun,
        lastStatus: lastStatus ?? this.lastStatus,
        lastSummary: lastSummary ?? this.lastSummary,
        enabled: enabled ?? this.enabled,
      );

  Map<String, dynamic> toJson() => {
        'lastRun': lastRun?.toIso8601String(),
        'lastStatus': lastStatus,
        'lastSummary': lastSummary,
        'enabled': enabled,
      };

  factory JobState.fromJson(Map<String, dynamic> j) => JobState(
        lastRun: DateTime.tryParse(j['lastRun'] as String? ?? ''),
        lastStatus: j['lastStatus'] as String?,
        lastSummary: j['lastSummary'] as String?,
        enabled: j['enabled'] as bool? ?? true,
      );
}

/// A job currently executing in the hidden job WebView.
class JobRun {
  final String runId;
  final InstalledApp app;
  final JobSpec job;
  final String url;
  final DateTime startedAt = DateTime.now();
  final List<String> log = [];
  final Completer<JobState> _done = Completer();

  JobRun(this.runId, this.app, this.job, this.url);

  Future<JobState> get done => _done.future;
}

class ServerHandle {
  final String baseUrl;
  final bool wasRunning;
  const ServerHandle(this.baseUrl, this.wasRunning);
}

/// Runs `jobs` declared in app manifests on their interval. Each run loads the
/// app's job entry page in a hidden WebView (see JobRunnerHost), where the
/// app's own JS does the work and reports back via `webdeck.job.done()`.
class JobScheduler extends ChangeNotifier {
  final Future<List<InstalledApp>> Function() _apps;
  final Future<ServerHandle> Function(InstalledApp app) _ensureServer;
  final Future<void> Function(String appId) _stopServer;
  final SettingsService _settings;
  final AppDataStore _store;

  JobScheduler({
    required Future<List<InstalledApp>> Function() apps,
    required Future<ServerHandle> Function(InstalledApp app) ensureServer,
    required Future<void> Function(String appId) stopServer,
    required SettingsService settings,
    required AppDataStore store,
  })  : _apps = apps,
        _ensureServer = ensureServer,
        _stopServer = stopServer,
        _settings = settings,
        _store = store;

  static const runTimeout = Duration(minutes: 3);

  Timer? _timer;
  JobRun? _current;
  final List<(InstalledApp, JobSpec, Completer<JobState>?)> _queue = [];
  final Map<String, Map<String, JobState>> _states = {};
  bool _draining = false;
  int _runCounter = 0;

  /// The run the hidden WebView should be executing, if any.
  JobRun? get current => _current;

  /// Whether a UI host is attached that can execute jobs.
  bool hostAttached = false;

  void start() {
    _timer?.cancel();
    // First pass shortly after launch, then once a minute.
    _timer = Timer(const Duration(seconds: 20), () {
      _tick();
      _timer = Timer.periodic(const Duration(minutes: 1), (_) => _tick());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<File> _stateFile(String appId) async =>
      File(p.join((await _store.appDir(appId)).path, 'jobs.json'));

  Future<Map<String, JobState>> states(String appId) async {
    final cached = _states[appId];
    if (cached != null) return cached;
    final map = <String, JobState>{};
    try {
      final f = await _stateFile(appId);
      if (await f.exists()) {
        final json = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
        json.forEach((k, v) => map[k] = JobState.fromJson(v as Map<String, dynamic>));
      }
    } catch (_) {}
    return _states[appId] = map;
  }

  Future<void> _saveState(String appId, String jobId, JobState state) async {
    final map = await states(appId);
    map[jobId] = state;
    await (await _stateFile(appId))
        .writeAsString(jsonEncode(map.map((k, v) => MapEntry(k, v.toJson()))));
    notifyListeners();
  }

  Future<void> setEnabled(String appId, String jobId, bool enabled) async {
    final current = (await states(appId))[jobId] ?? const JobState();
    await _saveState(appId, jobId, current.copyWith(enabled: enabled));
  }

  bool isQueued(String appId, String jobId) =>
      (_current?.app.id == appId && _current?.job.id == jobId) ||
      _queue.any((q) => q.$1.id == appId && q.$2.id == jobId);

  Future<void> _tick() async {
    if (!_settings.backgroundJobs || !hostAttached) return;
    final apps = await _apps();
    final now = DateTime.now();
    for (final app in apps) {
      final manifest = app.manifest;
      if (manifest == null || !manifest.has(RuntimePermission.jobs)) continue;
      final appStates = await states(app.id);
      for (final job in manifest.jobs) {
        final state = appStates[job.id] ?? const JobState();
        if (!state.enabled || isQueued(app.id, job.id)) continue;
        final last = state.lastRun;
        if (last == null || now.difference(last) >= job.every) {
          _queue.add((app, job, null));
        }
      }
    }
    unawaited(_drain());
  }

  /// Queues a job immediately and completes when it finishes.
  Future<JobState> runNow(InstalledApp app, String jobId) {
    final job = app.manifest?.jobs.where((j) => j.id == jobId).firstOrNull;
    if (job == null) return Future.error(ArgumentError('Unknown job "$jobId"'));
    if (!hostAttached) return Future.error(StateError('Job runner is not ready yet'));
    final c = Completer<JobState>();
    _queue.add((app, job, c));
    notifyListeners();
    unawaited(_drain());
    return c.future;
  }

  Future<void> _drain() async {
    if (_draining) return;
    _draining = true;
    try {
      while (_queue.isNotEmpty) {
        final (app, job, waiter) = _queue.removeAt(0);
        final result = await _execute(app, job);
        waiter?.complete(result);
      }
    } finally {
      _draining = false;
    }
  }

  Future<JobState> _execute(InstalledApp app, JobSpec job) async {
    final prior = (await states(app.id))[job.id] ?? const JobState();
    ServerHandle? server;
    JobState result;
    try {
      server = await _ensureServer(app);
      final runId = 'r${++_runCounter}${DateTime.now().millisecondsSinceEpoch}';
      final entry = job.entry.startsWith('/') ? job.entry.substring(1) : job.entry;
      final url = Uri.parse(server.baseUrl).resolve(entry).replace(queryParameters: {
        'webdeck_job': job.id,
        'webdeck_run': runId,
      }).toString();
      final run = JobRun(runId, app, job, url);
      _current = run;
      notifyListeners();
      result = await run.done.timeout(runTimeout, onTimeout: () {
        return prior.copyWith(
          lastRun: DateTime.now(),
          lastStatus: 'timeout',
          lastSummary: 'Did not finish within ${runTimeout.inMinutes} minutes',
        );
      });
    } catch (e) {
      result = prior.copyWith(lastRun: DateTime.now(), lastStatus: 'failed', lastSummary: '$e');
    } finally {
      _current = null;
      notifyListeners();
      if (server != null && !server.wasRunning) {
        try {
          await _stopServer(app.id);
        } catch (_) {}
      }
    }
    await _saveState(app.id, job.id, result);
    return result;
  }

  /// Called by the runtime API when the job page reports completion.
  bool complete(String appId, String runId, {required bool ok, String? summary}) {
    final run = _current;
    if (run == null || run.runId != runId || run.app.id != appId || run._done.isCompleted) return false;
    final prior = _states[appId]?[run.job.id] ?? const JobState();
    run._done.complete(prior.copyWith(
      lastRun: DateTime.now(),
      lastStatus: ok ? 'ok' : 'failed',
      lastSummary: summary,
    ));
    return true;
  }

  void log(String appId, String runId, String message) {
    final run = _current;
    if (run == null || run.runId != runId || run.app.id != appId) return;
    if (run.log.length < 200) run.log.add(message);
  }

  /// Called by the host when the WebView failed to load the job page.
  void failCurrent(String runId, String reason) {
    final run = _current;
    if (run == null || run.runId != runId) return;
    complete(run.app.id, runId, ok: false, summary: reason);
  }
}
