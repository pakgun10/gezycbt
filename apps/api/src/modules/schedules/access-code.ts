import {
  type Id,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import {
  assertMutationContext,
  type UseCaseContext,
} from "../../application/actor-context";
import type { AuthorizationPolicyService } from "../../application/authorization";
import {
  type Schedule,
  ScheduleImmutableError,
  ScheduleNotFoundError,
  ScheduleValidationError,
} from "./domain";
import type {
  ScheduleAccessField,
  ScheduleAccessRepository,
  ScheduleRepository,
} from "./repository";

export const SCHEDULE_ACCESS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SCHEDULE_ACCESS_CODE_LENGTH = 5;

export type ScheduleAccessCodeKind = "PRACTICE_TOKEN" | "MAIN_ACCESS_CODE";

export interface ScheduleAccessCodeHasher {
  digest(
    kind: ScheduleAccessCodeKind,
    canonicalCode: string,
  ): Promise<Uint8Array>;
}

export interface HmacScheduleAccessCodeHasherOptions {
  readonly secret: Uint8Array;
}

/** HMAC keeps the low-entropy convenience code from being rainbow-tableable. */
export function createHmacScheduleAccessCodeHasher(
  options: HmacScheduleAccessCodeHasherOptions,
): ScheduleAccessCodeHasher {
  if (options.secret.byteLength < 32)
    throw new RangeError(
      "Schedule access HMAC secret must be at least 32 bytes",
    );
  const secret = new Uint8Array(options.secret);
  let keyPromise: Promise<CryptoKey> | undefined;
  return {
    async digest(kind, canonicalCode) {
      keyPromise ??= crypto.subtle.importKey(
        "raw",
        secret,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const message = new TextEncoder().encode(
        `gezycbt/schedule-access/v1/${kind}/${canonicalCode}`,
      );
      return new Uint8Array(
        await crypto.subtle.sign("HMAC", await keyPromise, message),
      );
    },
  };
}

export interface ScheduleAccessCodeServiceOptions {
  readonly hasher: ScheduleAccessCodeHasher;
  readonly generateCode?: () => string;
  readonly maxGenerationAttempts?: number;
}

export interface RotatedScheduleAccessCode {
  readonly scheduleId: Id;
  readonly kind: ScheduleAccessCodeKind;
  /** Plaintext is returned only from this mutation response. */
  readonly code: string;
  readonly hint: string;
  readonly updatedAt: UtcTimestamp;
}

export class ScheduleAccessCodeConflictError extends Error {
  readonly code = "SCHEDULE_ACCESS_CODE_CONFLICT";

  constructor() {
    super("Schedule access code is already in use");
    this.name = "ScheduleAccessCodeConflictError";
  }
}

export class ScheduleAccessCodeGenerationError extends Error {
  readonly code = "SCHEDULE_ACCESS_CODE_GENERATION_FAILED";

  constructor() {
    super("A unique schedule access code could not be generated");
    this.name = "ScheduleAccessCodeGenerationError";
  }
}

export class ScheduleAccessCodeModeError extends Error {
  readonly code = "SCHEDULE_ACCESS_CODE_MODE_INVALID";

  constructor(kind: ScheduleAccessCodeKind, mode: Schedule["mode"]) {
    super(`${kind} cannot be used for ${mode} schedule`);
    this.name = "ScheduleAccessCodeModeError";
  }
}

export class ScheduleAccessCodeService {
  private readonly generateCode: () => string;
  private readonly maxGenerationAttempts: number;

  constructor(
    private readonly repository: Pick<ScheduleRepository, "findSchedule"> &
      ScheduleAccessRepository,
    private readonly authorization: Pick<
      AuthorizationPolicyService,
      "assertTeacherScope"
    >,
    private readonly options: ScheduleAccessCodeServiceOptions,
  ) {
    this.generateCode = options.generateCode ?? generateScheduleAccessCode;
    this.maxGenerationAttempts = options.maxGenerationAttempts ?? 5;
    if (
      !Number.isSafeInteger(this.maxGenerationAttempts) ||
      this.maxGenerationAttempts < 1 ||
      this.maxGenerationAttempts > 20
    )
      throw new RangeError("maxGenerationAttempts must be between 1 and 20");
  }

  async rotatePracticeToken(
    context: UseCaseContext,
    scheduleId: Id,
    expectedUpdatedAt: UtcTimestamp,
    proposedCode?: string,
  ): Promise<RotatedScheduleAccessCode> {
    return this.rotate(
      context,
      scheduleId,
      "PRACTICE_TOKEN",
      expectedUpdatedAt,
      proposedCode,
    );
  }

  async rotateMainAccessCode(
    context: UseCaseContext,
    scheduleId: Id,
    expectedUpdatedAt: UtcTimestamp,
    proposedCode?: string,
  ): Promise<RotatedScheduleAccessCode> {
    return this.rotate(
      context,
      scheduleId,
      "MAIN_ACCESS_CODE",
      expectedUpdatedAt,
      proposedCode,
    );
  }

  private async rotate(
    context: UseCaseContext,
    scheduleId: Id,
    kind: ScheduleAccessCodeKind,
    expectedUpdatedAt: UtcTimestamp,
    proposedCode?: string,
  ): Promise<RotatedScheduleAccessCode> {
    assertMutationContext(context);
    const schedule = await this.repository.findSchedule(scheduleId);
    if (!schedule) throw new ScheduleNotFoundError();
    await this.authorization.assertTeacherScope(context.actor, {
      ownerTeacherId: schedule.exam.ownerTeacherId,
      subjectId: schedule.exam.subjectId,
      classIds: schedule.targetClassIds,
    });
    assertCodeMutable(schedule);
    assertCodeMode(schedule, kind);
    const expected = requireTimestamp(expectedUpdatedAt);
    const proposed =
      proposedCode === undefined
        ? null
        : normalizeScheduleAccessCode(proposedCode);
    const attempts = proposed === null ? this.maxGenerationAttempts : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const code = proposed ?? normalizeScheduleAccessCode(this.generateCode());
      const digest = new Uint8Array(
        await this.options.hasher.digest(kind, code),
      );
      if (digest.byteLength !== 32)
        throw new ScheduleValidationError(
          "Access code digest must be exactly 32 bytes",
          "INVALID_ACCESS_CODE_DIGEST",
        );
      try {
        const updated = await this.repository.updateAccessCode(
          scheduleId,
          fieldFor(kind),
          digest,
          formatHint(code),
          expected,
        );
        if (!updated) throw new ScheduleNotFoundError();
        return {
          scheduleId: updated.id,
          kind,
          code,
          hint: formatHint(code),
          updatedAt: updated.updatedAt,
        };
      } catch (error) {
        if (!(error instanceof ScheduleAccessCodeConflictError)) throw error;
        if (proposed !== null) throw error;
      }
    }
    throw new ScheduleAccessCodeGenerationError();
  }
}

export function normalizeScheduleAccessCode(value: string): string {
  if (typeof value !== "string")
    throw new ScheduleValidationError(
      "Access code must be text",
      "INVALID_ACCESS_CODE",
    );
  const normalized = value.trim().toUpperCase().replaceAll("-", "");
  if (
    normalized.length !== SCHEDULE_ACCESS_CODE_LENGTH ||
    [...normalized].some(
      (character) => !SCHEDULE_ACCESS_ALPHABET.includes(character),
    )
  )
    throw new ScheduleValidationError(
      "Access code must contain five unambiguous uppercase letters or digits",
      "INVALID_ACCESS_CODE",
    );
  return normalized;
}

export function generateScheduleAccessCode(): string {
  const bytes = new Uint8Array(SCHEDULE_ACCESS_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((value) => SCHEDULE_ACCESS_ALPHABET[value & 31] ?? "A")
    .join("");
}

/** Hint reveals two characters and is never accepted by an auth lookup. */
export function formatHint(canonicalCode: string): string {
  const normalized = normalizeScheduleAccessCode(canonicalCode);
  return `•••-${normalized.slice(-2)}`;
}

function fieldFor(kind: ScheduleAccessCodeKind): ScheduleAccessField {
  return kind === "PRACTICE_TOKEN" ? "PRACTICE_TOKEN" : "MAIN_ACCESS_CODE";
}

function assertCodeMode(
  schedule: Schedule,
  kind: ScheduleAccessCodeKind,
): void {
  const expectedMode = kind === "PRACTICE_TOKEN" ? "PRACTICE" : "MAIN";
  if (schedule.mode !== expectedMode)
    throw new ScheduleAccessCodeModeError(kind, schedule.mode);
}

function assertCodeMutable(schedule: Schedule): void {
  if (
    schedule.status !== "DRAFT" &&
    schedule.status !== "READY" &&
    schedule.status !== "OPEN"
  )
    throw new ScheduleImmutableError(
      "Access code cannot be changed after a schedule is closed",
    );
}

function requireTimestamp(value: UtcTimestamp): UtcTimestamp {
  const parsed = parseUtcTimestamp(value);
  if (!parsed)
    throw new ScheduleValidationError(
      "expectedUpdatedAt must be a UTC timestamp",
      "INVALID_TIMESTAMP",
    );
  return parsed;
}
