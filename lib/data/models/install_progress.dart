enum InstallStatus {
  idle,
  resolvingRelease,
  downloading,
  extracting,
  verifying,
  completed,
  failed,
}

class InstallProgress {
  final InstallStatus status;
  final double progress; // 0.0 to 1.0
  final String message;
  final String? error;

  const InstallProgress({
    required this.status,
    required this.progress,
    required this.message,
    this.error,
  });

  factory InstallProgress.idle() => const InstallProgress(
        status: InstallStatus.idle,
        progress: 0.0,
        message: 'Ready',
      );

  factory InstallProgress.resolving(String repo) => InstallProgress(
        status: InstallStatus.resolvingRelease,
        progress: 0.1,
        message: 'Connecting to GitHub & fetching latest release for $repo...',
      );

  factory InstallProgress.downloading(double progress, String details) =>
      InstallProgress(
        status: InstallStatus.downloading,
        progress: 0.1 + (progress * 0.6), // 0.1 -> 0.7
        message: 'Downloading release asset: $details',
      );

  factory InstallProgress.extracting() => const InstallProgress(
        status: InstallStatus.extracting,
        progress: 0.75,
        message: 'Unzipping bundle to local sandboxed storage...',
      );

  factory InstallProgress.verifying() => const InstallProgress(
        status: InstallStatus.verifying,
        progress: 0.9,
        message: 'Verifying entrypoint and manifest...',
      );

  factory InstallProgress.completed(String appName) => InstallProgress(
        status: InstallStatus.completed,
        progress: 1.0,
        message: 'Successfully installed $appName!',
      );

  factory InstallProgress.failed(String error) => InstallProgress(
        status: InstallStatus.failed,
        progress: 0.0,
        message: 'Installation failed: $error',
        error: error,
      );
}

