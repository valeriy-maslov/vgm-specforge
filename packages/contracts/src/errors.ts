export const SPECFORGE_ERROR_CODES = [
  "INITIALIZATION_REQUIRED",
  "INVALID_WORK_TYPE",
  "INVALID_WORKFLOW_STATE",
  "INVALID_TRANSITION",
  "HARD_GATE_APPROVAL_REQUIRED",
  "WORKFLOW_ALREADY_ACTIVE",
  "WORKFLOW_TERMINAL",
  "FORCE_COMPLETION_REQUIRED",
  "SYNC_PREVIEW_APPROVAL_REQUIRED",
  "RETENTION_POLICY_VIOLATION",
  "RULE_RESOLUTION_ERROR",
  "AUDIT_DRIVER_ERROR",
  "DOC_STORE_ERROR",
  "GIT_ADAPTER_ERROR",
  "SYSTEM_ASSET_ERROR",
  "CONFIG_ERROR",
  "CONFLICT_RESOLUTION_APPROVAL_REQUIRED",
  "DRIFT_CONFLICT_REQUIRES_RESOLUTION",
  "DRIFT_INTEGRATION_FAILED",
  "DRIFT_CONFIRMATION_REQUIRED",
] as const;

export type SpecforgeErrorCode = (typeof SPECFORGE_ERROR_CODES)[number];

export interface SpecforgeErrorShape {
  code: SpecforgeErrorCode;
  message: string;
  details?: unknown;
}

export class SpecforgeError extends Error implements SpecforgeErrorShape {
  readonly code: SpecforgeErrorCode;

  readonly details?: unknown;

  constructor(code: SpecforgeErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "SpecforgeError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
