import type { Id } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { Elysia } from "elysia";
import { AppError } from "../../http/app-error";
import {
  assertCsrfRequest,
  CSRF_HEADER_NAME,
  CsrfProtectionError,
} from "../auth/csrf";
import { type AuthSessionService, readAuthCookie } from "../auth/session";
import type { MediaMimeType } from "../media/domain";
import type { StoredUser } from "../users";
import { BackupError, BackupService } from "./service";

export interface BackupRouteOptions {
  readonly database: DatabasePort;
  readonly mediaRead: (storageKey: string) => Promise<Uint8Array>;
  readonly mediaPut: (
    storageKey: string,
    bytes: Uint8Array,
    mimeType: MediaMimeType,
  ) => Promise<void>;
  readonly sessionService: Pick<
    AuthSessionService,
    "resolve" | "verifyCsrfSecret"
  >;
  readonly users: {
    readonly findById: (id: Id) => Promise<StoredUser | null>;
  };
  readonly expectedOrigin: URL | string;
}

function mapBackupError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof BackupError) {
    const status = error.code === "BACKUP_ACTIVE_SESSION" ? 409 : 422;
    return new AppError(status, error.code, error.message);
  }
  return new AppError(500, "INTERNAL_ERROR", "Backup tidak dapat diproses.");
}

async function requireAdmin(
  request: Request,
  options: BackupRouteOptions,
): Promise<{
  user: StoredUser;
  session: Awaited<ReturnType<BackupRouteOptions["sessionService"]["resolve"]>>;
}> {
  const token = readAuthCookie(request.headers.get("cookie"));
  const session = token ? await options.sessionService.resolve(token) : null;
  if (!session) {
    throw new AppError(
      401,
      "AUTH_SESSION_EXPIRED",
      "Sesi login telah berakhir.",
    );
  }
  const user = await options.users.findById(session.userId);
  if (user?.status !== "ACTIVE" || user?.role !== "ADMIN") {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Anda tidak memiliki akses ke resource ini.",
    );
  }
  return { user, session };
}

async function requireCsrf(
  request: Request,
  session: Awaited<ReturnType<BackupRouteOptions["sessionService"]["resolve"]>>,
  options: BackupRouteOptions,
): Promise<void> {
  try {
    await assertCsrfRequest({
      method: request.method,
      origin: request.headers.get("origin"),
      expectedOrigin: options.expectedOrigin,
      csrfToken: request.headers.get(CSRF_HEADER_NAME),
      session,
      verifyCsrfSecret: (id, token) =>
        options.sessionService.verifyCsrfSecret(id, token),
      requireSession: true,
    });
  } catch (error) {
    if (error instanceof CsrfProtectionError) {
      throw new AppError(
        error.status,
        error.status === 401 ? "AUTHENTICATION_REQUIRED" : "CSRF_INVALID",
        "Permintaan tidak dapat diverifikasi.",
        { reason: error.reason },
      );
    }
    throw error;
  }
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(422, "VALIDATION_FAILED", "Format request tidak valid.");
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new AppError(422, "VALIDATION_FAILED", `${field} wajib diisi.`);
  }
  return value;
}

function decodeFile(value: unknown): Uint8Array {
  const base64 = stringField(value, "Berkas backup");
  try {
    const bytes = Buffer.from(base64, "base64");
    if (bytes.byteLength === 0) throw new Error("empty");
    return bytes;
  } catch {
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "Berkas backup bukan base64 yang valid.",
    );
  }
}

/**
 * Admin-only backup routes. These deliberately live outside the staff route
 * file: the backup service replaces whole tables, so its auth, CSRF, and
 * error handling stay reviewable in one place instead of inside a
 * 2,700-line route file.
 */
export function createBackupRoutes(options: BackupRouteOptions): Elysia {
  const app = new Elysia({ name: "gezycbt-backup-routes" });
  const service = new BackupService(options.database, {
    mediaRead: options.mediaRead,
    mediaPut: options.mediaPut,
  });

  app.post("/api/v1/admin/backup", async ({ request, body, set }) => {
    try {
      const admin = await requireAdmin(request, options);
      await requireCsrf(request, admin.session, options);
      const payload = objectBody(body);
      const result = await service.createBackup(
        stringField(payload.passphrase, "Passphrase"),
        admin.user.id,
      );
      set.headers["content-type"] = "application/octet-stream";
      set.headers["content-disposition"] =
        `attachment; filename="${result.filename}"`;
      return result.bytes;
    } catch (error) {
      throw mapBackupError(error);
    }
  });

  app.post("/api/v1/admin/backup/preview", async ({ request, body }) => {
    try {
      const admin = await requireAdmin(request, options);
      await requireCsrf(request, admin.session, options);
      const payload = objectBody(body);
      const summary = await service.previewBackup(
        decodeFile(payload.fileBase64),
        stringField(payload.passphrase, "Passphrase"),
      );
      return { data: summary };
    } catch (error) {
      throw mapBackupError(error);
    }
  });

  app.post("/api/v1/admin/backup/restore", async ({ request, body }) => {
    try {
      const admin = await requireAdmin(request, options);
      await requireCsrf(request, admin.session, options);
      const payload = objectBody(body);
      const summary = await service.restoreBackup(
        decodeFile(payload.fileBase64),
        stringField(payload.passphrase, "Passphrase"),
        {
          confirm: payload.confirm === true,
          actorUsername: admin.user.username,
        },
      );
      return { data: summary };
    } catch (error) {
      throw mapBackupError(error);
    }
  });

  return app;
}
