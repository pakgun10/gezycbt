import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type {
  CreatePreviewRecord,
  ImportPreview,
  ImportResolution,
  PreviewRow,
} from "./domain";
import type { UserImportRepository } from "./repository";
import { UserImportPreviewService } from "./service";

const ownerUserId = "10" as Id;
const academicYearId = "20" as Id;
const previewId = "30" as Id;
const timestamp = "2026-09-17T01:00:00.000Z" as UtcTimestamp;
const context = {
  actor: {
    actorType: "HUMAN" as const,
    userId: ownerUserId,
    requestId: "req-1",
  },
  idempotencyKey: "import-preview-idempotency",
};

function preview(summary: ImportPreview["summary"]): ImportPreview {
  return {
    id: previewId,
    ownerUserId,
    academicYearId,
    mode: "CREATE_ONLY",
    sourceSha256: "00".repeat(32),
    status: "PENDING",
    expiresAt: "2026-09-18T01:00:00.000Z" as UtcTimestamp,
    committedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    summary,
  };
}

function repository(state: {
  resolution: ImportResolution;
  record?: CreatePreviewRecord | undefined;
  rows: readonly PreviewRow[];
}): UserImportRepository & { readonly state: typeof state } {
  return {
    state,
    async resolveParticipants() {
      return state.resolution;
    },
    async createPreview(input) {
      state.record = input;
      const summary = input.summary;
      return preview(summary);
    },
    async getPreview() {
      return preview(
        state.record?.summary ?? {
          totalRows: state.rows.length,
          createCount: 0,
          updateCount: 0,
          unchangedCount: 0,
          duplicateCount: 0,
          errorCount: state.rows.length,
          blockingCount: state.rows.length,
        },
      );
    },
    async listRows() {
      return { items: state.rows, nextCursor: null };
    },
    async listErrorRows() {
      return state.rows.filter((row) => row.blocking);
    },
  };
}

describe("UserImportPreviewService", () => {
  test("classifies creates, duplicates, missing classes, and would-update rows", async () => {
    const state = {
      resolution: {
        users: [
          {
            id: "40" as Id,
            usernameNormalized: "existing",
            displayName: "Old Name",
            role: "PARTICIPANT",
            status: "ACTIVE",
            activeClassId: "50" as Id,
          },
        ],
        classes: [{ id: "50" as Id, code: "X-A" }],
      },
      record: undefined as CreatePreviewRecord | undefined,
      rows: [] as readonly PreviewRow[],
    };
    const repo = repository(state);
    const service = new UserImportPreviewService(repo);
    const result = await service.createPreview(context, {
      academicYearId,
      csv: [
        "username,display_name,class_code",
        "new-user,New User,X-A",
        "duplicate,Duplicate,X-A",
        "duplicate,Duplicate Again,X-A",
        "existing,New Name,X-A",
        "unknown,Unknown,NOPE",
      ].join("\n"),
    });

    expect(result.commitToken.length).toBeGreaterThan(20);
    expect(state.record?.summary).toEqual({
      totalRows: 5,
      createCount: 1,
      updateCount: 1,
      unchangedCount: 0,
      duplicateCount: 2,
      errorCount: 1,
      blockingCount: 4,
    });
    expect(state.record?.rows.map((row) => row.classification)).toEqual([
      "CREATE",
      "DUPLICATE",
      "DUPLICATE",
      "WOULD_UPDATE",
      "ERROR",
    ]);
  });

  test("returns a safe error CSV without credentials or commit token", async () => {
    const errorRow: PreviewRow = {
      rowNumber: 4,
      username: "participant-4",
      displayName: "Participant",
      classCode: null,
      classId: null,
      existingUserId: null,
      classification: "ERROR",
      blocking: true,
      errors: [
        {
          field: "class_code",
          code: "CLASS_NOT_FOUND",
          message: "Class was not found",
        },
      ],
    };
    const state = {
      resolution: { users: [], classes: [] },
      record: undefined as CreatePreviewRecord | undefined,
      rows: [errorRow],
    };
    const service = new UserImportPreviewService(repository(state));
    const result = await service.downloadErrorCsv(context, previewId);
    expect(result).toContain(
      "4,class_code,CLASS_NOT_FOUND,Class was not found",
    );
    expect(result).not.toContain("password");
    expect(result).not.toContain("commitToken");
  });
});
