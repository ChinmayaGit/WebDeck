import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:xml/xml.dart';

/// One live feed entry (article or video).
class LiveFeedItem {
  final String id;
  final String title;
  final String category;
  final String source;
  final String summary;
  final String url;
  final String? imageUrl;
  final bool isVideo;
  final DateTime published;
  final int readMinutes;

  const LiveFeedItem({
    required this.id,
    required this.title,
    required this.category,
    required this.source,
    required this.summary,
    required this.url,
    this.imageUrl,
    this.isVideo = false,
    required this.published,
    this.readMinutes = 0,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'category': category,
        'source': source,
        'summary': summary,
        'url': url,
        'imageUrl': imageUrl,
        'isVideo': isVideo,
        'published': published.toIso8601String(),
        'readMinutes': readMinutes,
      };

  factory LiveFeedItem.fromJson(Map<String, dynamic> j) => LiveFeedItem(
        id: j['id'] as String,
        title: j['title'] as String,
        category: j['category'] as String,
        source: j['source'] as String,
        summary: j['summary'] as String? ?? '',
        url: j['url'] as String,
        imageUrl: j['imageUrl'] as String?,
        isVideo: j['isVideo'] as bool? ?? false,
        published: DateTime.tryParse(j['published'] as String? ?? '') ?? DateTime.now(),
        readMinutes: (j['readMinutes'] as num?)?.toInt() ?? 0,
      );
}

/// Pulls fresh articles and videos from free, keyless sources and caches them
/// so the screen opens instantly and works offline.
class FeedService {
  final Future<Directory> Function() _baseDir;
  final http.Client _http;

  FeedService(this._baseDir, {http.Client? client}) : _http = client ?? http.Client();

  /// dev.to tags per category.
  static const _devTo = {
    'AI & Research': ['ai', 'machinelearning'],
    'Tech & Dev': ['programming', 'opensource'],
    'Web & Frontend': ['webdev', 'javascript'],
    'Backend & Systems': ['backend', 'devops'],
    'Databases': ['database', 'postgres'],
    'Mobile & Android': ['android', 'flutter'],
    'CS Concepts': ['computerscience', 'algorithms'],
  };

  /// YouTube channels (public RSS, no key).
  static const _youtube = {
    'UCsBjURrPoezykLs9EqgamOA': 'Fireship',
    'UCLA_DiR1FfKNvjuUpBHmylQ': 'NASA',
    'UC9-y-6csu5WGm29I7JiwpnA': 'Computerphile',
    'UCbfYPyITQ-7l4upoX8nvctg': 'Two Minute Papers',
  };

  Future<File> _cacheFile() async => File(p.join((await _baseDir()).path, 'feeds_cache.json'));

  Future<List<LiveFeedItem>> cached() async {
    try {
      final f = await _cacheFile();
      if (!await f.exists()) return const [];
      final list = jsonDecode(await f.readAsString()) as List;
      return list.map((e) => LiveFeedItem.fromJson((e as Map).cast<String, dynamic>())).toList();
    } catch (_) {
      return const [];
    }
  }

  /// Fetches every source in parallel; failed sources are skipped.
  Future<List<LiveFeedItem>> refresh() async {
    final jobs = <Future<List<LiveFeedItem>>>[
      for (final e in _devTo.entries)
        for (final tag in e.value) _safe(() => _fetchDevTo(tag, e.key)),
      _safe(_fetchSpace),
      for (final e in _youtube.entries) _safe(() => _fetchYouTube(e.key, e.value)),
    ];
    final results = await Future.wait(jobs);
    final seen = <String>{};
    final items = [
      for (final list in results)
        for (final item in list)
          if (seen.add(item.url)) item,
    ]..sort((a, b) => b.published.compareTo(a.published));
    if (items.isEmpty) throw const SocketException('No feed could be reached');
    try {
      await (await _cacheFile()).writeAsString(jsonEncode(items.take(400).map((e) => e.toJson()).toList()));
    } catch (_) {}
    return items;
  }

  Future<List<LiveFeedItem>> _safe(Future<List<LiveFeedItem>> Function() f) async {
    try {
      return await f().timeout(const Duration(seconds: 12));
    } catch (_) {
      return const [];
    }
  }

  Future<String> _get(String url) async {
    final res = await _http.get(Uri.parse(url), headers: {'User-Agent': 'WebDeck-Feeds/1.0'});
    if (res.statusCode != 200) throw HttpException('HTTP ${res.statusCode}');
    return utf8.decode(res.bodyBytes);
  }

  Future<List<LiveFeedItem>> _fetchDevTo(String tag, String category) async {
    final list = jsonDecode(await _get('https://dev.to/api/articles?tag=$tag&per_page=12&top=7')) as List;
    return [
      for (final a in list.cast<Map<String, dynamic>>())
        LiveFeedItem(
          id: 'devto-${a['id']}',
          title: a['title'] as String? ?? '',
          category: category,
          source: 'DEV · ${(a['user'] as Map?)?['name'] ?? 'dev.to'}',
          summary: a['description'] as String? ?? '',
          url: a['url'] as String,
          imageUrl: (a['cover_image'] ?? a['social_image']) as String?,
          published: DateTime.tryParse(a['published_at'] as String? ?? '') ?? DateTime.now(),
          readMinutes: (a['reading_time_minutes'] as num?)?.toInt() ?? 0,
        ),
    ];
  }

  Future<List<LiveFeedItem>> _fetchSpace() async {
    final data = jsonDecode(await _get('https://api.spaceflightnewsapi.net/v4/articles/?limit=20')) as Map;
    return [
      for (final a in (data['results'] as List).cast<Map<String, dynamic>>())
        LiveFeedItem(
          id: 'space-${a['id']}',
          title: a['title'] as String? ?? '',
          category: 'Space & Science',
          source: a['news_site'] as String? ?? 'Spaceflight News',
          summary: a['summary'] as String? ?? '',
          url: a['url'] as String,
          imageUrl: a['image_url'] as String?,
          published: DateTime.tryParse(a['published_at'] as String? ?? '') ?? DateTime.now(),
        ),
    ];
  }

  Future<List<LiveFeedItem>> _fetchYouTube(String channelId, String name) async {
    final doc = XmlDocument.parse(await _get('https://www.youtube.com/feeds/videos.xml?channel_id=$channelId'));
    return [
      for (final e in doc.findAllElements('entry').take(8))
        LiveFeedItem(
          id: 'yt-${e.getElement('yt:videoId')?.innerText ?? e.getElement('id')?.innerText}',
          title: e.getElement('title')?.innerText ?? '',
          category: 'Videos',
          source: name,
          summary: (e.findAllElements('media:description').firstOrNull?.innerText ?? '').split('\n').first,
          url: e.getElement('link')?.getAttribute('href') ?? '',
          imageUrl: e.findAllElements('media:thumbnail').firstOrNull?.getAttribute('url'),
          isVideo: true,
          published: DateTime.tryParse(e.getElement('published')?.innerText ?? '') ?? DateTime.now(),
        ),
    ];
  }
}
