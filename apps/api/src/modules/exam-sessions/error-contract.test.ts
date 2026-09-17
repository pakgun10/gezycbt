import { describe, expect, test } from "bun:test";
import { ExamSessionError } from "./domain";
import {
  safeFinalizationReason,
  toParticipantRuntimeError,
} from "./error-contract";

describe("participant runtime error contract", () => {
  test("maps stable codes and strips administrative detail", () => {
    const mapped = toParticipantRuntimeError(
      new ExamSessionError("SESSION_ENDED", "private", 409, {
        finalizationReason: "STAFF_END",
        finalizationNote: "internal note",
        sessionId: "10",
      }),
    );
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe("SESSION_ENDED");
    expect(mapped?.message).toBe("Sesi ujian telah diakhiri.");
    expect(mapped?.details).toEqual({
      sessionId: "10",
      finalizationReason: "Diakhiri Petugas",
    });
    expect(mapped?.details.finalizationNote).toBeUndefined();
  });

  test("keeps all five safe finalization labels stable", () => {
    expect(safeFinalizationReason("PARTICIPANT_SUBMIT")).toBe(
      "Sudah Dikumpulkan",
    );
    expect(safeFinalizationReason("DEADLINE")).toBe("Waktu Habis");
    expect(safeFinalizationReason("SCHEDULE_CLOSE")).toBe("Jadwal Ditutup");
    expect(safeFinalizationReason("STAFF_END")).toBe("Diakhiri Petugas");
    expect(safeFinalizationReason("RESET_ATTEMPT")).toBe("Attempt Direset");
  });
});
