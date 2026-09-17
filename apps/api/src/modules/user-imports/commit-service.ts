import { formatUtcTimestamp, type Id } from "@gezycbt/contracts";
import {
  assertActorContext,
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import { PasswordService } from "../auth";
import { normalizeUsername } from "../users/domain";
import type {
  PreparedImportCredential,
  UserImportCommitRepository,
} from "./commit-repository";
import {
  type CredentialArtifactCipher,
  type CredentialArtifactDownload,
  type CredentialArtifactRow,
  ImportValidationError,
  ReauthenticationRequiredError,
} from "./domain";

const ARTIFACT_TTL_MS = 15 * 60 * 1000;

export type ParticipantPasswordHasher = (password: string) => Promise<string>;

export interface ReauthenticationPort {
  assertFresh(context: UseCaseContext): Promise<void>;
}

export class UserImportCommitService {
  constructor(
    private readonly repository: UserImportCommitRepository,
    private readonly cipher: CredentialArtifactCipher,
    private readonly hashPassword: ParticipantPasswordHasher = defaultHashPassword,
    private readonly reauthentication: ReauthenticationPort = {
      async assertFresh() {
        throw new ReauthenticationRequiredError();
      },
    },
  ) {}

  async commit(
    context: UseCaseContext,
    input: {
      readonly previewId: Id;
      readonly commitToken: string;
    },
  ) {
    assertMutationContext(context);
    const actorUserId = requireActorUserId(context);
    const tokenHash = await sha256(new TextEncoder().encode(input.commitToken));
    const rows = await this.repository.getCommitRows(
      actorUserId,
      input.previewId,
      tokenHash,
    );
    const createRows = rows.filter((row) => row.classification === "CREATE");
    const credentials: PreparedImportCredential[] = [];
    const artifactRows: CredentialArtifactRow[] = [];
    for (const row of createRows) {
      if (!row.username || !row.displayName) {
        throw new ImportValidationError(
          "Preview row is missing participant fields",
        );
      }
      const temporaryPassword = randomPassword();
      const passwordHash = await this.hashPassword(temporaryPassword);
      if (!passwordHash.startsWith("$argon2")) {
        throw new ImportValidationError(
          "Password hasher must return an Argon2 PHC string",
        );
      }
      credentials.push({
        rowNumber: row.rowNumber,
        username: row.username,
        usernameNormalized: normalizeUsername(row.username),
        displayName: row.displayName,
        classId: row.classId,
        passwordHash,
      });
      artifactRows.push({
        username: row.username,
        displayName: row.displayName,
        temporaryPassword,
      });
    }
    const artifactPayload = await this.cipher.seal(artifactRows);
    const artifactExpiresAt = formatUtcTimestamp(
      new Date(Date.now() + ARTIFACT_TTL_MS),
    );
    const idempotencyHash = await sha256(
      new TextEncoder().encode(context.idempotencyKey ?? ""),
    );
    return this.repository.commitPreview({
      ownerUserId: actorUserId,
      previewId: input.previewId,
      commitTokenHash: tokenHash,
      idempotencyHash,
      committedByUserId: actorUserId,
      requestId: context.actor.requestId,
      artifactPayload,
      artifactExpiresAt,
      credentials,
    });
  }

  async download(
    context: UseCaseContext,
    artifactId: Id,
  ): Promise<CredentialArtifactDownload> {
    assertActorContext(context.actor);
    const actorUserId = requireActorUserId(context);
    await this.reauthentication.assertFresh(context);
    const artifact = await this.repository.consumeCredentialArtifact(
      actorUserId,
      artifactId,
      actorUserId,
      context.actor.requestId,
    );
    const rows = await this.cipher.open(artifact.encryptedPayload);
    return {
      filename: `gezycbt-credentials-${artifact.artifactId}.csv`,
      content: renderCsv(rows),
      expiresAt: artifact.expiresAt,
    };
  }
}

function requireActorUserId(context: UseCaseContext): Id {
  if (!context.actor.userId) {
    throw new ImportValidationError("Import operation requires a user actor");
  }
  return context.actor.userId;
}

function randomPassword(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

async function defaultHashPassword(password: string): Promise<string> {
  return participantPasswordService.hash(password, "PARTICIPANT");
}

const participantPasswordService = new PasswordService();

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy.buffer));
}

function renderCsv(rows: readonly CredentialArtifactRow[]): string {
  const lines = ["username,display_name,temporary_password"];
  for (const row of rows) {
    lines.push(
      [row.username, row.displayName, row.temporaryPassword]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function csvEscape(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}
