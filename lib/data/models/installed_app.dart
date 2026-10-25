import 'backend_requirement.dart';

class InstalledApp {
  final String id;
  final String name;
  final String description;
  final String version;
  final String repoUrl;
  final String? iconUrl;
  final String? localIconPath;
  final String installedPath;
  final String webRootRelative;
  final String entryHtml;
  final String framework;
  final BackendRequirement? backendRequirement;
  final DateTime installedAt;
  final int sizeBytes;

  const InstalledApp({
    required this.id,
    required this.name,
    required this.description,
    required this.version,
    required this.repoUrl,
    this.iconUrl,
    this.localIconPath,
    required this.installedPath,
    this.webRootRelative = '.',
    required this.entryHtml,
    this.framework = 'Web App',
    this.backendRequirement,
    required this.installedAt,
    required this.sizeBytes,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'description': description,
        'version': version,
        'repoUrl': repoUrl,
        'iconUrl': iconUrl,
        'localIconPath': localIconPath,
        'installedPath': installedPath,
        'webRootRelative': webRootRelative,
        'entryHtml': entryHtml,
        'framework': framework,
        'backendRequirement': backendRequirement?.toJson(),
        'installedAt': installedAt.toIso8601String(),
        'sizeBytes': sizeBytes,
      };

  factory InstalledApp.fromJson(Map<String, dynamic> json) {
    return InstalledApp(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String? ?? '',
      version: json['version'] as String? ?? '1.0.0',
      repoUrl: json['repoUrl'] as String? ?? '',
      iconUrl: json['iconUrl'] as String?,
      localIconPath: json['localIconPath'] as String?,
      installedPath: json['installedPath'] as String,
      webRootRelative: json['webRootRelative'] as String? ?? '.',
      entryHtml: json['entryHtml'] as String? ?? 'index.html',
      framework: json['framework'] as String? ?? 'Web App',
      backendRequirement: json['backendRequirement'] != null
          ? BackendRequirement.fromJson(
              json['backendRequirement'] as Map<String, dynamic>,
            )
          : null,
      installedAt: json['installedAt'] != null
          ? DateTime.parse(json['installedAt'] as String)
          : DateTime.now(),
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    );
  }

  InstalledApp copyWith({
    String? id,
    String? name,
    String? description,
    String? version,
    String? repoUrl,
    String? iconUrl,
    String? localIconPath,
    String? installedPath,
    String? webRootRelative,
    String? entryHtml,
    String? framework,
    BackendRequirement? backendRequirement,
    DateTime? installedAt,
    int? sizeBytes,
  }) {
    return InstalledApp(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      version: version ?? this.version,
      repoUrl: repoUrl ?? this.repoUrl,
      iconUrl: iconUrl ?? this.iconUrl,
      localIconPath: localIconPath ?? this.localIconPath,
      installedPath: installedPath ?? this.installedPath,
      webRootRelative: webRootRelative ?? this.webRootRelative,
      entryHtml: entryHtml ?? this.entryHtml,
      framework: framework ?? this.framework,
      backendRequirement: backendRequirement ?? this.backendRequirement,
      installedAt: installedAt ?? this.installedAt,
      sizeBytes: sizeBytes ?? this.sizeBytes,
    );
  }
}
