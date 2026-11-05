import { z } from "zod";
import { idParamsSchema, limitQuery, timestampSchema } from "../api/common-schemas.js";
import { MESSAGE_KINDS, RUN_STATUSES } from "../database/schema/index.js";
import { RUN_SORTS } from "../run-log/run-repository.js";

const MAX_TEXT_CHARS = 100_000;

export const usageTotalsSchema = z
  .object({
    /** Sum of the turns whose cost is known. */
    costUsd: z.number(),
    turns: z.number().int(),
    /** Turns that reported no cost; they are not in `costUsd`, which is then a lower bound. */
    unknownCostTurns: z.number().int(),
  })
  .meta({ id: "UsageTotals" });

const summaryFields = {
  id: z.uuid(),
  graphId: z.uuid(),
  graphVersionId: z.uuid(),
  status: z.enum(RUN_STATUSES),
  /** Spending limit of the run; null means none. */
  budgetUsd: z.number().nullable(),
  startedAt: timestampSchema.nullable(),
  finishedAt: timestampSchema.nullable(),
};

export const runSummarySchema = z.object(summaryFields).meta({ id: "RunSummary" });

/** Why a run ended; `guard` and `message` are there when a guard stopped it. */
export const runFinishSchema = z
  .object({
    reason: z.enum(["finished", "quiescent", "stopped", "failed", "guard_tripped"]),
    at: timestampSchema,
    agent: z.string().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
    guard: z.string().optional(),
    message: z.string().optional(),
  })
  .meta({ id: "RunFinish" });

export const runDetailSchema = z
  .object({
    ...summaryFields,
    /** What the trigger sent to start the run. */
    input: z.string(),
    finish: runFinishSchema.nullable(),
    usage: z.object({
      total: usageTotalsSchema,
      byAgent: z.record(z.string(), usageTotalsSchema),
    }),
  })
  .meta({ id: "RunDetail" });

export const messageSchema = z
  .object({
    id: z.uuid(),
    seq: z.number().int(),
    from: z.string(),
    to: z.string(),
    kind: z.enum(MESSAGE_KINDS),
    replyTo: z.uuid().nullable(),
    body: z.string(),
    createdAt: timestampSchema,
    deliveredAt: timestampSchema.nullable(),
    ackedAt: timestampSchema.nullable(),
  })
  .meta({ id: "Message" });

export const runEventSchema = z
  .object({
    runId: z.uuid(),
    seq: z.number().int(),
    type: z.string(),
    agent: z.string().nullable(),
    payload: z.unknown(),
    at: timestampSchema,
  })
  .meta({ id: "RunEvent" });

/** A row of `GET /runs`: the summary plus what the table shows. */
export const runListItemSchema = z
  .object({
    ...summaryFields,
    graphName: z.string(),
    /** The number of the version (`graphVersionId` is its id). */
    graphVersion: z.number().int(),
    /** `finishedAt - startedAt` in milliseconds; null while the run has not finished. */
    durationMs: z.number().int().nullable(),
    /** Sum of the turns whose cost is known; a lower bound when `unknownCostTurns` > 0, never a guess. */
    costUsd: z.number(),
    turns: z.number().int(),
    /** Turns that reported no cost; they are not in `costUsd`. */
    unknownCostTurns: z.number().int(),
  })
  .meta({ id: "RunListItem" });

export const runListSchema = z.object({
  items: z.array(runListItemSchema),
  /** How many runs match the filters, ignoring `limit` and `offset`. */
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export const messageListSchema = z.object({ items: z.array(messageSchema) });
export const runEventListSchema = z.object({
  items: z.array(runEventSchema),
  /** How many events the run has in all, whatever `fromSeq` and `limit` ask for. */
  total: z.number().int(),
});

export const runParams = idParamsSchema;

export const listRunsQuery = z
  .object({
    status: z.enum(RUN_STATUSES).optional(),
    graphId: z.uuid().optional(),
    /** One published version (see `GET /graphs/{id}/versions`). */
    graphVersionId: z.uuid().optional(),
    /** Bounds (inclusive) on the known cost. A run with unknown-cost turns is compared by its known part. */
    minCostUsd: z.coerce.number().min(0).optional(),
    maxCostUsd: z.coerce.number().min(0).optional(),
    /** Bounds (inclusive) on when the run started. */
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
    sort: z.enum(RUN_SORTS).default("startedAt"),
    /** Defaults to `desc`: newest, or dearest, first. */
    order: z.enum(["asc", "desc"]).default("desc"),
    limit: limitQuery(50, 200),
    /** How many runs to skip, for paging. */
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (q) => q.minCostUsd === undefined || q.maxCostUsd === undefined || q.minCostUsd <= q.maxCostUsd,
    {
      message: "minCostUsd não pode passar de maxCostUsd.",
      path: ["minCostUsd"],
    },
  )
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.from) <= Date.parse(q.to),
    {
      message: "from não pode ser depois de to.",
      path: ["from"],
    },
  );

export const startRunBody = z.object({
  /** The published version to run (see `POST /graphs/{id}/versions`). */
  graphVersionId: z.uuid(),
  /** The first message, sent by the trigger to its target agent. */
  input: z.string().min(1).max(MAX_TEXT_CHARS),
  /** Which trigger to use; needed only when the graph has more than one. */
  triggerId: z.string().min(1).optional(),
  /** Spending limit of this run, in US$; the server's default applies when absent. */
  budgetUsd: z.number().positive().optional(),
});

export const sendMessageBody = z.object({
  /** The name of the agent that receives it. */
  to: z.string().min(1).max(100),
  body: z.string().min(1).max(MAX_TEXT_CHARS),
});

export const messagesQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  limit: limitQuery(200, 1000),
});

export const eventsQuery = z.object({
  fromSeq: z.coerce.number().int().min(1).default(1),
  limit: limitQuery(200, 1000),
});

export type RunParams = z.infer<typeof runParams>;
export type ListRunsQuery = z.infer<typeof listRunsQuery>;
export type StartRunBody = z.infer<typeof startRunBody>;
export type SendMessageBody = z.infer<typeof sendMessageBody>;
export type MessagesQuery = z.infer<typeof messagesQuery>;
export type EventsQuery = z.infer<typeof eventsQuery>;
