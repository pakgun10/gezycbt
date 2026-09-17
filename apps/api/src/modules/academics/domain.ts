import type { CursorPage, Id, UtcTimestamp } from "@gezycbt/contracts";

export const ACADEMIC_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type AcademicStatus = (typeof ACADEMIC_STATUSES)[number];

export interface PageRequest {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface AcademicYear {
  readonly id: Id;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly isActive: boolean;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface ClassRecord {
  readonly id: Id;
  readonly academicYearId: Id;
  readonly code: string;
  readonly name: string;
  readonly status: AcademicStatus;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface ClassMember {
  readonly id: Id;
  readonly classId: Id;
  readonly participantId: Id;
  readonly joinedAt: UtcTimestamp;
  readonly leftAt: UtcTimestamp | null;
}

export interface Subject {
  readonly id: Id;
  readonly code: string;
  readonly name: string;
  readonly status: AcademicStatus;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
}

export interface TeacherScope {
  readonly teacherId: Id;
  readonly subjectIds: readonly Id[];
  readonly classIds: readonly Id[];
}

export interface CreateAcademicYearInput {
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly isActive?: boolean;
}

export interface CreateClassInput {
  readonly academicYearId: Id;
  readonly code: string;
  readonly name: string;
}

export interface UpdateClassInput {
  readonly name?: string;
  readonly status?: AcademicStatus;
}

export interface CreateSubjectInput {
  readonly code: string;
  readonly name: string;
}

export interface UpdateSubjectInput {
  readonly name?: string;
  readonly status?: AcademicStatus;
}

export interface ScopeInput {
  readonly subjectIds: readonly Id[];
  readonly classIds: readonly Id[];
}

export class AcademicValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademicValidationError";
  }
}

export class AcademicNotFoundError extends Error {
  constructor(resource = "Academic resource") {
    super(`${resource} was not found`);
    this.name = "AcademicNotFoundError";
  }
}

export class AcademicConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcademicConflictError";
  }
}

export function validateName(
  value: string,
  max: number,
  field: string,
): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > max) {
    throw new AcademicValidationError(`${field} must be 1-${max} characters`);
  }
  return normalized;
}

export function validateCode(
  value: string,
  max: number,
  field: string,
): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > max ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint < 0x20 ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        /\s/u.test(character)
      );
    })
  ) {
    throw new AcademicValidationError(
      `${field} must be 1-${max} characters without whitespace`,
    );
  }
  return normalized;
}

export function validateDate(value: string, field: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  ) {
    throw new AcademicValidationError(`${field} must be an ISO date`);
  }
  return value;
}

export function validateDateRange(startsOn: string, endsOn: string): void {
  if (startsOn >= endsOn) {
    throw new AcademicValidationError("startsOn must be before endsOn");
  }
}

export function validateStatus(
  status: string,
): asserts status is AcademicStatus {
  if (!ACADEMIC_STATUSES.includes(status as AcademicStatus)) {
    throw new AcademicValidationError("Academic status is invalid");
  }
}

export function uniqueIds(ids: readonly Id[], field: string): Id[] {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw new AcademicValidationError(`${field} contains duplicate IDs`);
  }
  return unique;
}

export function encodeCursor(id: Id): string {
  return id;
}

export function decodeCursor(cursor: string | undefined): Id | undefined {
  if (cursor === undefined) return undefined;
  if (!/^\d+$/u.test(cursor)) {
    throw new AcademicValidationError("Cursor is invalid");
  }
  return cursor as Id;
}

export type AcademicPage<T> = CursorPage<T>;
