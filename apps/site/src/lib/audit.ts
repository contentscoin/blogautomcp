import { db } from "@/lib/db";

interface AuditInput {
  actorUserId?: string | null;
  actorType: "USER" | "ADMIN" | "DEVICE" | "MCP" | "SYSTEM";
  action: string;
  resourceType: string;
  resourceId?: string | null;
  result: "SUCCESS" | "DENIED" | "FAILED";
  requestId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      result: input.result,
      requestId: input.requestId ?? null,
      metadataJson: input.metadata ?? undefined,
    },
  });
}
