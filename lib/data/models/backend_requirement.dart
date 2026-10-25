class BackendRequirement {
  final bool requiresPython;
  final String? pythonScript;
  final bool requiresNode;
  final String? nodeScript;
  final bool hasDatabase;
  final String? databasePath;
  final int? backendPort;
  final String? setupInstructions;

  const BackendRequirement({
    this.requiresPython = false,
    this.pythonScript,
    this.requiresNode = false,
    this.nodeScript,
    this.hasDatabase = false,
    this.databasePath,
    this.backendPort,
    this.setupInstructions,
  });

  bool get hasRequirements => requiresPython || requiresNode || hasDatabase || backendPort != null;

  Map<String, dynamic> toJson() => {
        'requiresPython': requiresPython,
        'pythonScript': pythonScript,
        'requiresNode': requiresNode,
        'nodeScript': nodeScript,
        'hasDatabase': hasDatabase,
        'databasePath': databasePath,
        'backendPort': backendPort,
        'setupInstructions': setupInstructions,
      };

  factory BackendRequirement.fromJson(Map<String, dynamic> json) {
    return BackendRequirement(
      requiresPython: json['requiresPython'] as bool? ?? false,
      pythonScript: json['pythonScript'] as String?,
      requiresNode: json['requiresNode'] as bool? ?? false,
      nodeScript: json['nodeScript'] as String?,
      hasDatabase: json['hasDatabase'] as bool? ?? false,
      databasePath: json['databasePath'] as String?,
      backendPort: (json['backendPort'] as num?)?.toInt(),
      setupInstructions: json['setupInstructions'] as String?,
    );
  }
}

