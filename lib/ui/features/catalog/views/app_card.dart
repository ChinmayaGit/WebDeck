import 'dart:io';
import 'package:flutter/material.dart';
import '../../../../data/models/installed_app.dart';
import '../../../core/theme.dart';

class AppCard extends StatelessWidget {
  final InstalledApp app;
  final bool isRunning;
  final int? runningPort;
  final VoidCallback onLaunch;
  final VoidCallback onStop;
  final VoidCallback onUninstall;
  final VoidCallback onOpenBrowser;
  final VoidCallback onUpdateIcon;
  final VoidCallback onCheckUpdate;

  const AppCard({
    super.key,
    required this.app,
    required this.isRunning,
    this.runningPort,
    required this.onLaunch,
    required this.onStop,
    required this.onUninstall,
    required this.onOpenBrowser,
    required this.onUpdateIcon,
    required this.onCheckUpdate,
  });

  String get _formattedSize {
    if (app.sizeBytes < 1024 * 1024) {
      return '${(app.sizeBytes / 1024).toStringAsFixed(1)} KB';
    }
    return '${(app.sizeBytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  Color _getFrameworkColor(String framework) {
    final lower = framework.toLowerCase();
    if (lower.contains('flutter')) return const Color(0xFF02569B);
    if (lower.contains('react')) return const Color(0xFF61DAFB);
    if (lower.contains('angular')) return const Color(0xFFDD0031);
    if (lower.contains('vue')) return const Color(0xFF42B883);
    if (lower.contains('svelte')) return const Color(0xFFFF3E00);
    if (lower.contains('next')) return Colors.white;
    return WebDeckTheme.primary;
  }

