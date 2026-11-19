import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../runtime/notification_service.dart';
import '../../../runtime/tools_service.dart';
import '../../core/theme.dart';
import '../activity/activity_screen.dart';
import '../catalog/views/home_screen.dart';
import '../settings/settings_screen.dart';
import '../store/store_screen.dart';
import 'app_launcher.dart';

/// Top-level navigation: installed Apps, Store, Activity and Settings.
class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  late final ShellNavigation _nav;

  @override
  void initState() {
    super.initState();
    _nav = context.read<ShellNavigation>();
    _nav.addListener(_onNav);
  }

  @override
  void dispose() {
    _nav.removeListener(_onNav);
    super.dispose();
  }

  int _previous = 0;

  void _onNav() {
    // Leaving Activity marks notifications as read.
    if (_previous == ShellNavigation.activity && _nav.value != ShellNavigation.activity) {
      context.read<NotificationService>().markAllRead();
    }
    _previous = _nav.value;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final unread = context.select<NotificationService, int>((n) => n.unreadCount);
    final running = context.select<ToolsService, int>((t) => t.runningTaskCount);
    final activityBadge = unread + running;

    Widget activityIcon(IconData icon) => activityBadge > 0
        ? Badge(label: Text('$activityBadge'), child: Icon(icon))
        : Icon(icon);

    final destinations = [
      (const Icon(Icons.apps_outlined), const Icon(Icons.apps), 'Apps'),
      (const Icon(Icons.storefront_outlined), const Icon(Icons.storefront), 'Store'),
      (activityIcon(Icons.notifications_none), activityIcon(Icons.notifications), 'Activity'),
      (const Icon(Icons.settings_outlined), const Icon(Icons.settings), 'Settings'),
    ];

    final body = IndexedStack(
      index: _nav.value,
      children: const [HomeScreen(), StoreScreen(), ActivityScreen(), SettingsScreen()],
    );

    final wide = MediaQuery.sizeOf(context).width >= 720;
    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              backgroundColor: WebDeckTheme.surface,
              selectedIndex: _nav.value,
              onDestinationSelected: (i) => _nav.value = i,
              labelType: NavigationRailLabelType.all,
              leading: Padding(
                padding: const EdgeInsets.only(top: 8, bottom: 16),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.asset(
                    'assets/icons/app_icon.png',
                    width: 36,
                    height: 36,
                    errorBuilder: (_, _, _) => const Icon(Icons.rocket_launch, color: WebDeckTheme.primary),
                  ),
                ),
              ),
              destinations: [
                for (final d in destinations)
                  NavigationRailDestination(icon: d.$1, selectedIcon: d.$2, label: Text(d.$3)),
              ],
            ),
            const VerticalDivider(width: 1, thickness: 1, color: WebDeckTheme.border),
            Expanded(child: body),
          ],
        ),
      );
    }
    return Scaffold(
      body: body,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _nav.value,
        onDestinationSelected: (i) => _nav.value = i,
        destinations: [
          for (final d in destinations) NavigationDestination(icon: d.$1, selectedIcon: d.$2, label: d.$3),
        ],
      ),
    );
  }
}
