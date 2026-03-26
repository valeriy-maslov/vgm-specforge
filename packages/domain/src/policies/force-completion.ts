export function isForceCompletionRequired(args: {
  unresolvedFailedGates: string[];
  explicitForceCommand: boolean;
}): boolean {
  return args.unresolvedFailedGates.length > 0 && !args.explicitForceCommand;
}

export interface ForceCompletionEvaluation {
  allowed: boolean;
  forceCommandRequired: boolean;
  blockedReason?: string;
}

export function evaluateForceCompletion(args: {
  unresolvedFailedGates: string[];
  explicitForceCommand: boolean;
}): ForceCompletionEvaluation {
  const forceCommandRequired = isForceCompletionRequired(args);
  if (!forceCommandRequired) {
    return {
      allowed: true,
      forceCommandRequired: false,
    };
  }
  return {
    allowed: false,
    forceCommandRequired: true,
    blockedReason: "force completion command is required to override unresolved failed gates",
  };
}
