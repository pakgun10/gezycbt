import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { UseCaseContext } from "../../application/actor-context";
import { ScheduleNotReadyError, ScheduleVersionConflictError } from "./domain";
import {
  type ScheduleLifecycleCandidateRepository,
  ScheduleLifecycleReconciler,
} from "./reconciler";

const NOW = "2026-09-17T02:00:00.000Z" as UtcTimestamp;
const CONTEXT: UseCaseContext = {
  actor: { actorType: "SYSTEM", requestId: "schedule-reconciler-001" },
};

describe("ScheduleLifecycleReconciler", () => {
  test("processes a bounded candidate page and isolates expected races", async () => {
    const candidates = new FakeCandidates([
      { id: "1" as Id },
      { id: "2" as Id },
      { id: "3" as Id },
      { id: "4" as Id },
    ]);
    const service = new FakeScheduleService({
      "1": { status: "OPEN" },
      "2": { status: "CLOSED" },
      "3": new ScheduleVersionConflictError(),
      "4": new ScheduleNotReadyError(["MISSING_CODE"]),
    });
    const reconciler = new ScheduleLifecycleReconciler(candidates, service, 4);

    const report = await reconciler.runOnce(CONTEXT, NOW);

    expect(report).toEqual({
      scanned: 4,
      opened: 1,
      closed: 1,
      unchanged: 0,
      blocked: 1,
      conflicts: 1,
    });
    expect(candidates.last).toEqual({ now: NOW, limit: 4 });
    expect(service.ids).toEqual(["1" as Id, "2" as Id, "3" as Id, "4" as Id]);
  });

  test("does not open a delayed schedule when the candidate service returns no transition", async () => {
    const service = new FakeScheduleService({ "1": null });
    const reconciler = new ScheduleLifecycleReconciler(
      new FakeCandidates([{ id: "1" as Id }]),
      service,
    );
    const report = await reconciler.runOnce(CONTEXT, NOW);
    expect(report.unchanged).toBe(1);
    expect(report.opened).toBe(0);
    expect(report.closed).toBe(0);
  });

  test("rejects invalid clock and batch sizes", async () => {
    expect(
      () =>
        new ScheduleLifecycleReconciler(
          new FakeCandidates([]),
          new FakeScheduleService({}),
          0,
        ),
    ).toThrow();
    const reconciler = new ScheduleLifecycleReconciler(
      new FakeCandidates([]),
      new FakeScheduleService({}),
    );
    await expect(
      reconciler.runOnce(CONTEXT, "bad" as UtcTimestamp),
    ).rejects.toThrow();
  });
});

class FakeCandidates implements ScheduleLifecycleCandidateRepository {
  last: { now: UtcTimestamp; limit: number } | null = null;

  constructor(private readonly rows: readonly { id: Id }[]) {}

  async listLifecycleCandidates(now: UtcTimestamp, limit: number) {
    this.last = { now, limit };
    return this.rows.slice(0, limit);
  }
}

class FakeScheduleService {
  readonly ids: Id[] = [];

  constructor(
    private readonly outcomes: Record<
      string,
      { status: "OPEN" | "CLOSED" } | Error | null
    >,
  ) {}

  async advanceLifecycle(_context: UseCaseContext, id: Id, _now: UtcTimestamp) {
    this.ids.push(id);
    const outcome = this.outcomes[id] ?? null;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}
