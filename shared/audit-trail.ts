export type AuditEventType =
  | "RECOMMENDATION_ISSUED"
  | "OPERATOR_CONFIRMED"
  | "OPERATOR_OVERRIDDEN"
  | "SYSTEM_SELF_CORRECTED"
  | "RESOURCE_DEPLOYED"
  | "RESOURCE_RECALLED";

export type AuditEntry = {
  timestamp: string;
  sessionId: string;
  zoneId: string;
  eventType: AuditEventType;
  systemRecommendation: string;
  systemConfidence: number;
  systemReasoning: string;
  operatorAction?: "CONFIRMED" | "OVERRIDDEN" | "DEFERRED";
  operatorReason?: string;
  operatorId: string;
};

export function buildAuditEntry(input: Omit<AuditEntry, "timestamp">): AuditEntry {
  return {
    ...input,
    timestamp: new Date().toISOString()
  };
}
