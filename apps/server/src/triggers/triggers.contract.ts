import { z } from "zod";
import { timestampSchema } from "../api/common-schemas.js";
import { TRIGGER_OUTCOMES } from "./trigger-state.js";

export const triggerParams = z.object({
  id: z.uuid(),
  triggerId: z.string().min(1).max(200),
});

export const setEnabledBody = z.object({ enabled: z.boolean() });

export const triggerStateSchema = z
  .object({
    triggerId: z.string(),
    enabled: z.boolean(),
    /**
     * The webhook's route on the hooks port (`/hooks/{id}`, opaque: it does not show the graph or the
     * trigger). Null until the first secret is generated.
     */
    hookPath: z.string().nullable(),
    /** The port of the hooks listener on this machine; null while it is off (`NEURONS_HOOKS_PORT`). */
    hooksPort: z.number().int().nullable(),
    /** Whether the webhook has a secret. The secret itself is shown once, when generated. */
    hasSecret: z.boolean(),
    secretSetAt: timestampSchema.nullable(),
    /** The last time the trigger was hit, started a run or not. */
    lastRun: z
      .object({
        at: timestampSchema,
        outcome: z.enum(TRIGGER_OUTCOMES),
        /** Why a moment was skipped or a start failed. */
        note: z.string().nullable(),
        /** The last run this trigger started. */
        runId: z.uuid().nullable(),
      })
      .nullable(),
    /** When a schedule fires next; null for a webhook or a trigger that is off. */
    nextRunAt: timestampSchema.nullable(),
  })
  .meta({ id: "TriggerState" });

export const triggerSecretSchema = z
  .object({
    /** Shown only now. Keep it: afterwards the server only says that one exists. */
    secret: z.string(),
    state: triggerStateSchema,
  })
  .meta({ id: "TriggerSecret" });

export type TriggerParams = z.infer<typeof triggerParams>;
export type SetEnabledBody = z.infer<typeof setEnabledBody>;