  @override
  Widget build(BuildContext context) {
    final hasLocalIcon =
        app.localIconPath != null && File(app.localIconPath!).existsSync();
    final frameworkColor = _getFrameworkColor(app.framework);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onLaunch,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row: Icon + App Name + Overflow menu
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Tooltip(
                    message: 'Click three-dot menu to update icon',
                    child: Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        gradient: LinearGradient(
                          colors: [
                            frameworkColor.withValues(alpha: 0.8),
                            const Color(0xFF8957E5),
                          ],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        border: Border.all(color: WebDeckTheme.border),
                      ),
                      child: hasLocalIcon
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(12),
                              child: Image.file(
                                File(app.localIconPath!),
                                fit: BoxFit.cover,
                                errorBuilder: (context, error, stackTrace) =>
                                    _fallbackLetter(),
                              ),
                            )
                          : _fallbackLetter(),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          app.name,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: WebDeckTheme.textPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            // Framework badge
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: frameworkColor.withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(
                                  color: frameworkColor.withValues(alpha: 0.3),
                                ),
                              ),
                              child: Text(
                                app.framework,
                                style: TextStyle(
                                  fontSize: 10,
                                  color: frameworkColor,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            // Version badge
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: WebDeckTheme.surfaceSubtle,
                                borderRadius: BorderRadius.circular(4),
                                border: Border.all(color: WebDeckTheme.border),
                              ),
                              child: Text(
                                app.version,
                                style: const TextStyle(
                                  fontSize: 10,
                                  color: WebDeckTheme.textSecondary,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            if (isRunning) ...[
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: WebDeckTheme.accentGreen.withValues(alpha: 0.2),
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(
                                    color: WebDeckTheme.accentGreen.withValues(alpha: 0.4),
                                  ),
                                ),
                                child: Text(
                                  ':$runningPort',
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: WebDeckTheme.accentGreen,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                            if (app.backendRequirement?.hasRequirements == true) ...[
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 6,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFD29922).withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(
                                    color: const Color(0xFFD29922).withValues(alpha: 0.35),
                                  ),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      app.backendRequirement!.requiresPython
                                          ? Icons.terminal
                                          : Icons.storage,
                                      size: 10,
                                      color: const Color(0xFFD29922),
                                    ),
                                    const SizedBox(width: 3),
                                    Text(
                                      app.backendRequirement!.requiresPython ? 'Python' : 'DB',
                                      style: const TextStyle(
                                        fontSize: 9,
                                        color: Color(0xFFD29922),
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  PopupMenuButton<String>(
                    icon: const Icon(
                      Icons.more_vert,
                      size: 20,
                      color: WebDeckTheme.textSecondary,
                    ),
                    color: WebDeckTheme.surface,
                    onSelected: (value) {
                      switch (value) {
                        case 'update_icon':
                          onUpdateIcon();
                          break;
                        case 'check_update':
                          onCheckUpdate();
                          break;
                        case 'browser':
                          onOpenBrowser();
                          break;
                        case 'stop':
                          onStop();
                          break;
                        case 'uninstall':
                          onUninstall();
                          break;
                      }
                    },
                    itemBuilder: (context) => [
                      const PopupMenuItem(
                        value: 'update_icon',
                        child: Row(
                          children: [
                            Icon(Icons.image, size: 18),
                            SizedBox(width: 8),
                            Text('Update App Icon'),
                          ],
                        ),
                      ),
                      const PopupMenuItem(
                        value: 'check_update',
                        child: Row(
                          children: [
                            Icon(Icons.system_update, size: 18),
                            SizedBox(width: 8),
                            Text('Check for Updates'),
                          ],
                        ),
                      ),
                      const PopupMenuDivider(),
                      const PopupMenuItem(
                        value: 'browser',
                        child: Row(
                          children: [
                            Icon(Icons.open_in_browser, size: 18),
                            SizedBox(width: 8),
                            Text('Open in Browser'),
                          ],
                        ),
                      ),
                      if (isRunning)
                        const PopupMenuItem(
                          value: 'stop',
                          child: Row(
                            children: [
                              Icon(Icons.stop, size: 18, color: WebDeckTheme.accentRed),
                              SizedBox(width: 8),
                              Text('Stop Server'),
                            ],
                          ),
                        ),
                      const PopupMenuItem(
                        value: 'uninstall',
                        child: Row(
                          children: [
                            Icon(Icons.delete_outline, size: 18, color: WebDeckTheme.accentRed),
                            SizedBox(width: 8),
                            Text('Uninstall App', style: TextStyle(color: WebDeckTheme.accentRed)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 10),
              // Description
              Expanded(
                child: Text(
                  app.description.isNotEmpty
                      ? app.description
                      : 'No description provided.',
                  style: const TextStyle(
                    fontSize: 13,
                    color: WebDeckTheme.textSecondary,
                    height: 1.4,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(height: 10),
              // Footer: Size + Action Buttons
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _formattedSize,
                    style: const TextStyle(
                      fontSize: 11,
                      color: WebDeckTheme.textSecondary,
                    ),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Stop button (when running)
                      if (isRunning) ...[
                        OutlinedButton(
                          onPressed: onStop,
                          style: OutlinedButton.styleFrom(
                            foregroundColor: WebDeckTheme.accentRed,
                            side: BorderSide(
                              color: WebDeckTheme.accentRed.withValues(alpha: 0.6),
                            ),
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            visualDensity: VisualDensity.compact,
                          ),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.stop_rounded, size: 15),
                              SizedBox(width: 4),
                              Text('Stop', style: TextStyle(fontSize: 12)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],

                      // Open in Browser action button
                      OutlinedButton(
                        onPressed: onOpenBrowser,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: WebDeckTheme.textPrimary,
                          side: const BorderSide(color: WebDeckTheme.border),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          visualDensity: VisualDensity.compact,
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.open_in_browser, size: 15),
                            SizedBox(width: 4),
                            Text('Browser', style: TextStyle(fontSize: 12)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 6),

                      // In-app Launch action button
                      ElevatedButton(
                        onPressed: onLaunch,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: isRunning
                              ? WebDeckTheme.accentGreen
                              : WebDeckTheme.primary,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          visualDensity: VisualDensity.compact,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(isRunning ? Icons.play_arrow : Icons.rocket_launch, size: 15),
                            const SizedBox(width: 4),
                            Text(isRunning ? 'Play' : 'Launch', style: const TextStyle(fontSize: 12)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _fallbackLetter() {
    return Center(
      child: Text(
        app.name.isNotEmpty ? app.name[0].toUpperCase() : 'W',
        style: const TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w800,
          color: Colors.white,
        ),
      ),
    );
  }
}
