import { describe, expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import type { AuthSession } from "../auth/session";
import { createBackupRoutes } from "./routes";
import { BackupService } from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;
const TOKEN = "a".repeat(43);
const PASSPHRASE = "passphrase-backup-yang-cukup-panjang";

function user(role: "ADMIN" | "TEACHER") {
  return {
    id: (role === "ADMIN" ? "1" : "2") as Id,
    username: role.toLowerCase(),
    usernameNormalized: role.toLowerCase(),
    passwordHash: "$argon2id$v=19$m=1,t=1,p=1$hash",
    role,
    status: "ACTIVE" as const,
    displayName: role,
    forcePasswordChange: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function session(userId: Id, role: "ADMIN" | "TEACHER"): AuthSession {
  return {
    id: `${userId}-session` as Id,
    userId,
    role,
    createdAt: NOW,
    lastSeenAt: NOW,
    idleExpiresAt: "2026-09-17T12:00:00.000Z" as UtcTimestamp,
    absoluteExpiresAt: "2026-09-18T00:00:00.000Z" as UtcTimestamp,
    revokedAt: null,
    revokeReason: null,
  };
}

function appFor(role: "ADMIN" | "TEACHER") {
  const current = user(role);
  const executions: string[] = [];
  const mediaPut: string[] = [];
  const database = {
    async query<T extends Record<string, unknown>>(sql: string) {
      if (sql.includes("FROM `media_assets`")) {
        return [
          {
            id: 10,
            storage_key: "media/abcdefghijklmnopqrst",
            mime_type: "image/png",
            status: "READY",
          },
        ] as unknown as T[];
      }
      if (sql.includes("FROM `users`")) {
        return [current] as unknown as T[];
      }
      return [] as unknown as T[];
    },
    async execute(sql: string) {
      executions.push(sql);
      return { affectedRows: 1 };
    },
    async transaction<T>(operation: (connection: never) => Promise<T>) {
      return operation(database as never);
    },
    async close() {},
  } as unknown as DatabasePort;
  const app = new Elysia()
    .use(
      createBackupRoutes({
        database,
        mediaRead: async () => new Uint8Array([1, 2, 3, 4]),
        mediaPut: async (key) => {
          mediaPut.push(key);
        },
        sessionService: {
          async resolve(token: string) {
            return token === TOKEN ? session(current.id, current.role) : null;
          },
          async verifyCsrfSecret() {
            return true;
          },
        },
        users: {
          async findById() {
            return current;
          },
        },
        expectedOrigin: "https://cbt.example.test",
      }),
    )
    .onError(({ error, set }) => {
      if (error instanceof AppError) {
        set.status = error.status;
        return { error: { code: error.code, message: error.message } };
      }
      set.status = 500;
      return { error: { code: "INTERNAL_ERROR" } };
    });
  return { app, database, executions, mediaPut };
}

function post(path: string, body: unknown, withCookie = true) {
  return new Request(`https://cbt.example.test${path}`, {
    method: "POST",
    headers: {
      ...(withCookie ? { cookie: `__Host-gezycbt-auth=${TOKEN}` } : {}),
      origin: "https://cbt.example.test",
      "content-type": "application/json",
      "x-csrf-token": "test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("backup routes", () => {
  test("admin can download, preview, and restore; teacher is forbidden", async () => {
    const { app, database, executions, mediaPut } = appFor("ADMIN");
    const download = await app.handle(
      post("/api/v1/admin/backup", { passphrase: PASSPHRASE }),
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(
      "backup-gezycbt-",
    );
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(100);
    const fileBase64 = Buffer.from(bytes).toString("base64");

    const preview = await app.handle(
      post("/api/v1/admin/backup/preview", {
        fileBase64,
        passphrase: PASSPHRASE,
      }),
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      data: { mediaCount: number; totalRows: number };
    };
    expect(previewBody.data.mediaCount).toBe(1);

    const restore = await app.handle(
      post("/api/v1/admin/backup/restore", {
        fileBase64,
        passphrase: PASSPHRASE,
        confirm: true,
      }),
    );
    expect(restore.status).toBe(200);
    expect(mediaPut).toEqual(["media/abcdefghijklmnopqrst"]);
    expect(executions.join("\n")).toContain("DELETE FROM `auth_sessions`");

    // The downloaded file must also preview through the service alone.
    const summary = await new BackupService(database, {}).previewBackup(
      bytes,
      PASSPHRASE,
    );
    expect(summary.mediaCount).toBe(1);

    const teacher = appFor("TEACHER");
    const forbidden = await teacher.app.handle(
      post("/api/v1/admin/backup", { passphrase: PASSPHRASE }),
    );
    expect(forbidden.status).toBe(403);

    const anonymous = await app.handle(
      post("/api/v1/admin/backup", { passphrase: PASSPHRASE }, false),
    );
    expect(anonymous.status).toBe(401);
  });
});
