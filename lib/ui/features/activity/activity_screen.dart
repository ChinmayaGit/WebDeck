import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../data/models/installed_app.dart';
import '../../../runtime/job_scheduler.dart';
import '../../../runtime/manifest.dart';
import '../../../runtime/notification_service.dart';
import '../../../runtime/settings_service.dart';
import '../../../runtime/tools_service.dart';
import '../../core/theme.dart';
import '../catalog/view_models/catalog_view_model.dart';

class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key});

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  @override
  Widget build(BuildContext context) {
    final notifications = context.watch<NotificationService>();
    final tools = context.watch<ToolsService>();
    final catalog = context.watch<CatalogViewModel>();
    final jobApps = catalog.apps.where((a) => a.manifest?.jobs.isNotEmpty ?? false).toList();

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Activity'),
          bottom: TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(text: 'Notifications${notifications.unreadCount > 0 ? ' (${notifications.unreadCount})' : ''}'),
              Tab(text: 'Tasks${tools.runningTaskCount > 0 ? ' (${tools.runningTaskCount})' : ''}'),
              const Tab(text: 'Background checks'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _NotificationsTab(service: notifications),
            _TasksTab(tools: tools),
            _JobsTab(apps: jobApps),
          ],
        ),
      ),
    );
  }
}

String _ago(DateTime? t) {
  if (t == null) return 'never';
  final d = DateTime.now().difference(t);
  if (d.inSeconds < 60) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes}m ago';
  if (d.inHours < 24) return '${d.inHours}h ago';
  return '${d.inDays}d ago';
}

class _Empty extends StatelessWidget {
  final IconData icon;
  final String text;
  const _Empty(this.icon, this.text);

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 40, color: WebDeckTheme.textSecondary),
              const SizedBox(height: 12),
              Text(text, textAlign: TextAlign.center, style: const TextStyle(color: WebDeckTheme.textSecondary)),
            ],
          ),
        ),
      );
}

class _NotificationsTab extends StatelessWidget {
  final NotificationService service;
  const _NotificationsTab({required this.service});

  @override
  Widget build(BuildContext context) {
    final items = service.items;
    if (items.isEmpty) {
      return const _Empty(Icons.notifications_none, 'No notifications yet.\nTrackers post here when something changes.');
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: service.clear,
            icon: const Icon(Icons.clear_all, size: 18),
            label: const Text('Clear all'),
          ),
        ),
        for (final n in items) _NotificationTile(n: n),
      ],
    );
  }
}

class _NotificationTile extends StatelessWidget {
  final AppNotification n;
  const _NotificationTile({required this.n});

  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          leading: Icon(
            n.read ? Icons.notifications_none : Icons.notifications_active,
            color: n.read ? WebDeckTheme.textSecondary : WebDeckTheme.primary,
          ),
          title: Text(n.title),
          subtitle: Text(
            [if (n.body.isNotEmpty) n.body, '${n.appName} · ${_ago(n.at)}'].join('\n'),
          ),
          isThreeLine: n.body.isNotEmpty,
          trailing: n.url == null
              ? null
              : IconButton(
                  tooltip: 'Open link',
                  icon: const Icon(Icons.open_in_new, size: 18),
                  onPressed: () => launchUrl(Uri.parse(n.url!), mode: LaunchMode.externalApplication),
                ),
        ),
      );
}

class _TasksTab extends StatelessWidget {
  final ToolsService tools;
  const _TasksTab({required this.tools});

  @override
  Widget build(BuildContext context) {
    final tasks = tools.tasks;
    if (tasks.isEmpty) {
      return const _Empty(Icons.terminal, 'No tasks yet.\nDownloads and conversions started by apps show up here.');
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: tools.clearFinished,
            icon: const Icon(Icons.clear_all, size: 18),
            label: const Text('Clear finished'),
          ),
        ),
        for (final t in tasks)
          Card(
            child: ListTile(
              leading: switch (t.status) {
                ToolTaskStatus.running =>
                  const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
                ToolTaskStatus.done => const Icon(Icons.check_circle, color: WebDeckTheme.accentGreen),
                ToolTaskStatus.failed => const Icon(Icons.error, color: WebDeckTheme.accentRed),
                ToolTaskStatus.cancelled => const Icon(Icons.cancel, color: WebDeckTheme.textSecondary),
              },
              title: Text('${t.appName} · ${t.tool}'),
              subtitle: Text(
                t.error ?? (t.lastLine.isEmpty ? 'Started ${_ago(t.startedAt)}' : t.lastLine),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
              trailing: t.status == ToolTaskStatus.running
                  ? TextButton(onPressed: () => tools.cancel(t.id), child: const Text('Cancel'))
                  : null,
            ),
          ),
      ],
    );
  }
}

class _JobsTab extends StatelessWidget {
  final List<InstalledApp> apps;
  const _JobsTab({required this.apps});

  @override
  Widget build(BuildContext context) {
    final scheduler = context.watch<JobScheduler>();
    final settings = context.watch<SettingsService>();
    if (apps.isEmpty) {
      return const _Empty(Icons.schedule, 'No installed app runs background checks.\nTry Price Tracker or Free Games from the Store.');
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (!settings.backgroundJobs)
          Card(
            color: WebDeckTheme.surfaceSubtle,
            child: ListTile(
              leading: const Icon(Icons.pause_circle_outline, color: Color(0xFFD29922)),
              title: const Text('Background checks are paused'),
              trailing: TextButton(onPressed: () => settings.setBackgroundJobs(true), child: const Text('Resume')),
            ),
          ),
        if (!scheduler.hostAttached)
          const Card(
            child: ListTile(
              leading: Icon(Icons.info_outline),
              title: Text('Background checks need the built-in WebView (macOS, iOS, Android).'),
            ),
          ),
        for (final app in apps)
          FutureBuilder<Map<String, JobState>>(
            future: scheduler.states(app.id),
            builder: (ctx, snap) {
              final states = snap.data ?? const {};
              return Card(
                child: Column(
                  children: [
                    for (final job in app.manifest!.jobs)
                      _JobTile(app: app, job: job, state: states[job.id] ?? const JobState()),
                  ],
                ),
              );
            },
          ),
      ],
    );
  }
}

class _JobTile extends StatelessWidget {
  final InstalledApp app;
  final JobSpec job;
  final JobState state;
  const _JobTile({required this.app, required this.job, required this.state});

  @override
  Widget build(BuildContext context) {
    final scheduler = context.read<JobScheduler>();
    final running = scheduler.isQueued(app.id, job.id);
    final statusColor = switch (state.lastStatus) {
      'ok' => WebDeckTheme.accentGreen,
      null => WebDeckTheme.textSecondary,
      _ => WebDeckTheme.accentRed,
    };
    return ListTile(
      title: Text('${app.name} · ${job.title}'),
      subtitle: Text(
        'Every ${JobSpec.formatInterval(job.every)} · last run ${_ago(state.lastRun)}'
        '${state.lastSummary != null && state.lastSummary!.isNotEmpty ? '\n${state.lastSummary}' : ''}',
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
      leading: Icon(Icons.circle, size: 12, color: statusColor),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          running
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : IconButton(
                  tooltip: 'Run now',
                  icon: const Icon(Icons.play_arrow),
                  onPressed: scheduler.hostAttached
                      ? () => scheduler.runNow(app, job.id).catchError((Object _) => const JobState())
                      : null,
                ),
          Switch(value: state.enabled, onChanged: (v) => scheduler.setEnabled(app.id, job.id, v)),
        ],
      ),
    );
  }
}
