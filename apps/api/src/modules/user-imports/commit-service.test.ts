import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type {
  CredentialArtifactPayloadRecord,
  ImportCommitDatabaseInput,
  UserImportCommitRepository,
} from "./commit-repository";
import {
  type ReauthenticationPort,
  UserImportCommitService,
} from "./commit-service";
import type {
  CredentialArtifactCipher,
  CredentialArtifactRow,
  ImportCommitResult,
  PreviewRow,
} from "./domain";

const actorId = "10" as Id;
const previewId = "20" as Id;
const timestamp = "2026-09-17T01:00:00.000Z" as UtcTimestamp;
const context = {
  actor: {
    actorType: "HUMAN" as const,
    userId: actorId,
    requestId: "request-1",
  },
  idempotencyKey: "import-commit-idempotency",
};

const createRow: PreviewRow = {
  rowNumber: 2,
  username: "participant-1",
  displayName: "Participant One",
  classCode: "X-A",
  classId: "30" as Id,
  existingUserId: null,
  classification: "CREATE",
  blocking: false,
  errors: [],
};

function repository(rows: readonly PreviewRow[]): UserImportCommitRepository & {
  input: ImportCommitDatabaseInput | null;
} {
  const state: { input: ImportCommitDatabaseInput | null } = { input: null };
  return {
    get input() {
      return state.input;
    },
    async getCommitRows() {
      return rows;
    },
    async commitPreview(input) {
      state.input = input;
      return {
        previewId,
        artifactId: "40" as Id,
        createdUserCount: input.credentials.length,
        committedAt: timestamp,
      } satisfies ImportCommitResult;
    },
    async consumeCredentialArtifact() {
      const payload = await new TextEncoder().encode("[]");
      return {
        artifactId: "40" as Id,
        ownerUserId: actorId,
        encryptedPayload: payload,
        expiresAt: "2026-09-17T02:00:00.000Z" as UtcTimestamp,
      } satisfies CredentialArtifactPayloadRecord;
    },
  };
}

function cipher(
  rows: readonly CredentialArtifactRow[],
): CredentialArtifactCipher {
  return {
    async seal() {
      return new TextEncoder().encode(JSON.stringify(rows));
    },
    async open(payload) {
      return JSON.parse(
        new TextDecoder().decode(payload),
      ) as readonly CredentialArtifactRow[];
    },
  };
}

describe("UserImportCommitService", () => {
  test("creates participant hashes and keeps temporary passwords out of the commit result", async () => {
    const repo = repository([createRow]);
    const service = new UserImportCommitService(
      repo,
      cipher([]),
      async (password) => `$argon2id$test-${password}`,
    );
    const result = await service.commit(context, {
      previewId,
      commitToken: "opaque-preview-token",
    });

    expect(result).toEqual({
      previewId,
      artifactId: "40" as Id,
      createdUserCount: 1,
      committedAt: timestamp,
    });
    expect(repo.input?.credentials).toHaveLength(1);
    expect(repo.input?.credentials[0]?.passwordHash).toStartWith("$argon2id$");
    expect(repo.input?.credentials[0]?.passwordHash).not.toBe(
      "opaque-preview-token",
    );
    expect(repo.input?.artifactPayload.byteLength).toBeGreaterThan(0);
  });

  test("requires fresh re-authentication before consuming an artifact", async () => {
    const repo = repository([]);
    const reauthentication: ReauthenticationPort = {
      async assertFresh() {
        throw new Error("reauth required");
      },
    };
    const service = new UserImportCommitService(
      repo,
      cipher([]),
      async () => "$argon2id$test",
      reauthentication,
    );
    expect(service.download(context, "40" as Id)).rejects.toThrow(
      "reauth required",
    );
  });
});
