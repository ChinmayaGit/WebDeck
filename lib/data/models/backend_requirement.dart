class BackendRequirement {
  final bool requiresPython;
  final String? pythonScript;
  final bool requiresNode;
  final String? nodeScript;
  final bool requiresDotnet;
  final String? dotnetProject;
  final bool requiresViteDev;
  final String? viteProjectDir;
  final int? viteDevPort;
  final bool hasDatabase;
  final bool usesSqlServer;
  final String? databasePath;
  final int? backendPort;
  final String? apiCheckUrl;
  final String? openApiUrl;
  final String? connectionString;
  final String? setupInstructions;

  const BackendRequirement({
    this.requiresPython = false,
    this.pythonScript,
    this.requiresNode = false,
    this.nodeScript,
    this.requiresDotnet = false,
    this.dotnetProject,
    this.requiresViteDev = false,
    this.viteProjectDir,
    this.viteDevPort,
    this.hasDatabase = false,
    this.usesSqlServer = false,
    this.databasePath,
    this.backendPort,
    this.apiCheckUrl,
    this.openApiUrl,
    this.connectionString,
    this.setupInstructions,
  });

  bool get hasRequirements =>
      requiresPython ||
      requiresNode ||
      requiresDotnet ||
      requiresViteDev ||
      hasDatabase ||
      usesSqlServer ||
      backendPort != null;

  /// Port used for the user-facing UI when Vite must run instead of static serve.
  int? get preferredLaunchPort => viteDevPort ?? backendPort;

  String get runtimeBadgeLabel {
    if (requiresDotnet) return '.NET';
    if (requiresViteDev) return 'Vite';
    if (requiresPython) return 'Python';
    if (requiresNode) return 'Node';
    if (usesSqlServer) return 'SQL';
    if (hasDatabase) return 'DB';
    return 'API';
  }

  Map<String, dynamic> toJson() => {
        'requiresPython': requiresPython,
        'pythonScript': pythonScript,
        'requiresNode': requiresNode,
        'nodeScript': nodeScript,
        'requiresDotnet': requiresDotnet,
        'dotnetProject': dotnetProject,
        'requiresViteDev': requiresViteDev,
        'viteProjectDir': viteProjectDir,
        'viteDevPort': viteDevPort,
        'hasDatabase': hasDatabase,
        'usesSqlServer': usesSqlServer,
        'databasePath': databasePath,
        'backendPort': backendPort,
        'apiCheckUrl': apiCheckUrl,
        'openApiUrl': openApiUrl,
        'connectionString': connectionString,
        'setupInstructions': setupInstructions,
      };

  factory BackendRequirement.fromJson(Map<String, dynamic> json) {
    return BackendRequirement(
      requiresPython: json['requiresPython'] as bool? ?? false,
      pythonScript: json['pythonScript'] as String?,
      requiresNode: json['requiresNode'] as bool? ?? false,
      nodeScript: json['nodeScript'] as String?,
      requiresDotnet: json['requiresDotnet'] as bool? ?? false,
      dotnetProject: json['dotnetProject'] as String?,
      requiresViteDev: json['requiresViteDev'] as bool? ?? false,
      viteProjectDir: json['viteProjectDir'] as String?,
      viteDevPort: (json['viteDevPort'] as num?)?.toInt(),
      hasDatabase: json['hasDatabase'] as bool? ?? false,
      usesSqlServer: json['usesSqlServer'] as bool? ?? false,
      databasePath: json['databasePath'] as String?,
      backendPort: (json['backendPort'] as num?)?.toInt(),
      apiCheckUrl: json['apiCheckUrl'] as String?,
      openApiUrl: json['openApiUrl'] as String?,
      connectionString: json['connectionString'] as String?,
      setupInstructions: json['setupInstructions'] as String?,
    );
  }
}

class ApiTestResult {
  final String url;
  final String method;
  final int? statusCode;
  final String bodyPreview;
  final bool ok;
  final String? error;

  const ApiTestResult({
    required this.url,
    required this.method,
    this.statusCode,
    required this.bodyPreview,
    required this.ok,
    this.error,
  });
}
