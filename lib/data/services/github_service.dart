import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../models/github_release.dart';

class RepoCoordinates {
  final String owner;
  final String repo;
  final String? directZipUrl;

  const RepoCoordinates({
    required this.owner,
    required this.repo,
    this.directZipUrl,
  });

  bool get isDirectZip => directZipUrl != null;

  @override
  String toString() => isDirectZip ? directZipUrl! : '$owner/$repo';
}

class GitHubService {
  final http.Client _client;

  GitHubService({http.Client? client}) : _client = client ?? http.Client();

  /// Parse user inputs like:
  /// - 'owner/repo'
  /// - 'https://github.com/owner/repo'
  /// - 'https://github.com/owner/repo/releases/latest'
  /// - Direct .zip download URLs
  RepoCoordinates parseInput(String input) {
    final trimmed = input.trim();

    if (trimmed.toLowerCase().endsWith('.zip')) {
      final uri = Uri.tryParse(trimmed);
      final filename = uri?.pathSegments.isNotEmpty == true
          ? uri!.pathSegments.last.replaceAll('.zip', '')
          : 'app';
      return RepoCoordinates(
        owner: 'direct',
        repo: filename,
        directZipUrl: trimmed,
      );
    }

    // Check for full GitHub URL
    final ghRegex = RegExp(r'github\.com[/:]([^/]+)/([^/#?]+)');
    final match = ghRegex.firstMatch(trimmed);
    if (match != null) {
      final owner = match.group(1)!;
      var repo = match.group(2)!;
      if (repo.endsWith('.git')) {
        repo = repo.substring(0, repo.length - 4);
      }
      return RepoCoordinates(owner: owner, repo: repo);
    }

    // Check for 'owner/repo' format
    final simpleRegex = RegExp(r'^([a-zA-Z0-9_\-\.]+)/([a-zA-Z0-9_\-\.]+)$');
    final simpleMatch = simpleRegex.firstMatch(trimmed);
    if (simpleMatch != null) {
      return RepoCoordinates(
        owner: simpleMatch.group(1)!,
        repo: simpleMatch.group(2)!,
      );
    }

    throw FormatException(
      'Invalid repository input: "$input". Expected "owner/repo" or "https://github.com/owner/repo" or direct .zip URL.',
    );
  }

  /// Query GitHub REST API for latest release
  Future<GitHubRelease> fetchLatestRelease(
    String owner,
    String repo, {
    String? token,
  }) async {
    final url = Uri.parse('https://api.github.com/repos/$owner/$repo/releases/latest');
    final headers = <String, String>{
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'WebDeck-Launcher',
    };
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }

    final response = await _client.get(url, headers: headers);

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      return GitHubRelease.fromJson(data);
    } else if (response.statusCode == 404) {
      // Fallback: If no releases exist, fetch default branch source archive
      final repoUrl = Uri.parse('https://api.github.com/repos/$owner/$repo');
      final repoResponse = await _client.get(repoUrl, headers: headers);
      if (repoResponse.statusCode == 200) {
        final repoData = jsonDecode(repoResponse.body) as Map<String, dynamic>;
        final defaultBranch = repoData['default_branch'] as String? ?? 'main';
        final description = repoData['description'] as String? ?? '';
        return GitHubRelease(
          id: 0,
          tagName: defaultBranch,
          name: repoData['name'] as String? ?? repo,
          body: description,
          publishedAt: DateTime.now(),
          assets: [
            GitHubAsset(
              id: 0,
              name: '$repo-$defaultBranch.zip',
              browserDownloadUrl:
                  'https://github.com/$owner/$repo/archive/refs/heads/$defaultBranch.zip',
              size: 0,
              contentType: 'application/zip',
            ),
          ],
        );
      }
      throw Exception(
        'Repository $owner/$repo not found on GitHub.',
      );
    } else if (response.statusCode == 403) {
      throw Exception(
        'GitHub API rate limit exceeded or access denied. You can provide a GitHub Personal Access Token in settings.',
      );
    } else {
      throw Exception(
        'Failed to fetch release for $owner/$repo (Status: ${response.statusCode}): ${response.reasonPhrase}',
      );
    }
  }

  /// Download asset with byte streaming for progress updates
  Future<Uint8List> downloadAsset(
    String downloadUrl, {
    String? token,
    required void Function(int receivedBytes, int totalBytes) onProgress,
  }) async {
    final request = http.Request('GET', Uri.parse(downloadUrl));
    request.headers['User-Agent'] = 'WebDeck-Launcher';
    request.headers['Accept'] = 'application/octet-stream';
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }

    final response = await _client.send(request);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        'Download failed with status ${response.statusCode}: ${response.reasonPhrase}',
      );
    }

    final totalBytes = response.contentLength ?? 0;
    var receivedBytes = 0;
    final bytesList = <int>[];

    await for (final chunk in response.stream) {
      bytesList.addAll(chunk);
      receivedBytes += chunk.length;
      onProgress(receivedBytes, totalBytes);
    }

    return Uint8List.fromList(bytesList);
  }
}

