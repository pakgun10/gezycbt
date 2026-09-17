import {
  type Id,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import type { Schedule } from "./domain";
import { ScheduleNotReadyError, ScheduleVersionConflictError } from "./domain";

export interface ScheduleLifecycleCandidateRepository {
  listLifecycleCandidates(
    now: UtcTimestamp,
    limit: number,
  ): Promise<readonly { id: Id }[]>;
}

export interface ScheduleReconcileReport {
  readonly scanned: number;
  readonly opened: number;
  readonly closed: number;
  readonly unchanged: number;
  readonly blocked: number;
  readonly conflicts: number;
}

interface ScheduleLifecycleAdvanceService {
  advanceLifecycle(
    context: UseCaseContext,
    id: Id,
    now: UtcTimestamp,
  ): Promise<Pick<Schedule, "status"> | null>;
}

/**
 * Reconciles schedule state in bounded, idempotent batches. The service never
 * computes a new eligibility window; it only catches up to the supplied
 * server timestamp.
 */
export class ScheduleLifecycleReconciler {
  constructor(
    private readonly candidates: ScheduleLifecycleCandidateRepository,
    private readonly schedules: ScheduleLifecycleAdvanceService,
    private readonly batchLimit = 50,
  ) {
    if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 100)
      throw new RangeError("batchLimit must be between 1 and 100");
  }

  async runOnce(
    context: UseCaseContext,
    now: UtcTimestamp,
  ): Promise<ScheduleReconcileReport> {
    const serverNow = parseUtcTimestamp(now);
    if (!serverNow) throw new Error("Reconciler now must be a UTC timestamp");
    const rows = await this.candidates.listLifecycleCandidates(
      serverNow,
      this.batchLimit,
    );
    let opened = 0;
    let closed = 0;
    let unchanged = 0;
    let blocked = 0;
    let conflicts = 0;
    for (const candidate of rows) {
      try {
        const result = await this.schedules.advanceLifecycle(
          context,
          candidate.id,
          serverNow,
        );
        if (!result) {
          unchanged += 1;
        } else if (result.status === "OPEN") {
          opened += 1;
        } else if (result.status === "CLOSED") {
          closed += 1;
        } else {
          unchanged += 1;
        }
      } catch (error) {
        if (error instanceof ScheduleVersionConflictError) {
          conflicts += 1;
          continue;
        }
        if (error instanceof ScheduleNotReadyError) {
          blocked += 1;
          continue;
        }
        throw error;
      }
    }
    return {
      scanned: rows.length,
      opened,
      closed,
      unchanged,
      blocked,
      conflicts,
    };
  }
}
