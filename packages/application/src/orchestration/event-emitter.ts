import { randomUUID } from "node:crypto";
import type { AuditDriver, AuditEvent } from "@specforge/contracts";
import { maskSensitiveData, maskSensitiveString } from "./secret-masking.js";

export async function appendEvents(auditDriver: AuditDriver, events: readonly AuditEvent[]): Promise<void> {
  for (const event of events) {
    await auditDriver.append(sanitizeAuditEvent(event));
  }
}

export function withEventIds(
  events: ReadonlyArray<Omit<AuditEvent, "id">>,
  createEventId: () => string = () => randomUUID(),
): AuditEvent[] {
  return events.map((event) => ({
    ...event,
    id: createEventId(),
  }));
}

function sanitizeAuditEvent(event: AuditEvent): AuditEvent {
  const actor = event.actor.id === undefined
    ? event.actor
    : {
        ...event.actor,
        id: maskSensitiveString(event.actor.id),
      };

  return {
    ...event,
    actor,
    payload: maskSensitiveData(event.payload),
  };
}
