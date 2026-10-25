class GitHubAsset {
  final int id;
  final String name;
  final String browserDownloadUrl;
  final int size;
  final String contentType;

  const GitHubAsset({
    required this.id,
    required this.name,
    required this.browserDownloadUrl,
    required this.size,
    required this.contentType,
  });

  factory GitHubAsset.fromJson(Map<String, dynamic> json) {
    return GitHubAsset(
      id: (json['id'] as num?)?.toInt() ?? 0,
      name: json['name'] as String? ?? '',
      browserDownloadUrl: json['browser_download_url'] as String? ?? '',
      size: (json['size'] as num?)?.toInt() ?? 0,
      contentType: json['content_type'] as String? ?? '',
    );
  }

  bool get isZip =>
      name.toLowerCase().endsWith('.zip') ||
      contentType == 'application/zip' ||
      contentType == 'application/x-zip-compressed';
}

class GitHubRelease {
  final int id;
  final String tagName;
  final String name;
  final String body;
  final DateTime? publishedAt;
  final List<GitHubAsset> assets;

  const GitHubRelease({
    required this.id,
    required this.tagName,
    required this.name,
    required this.body,
    this.publishedAt,
    required this.assets,
  });

  factory GitHubRelease.fromJson(Map<String, dynamic> json) {
    final rawAssets = json['assets'] as List<dynamic>? ?? [];
    return GitHubRelease(
      id: (json['id'] as num?)?.toInt() ?? 0,
      tagName: json['tag_name'] as String? ?? 'v1.0.0',
      name: json['name'] as String? ?? (json['tag_name'] as String? ?? 'Release'),
      body: json['body'] as String? ?? '',
      publishedAt: json['published_at'] != null
          ? DateTime.tryParse(json['published_at'] as String)
          : null,
      assets: rawAssets
          .map((a) => GitHubAsset.fromJson(a as Map<String, dynamic>))
          .toList(),
    );
  }

  GitHubAsset? get preferredZipAsset {
    if (assets.isEmpty) return null;
    final zips = assets.where((a) => a.isZip).toList();
    if (zips.isEmpty) return null;

    // Prioritize web, dist, build, release, app zips
    final priorityNames = ['dist.zip', 'web.zip', 'build.zip', 'release.zip', 'app.zip'];
    for (final pattern in priorityNames) {
      final match = zips.where((a) => a.name.toLowerCase() == pattern);
      if (match.isNotEmpty) return match.first;
    }

    for (final pattern in ['dist', 'web', 'build', 'html']) {
      final match = zips.where((a) => a.name.toLowerCase().contains(pattern));
      if (match.isNotEmpty) return match.first;
    }

    return zips.first;
  }
}

