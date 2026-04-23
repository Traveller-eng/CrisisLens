export type AuditEventType =
  | "RECOMMENDATION_ISSUED"
  | "OPERATOR_CONFIRMED"
  | "OPERATOR_OVERRIDDEN"
  | "SYSTEM_SELF_CORRECTED"
  | "RESOURCE_DEPLOYED"
  | "RESOURCE_RECALLED";

export type OperatorAction = "CONFIRMED" | "OVERRIDDEN" | "DEFERRED";

const validOperatorActions = new Set<OperatorAction>(["CONFIRMED", "OVERRIDDEN", "DEFERRED"]);

export type AuditEntry = {
  timestamp: string;
  sessionId: string;
  zoneId: string;
  eventType: AuditEventType;
  systemRecommendation: string;
  systemConfidence: number;
  systemReasoning: string;
  operatorAction?: OperatorAction;
  operatorReason?: string;
  operatorId: string;
};

export function buildSessionId(): string {
  const now = new Date();
  return `session-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

export function validateOperatorAction(
  action: string,
  reason: string | undefined
): { valid: boolean; error?: string } {
  if (!validOperatorActions.has(action as OperatorAction)) {
    return { valid: false, error: `Invalid operator action: ${action}. Must be CONFIRMED, OVERRIDDEN, or DEFERRED.` };
  }

  if (action === "OVERRIDDEN" && (!reason || !reason.trim())) {
    return { valid: false, error: "Override reason is required and cannot be empty." };
  }

  return { valid: true };
}

export function buildAuditEntry(input: Omit<AuditEntry, "timestamp">): AuditEntry {
  return {
    ...input,
    timestamp: new Date().toISOString()
  };
}
