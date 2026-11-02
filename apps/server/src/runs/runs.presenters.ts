import { toIso, toIsoOrNull } from "../api/common-schemas.js";
import type { MessageRecord } from "../hub/message.js";
import type { RunEvent } from "../realtime/run-event.js";
import type { RunSummaryRecord } from "../run-log/run-repository.js";
import type { RunDetailView } from "./run-query.service.js";

export const presentRunSummary = (run: RunSummaryRecord) => ({
  id: run.id,
  graphId: run.graphId,
  graphVersionId: run.graphVersionId,
  status: run.status,
  budgetUsd: run.budgetUsd,
  startedAt: toIsoOrNull(run.startedAt),
  finishedAt: toIsoOrNull(run.finishedAt),
});

export const presentRunDetail = ({ run, input, finish, usage }: RunDetailView) => ({
  ...presentRunSummary(run),
  input,
  finish: finish && { ...finish, at: toIso(finish.at) },
  usage,
});

export const presentMessage = (message: MessageRecord) => ({
  id: message.id,
  seq: message.seq,
  from: message.from,
  to: message.to,
  kind: message.kind,
  replyTo: message.replyTo,
  body: message.body,
  createdAt: toIso(message.createdAt),
  deliveredAt: toIsoOrNull(message.deliveredAt),
  ackedAt: toIsoOrNull(message.ackedAt),
});

export const presentRunEvent = (event: RunEvent) => ({
  runId: event.runId,
  seq: event.seq,
  type: event.type,
  agent: event.agent,
  payload: event.payload,
  at: toIso(event.at),
});
