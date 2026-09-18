import {
  type CursorPage,
  formatId,
  formatUtcTimestamp,
  type Id,
  normalizePageLimit,
  parseId,
  parseUtcTimestamp,
  type UtcTimestamp,
} from "@gezycbt/contracts";
import {
  AcademicConflictError,
  type AcademicPage,
  AcademicValidationError,
  type AcademicYear,
  type ClassMember,
  type ClassMemberProfile,
  type ClassRecord,
  type CreateAcademicYearInput,
  type CreateClassInput,
  type CreateSubjectInput,
  decodeCursor,
  type PageRequest,
  type ScopeInput,
  type Subject,
  type TeacherScope,
  type UpdateClassInput,
  type UpdateSubjectInput,
  uniqueIds,
  validateCode,
  validateDate,
  validateDateRange,
  validateName,
  validateStatus,
} from "./domain";

export interface AcademicRepositoryConnection {
  query<T extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
  execute(sql: string, parameters?: readonly unknown[]): Promise<unknown>;
}

export interface AcademicRepositoryDatabase
  extends AcademicRepositoryConnection {
  transaction<T>(
    operation: (connection: AcademicRepositoryConnection) => Promise<T>,
  ): Promise<T>;
}

export interface AcademicRepository {
  createAcademicYear(input: CreateAcademicYearInput): Promise<AcademicYear>;
  listAcademicYears(request: PageRequest): Promise<AcademicPage<AcademicYear>>;
  setAcademicYearActive(id: Id): Promise<AcademicYear | null>;
  createClass(input: CreateClassInput): Promise<ClassRecord>;
  listClasses(
    academicYearId: Id | undefined,
    request: PageRequest,
  ): Promise<AcademicPage<ClassRecord>>;
  updateClass(id: Id, input: UpdateClassInput): Promise<ClassRecord | null>;
  replaceClassMembers(
    classId: Id,
    participantIds: readonly Id[],
  ): Promise<readonly ClassMember[]>;
  listClassMembers(
    classId: Id,
    request: PageRequest,
  ): Promise<AcademicPage<ClassMember>>;
  listClassMemberProfiles(classId: Id): Promise<readonly ClassMemberProfile[]>;
  createSubject(input: CreateSubjectInput): Promise<Subject>;
  listSubjects(request: PageRequest): Promise<AcademicPage<Subject>>;
  updateSubject(id: Id, input: UpdateSubjectInput): Promise<Subject | null>;
  replaceTeacherScopes(teacherId: Id, input: ScopeInput): Promise<TeacherScope>;
  getTeacherScopes(teacherId: Id): Promise<TeacherScope | null>;
}

type AcademicYearRow = Record<string, unknown> & {
  id: unknown;
  name: unknown;
  starts_on: unknown;
  ends_on: unknown;
  is_active: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type ClassRow = Record<string, unknown> & {
  id: unknown;
  academic_year_id: unknown;
  code: unknown;
  name: unknown;
  status: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type MemberRow = Record<string, unknown> & {
  id: unknown;
  class_id: unknown;
  participant_id: unknown;
  joined_at: unknown;
  left_at: unknown;
};

type MemberProfileRow = MemberRow & {
  username: unknown;
  display_name: unknown;
};

type SubjectRow = Record<string, unknown> & {
  id: unknown;
  code: unknown;
  name: unknown;
  status: unknown;
  created_at: unknown;
  updated_at: unknown;
};

const YEAR_COLUMNS =
  "SELECT id, name, starts_on, ends_on, is_active, created_at, updated_at FROM academic_years";
const CLASS_COLUMNS =
  "SELECT id, academic_year_id, code, name, status, created_at, updated_at FROM classes";
const MEMBER_COLUMNS =
  "SELECT id, class_id, participant_id, joined_at, left_at FROM class_members";
const SUBJECT_COLUMNS =
  "SELECT id, code, name, status, created_at, updated_at FROM subjects";

export class SqlAcademicRepository implements AcademicRepository {
  constructor(private readonly database: AcademicRepositoryDatabase) {}

  async createAcademicYear(
    input: CreateAcademicYearInput,
  ): Promise<AcademicYear> {
    const name = validateName(input.name, 50, "Academic year name");
    const startsOn = validateDate(input.startsOn, "startsOn");
    const endsOn = validateDate(input.endsOn, "endsOn");
    validateDateRange(startsOn, endsOn);
    const isActive = input.isActive ?? false;
    try {
      return await this.database.transaction(async (connection) => {
        if (isActive) {
          await connection.execute(
            "UPDATE academic_years SET is_active = FALSE, updated_at = UTC_TIMESTAMP(6)",
          );
        }
        await connection.execute(
          "INSERT INTO academic_years (name, starts_on, ends_on, is_active) VALUES (?, ?, ?, ?)",
          [name, startsOn, endsOn, isActive],
        );
        const rows = await connection.query<AcademicYearRow>(
          `${YEAR_COLUMNS} WHERE name = ? LIMIT 1`,
          [name],
        );
        if (!rows[0])
          throw new Error("Created academic year could not be read back");
        return mapAcademicYear(rows[0]);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AcademicConflictError("Academic year name already exists");
      }
      throw error;
    }
  }

  async listAcademicYears(
    request: PageRequest,
  ): Promise<AcademicPage<AcademicYear>> {
    const limit = normalizePageLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const where = cursor ? " WHERE id > ?" : "";
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = await this.database.query<AcademicYearRow>(
      `${YEAR_COLUMNS}${where} ORDER BY id ASC LIMIT ?`,
      params,
    );
    return page(rows.map(mapAcademicYear), limit);
  }

  async setAcademicYearActive(id: Id): Promise<AcademicYear | null> {
    return this.database.transaction(async (connection) => {
      const current = await queryYear(connection, id, true);
      if (!current) return null;
      await connection.execute("UPDATE academic_years SET is_active = FALSE");
      await connection.execute(
        "UPDATE academic_years SET is_active = TRUE, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [id],
      );
      return queryYear(connection, id, false);
    });
  }

  async createClass(input: CreateClassInput): Promise<ClassRecord> {
    const code = validateCode(input.code, 50, "Class code");
    const name = validateName(input.name, 150, "Class name");
    try {
      return await this.database.transaction(async (connection) => {
        const year = await queryYear(connection, input.academicYearId, true);
        if (!year)
          throw new AcademicConflictError("Academic year does not exist");
        await connection.execute(
          "INSERT INTO classes (academic_year_id, code, name) VALUES (?, ?, ?)",
          [input.academicYearId, code, name],
        );
        const rows = await connection.query<ClassRow>(
          `${CLASS_COLUMNS} WHERE academic_year_id = ? AND code = ? LIMIT 1`,
          [input.academicYearId, code],
        );
        if (!rows[0]) throw new Error("Created class could not be read back");
        return mapClass(rows[0]);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AcademicConflictError(
          "Class code already exists in this academic year",
        );
      }
      throw error;
    }
  }

  async listClasses(
    academicYearId: Id | undefined,
    request: PageRequest,
  ): Promise<AcademicPage<ClassRecord>> {
    const limit = normalizePageLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    if (academicYearId) {
      conditions.push("academic_year_id = ?");
      parameters.push(academicYearId);
    }
    if (cursor) {
      conditions.push("id > ?");
      parameters.push(cursor);
    }
    parameters.push(limit + 1);
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const rows = await this.database.query<ClassRow>(
      `${CLASS_COLUMNS}${where} ORDER BY id ASC LIMIT ?`,
      parameters,
    );
    return page(rows.map(mapClass), limit);
  }

  async updateClass(
    id: Id,
    input: UpdateClassInput,
  ): Promise<ClassRecord | null> {
    if (input.name === undefined && input.status === undefined) {
      throw new AcademicValidationError(
        "At least one class field must be updated",
      );
    }
    const name =
      input.name === undefined
        ? undefined
        : validateName(input.name, 150, "Class name");
    if (input.status !== undefined) validateStatus(input.status);
    return this.database.transaction(async (connection) => {
      const current = await queryClass(connection, id, true);
      if (!current) return null;
      const assignments: string[] = [];
      const parameters: unknown[] = [];
      if (name !== undefined) {
        assignments.push("name = ?");
        parameters.push(name);
      }
      if (input.status !== undefined) {
        assignments.push("status = ?");
        parameters.push(input.status);
      }
      assignments.push("updated_at = UTC_TIMESTAMP(6)");
      await connection.execute(
        `UPDATE classes SET ${assignments.join(", ")} WHERE id = ?`,
        [...parameters, id],
      );
      return queryClass(connection, id, false);
    });
  }

  async replaceClassMembers(
    classId: Id,
    participantIds: readonly Id[],
  ): Promise<readonly ClassMember[]> {
    const uniqueParticipantIds = uniqueIds(participantIds, "participantIds");
    if (uniqueParticipantIds.length > 1500) {
      throw new AcademicValidationError(
        "A class roster cannot exceed 1,500 participants",
      );
    }
    try {
      return await this.database.transaction(async (connection) => {
        const classRecord = await queryClass(connection, classId, true);
        if (!classRecord)
          throw new AcademicConflictError("Class does not exist");
        if (classRecord.status === "ARCHIVED") {
          throw new AcademicConflictError(
            "Archived class cannot receive members",
          );
        }
        const currentRows = await connection.query<MemberRow>(
          `${MEMBER_COLUMNS} WHERE class_id = ? AND left_at IS NULL FOR UPDATE`,
          [classId],
        );
        const currentIds = currentRows.map((row) =>
          requiredId(row.participant_id),
        );
        const lockIds = [...new Set([...uniqueParticipantIds, ...currentIds])];
        if (lockIds.length) {
          const lockPlaceholders = questionMarks(lockIds.length);
          await connection.query<{ id: unknown }>(
            `SELECT id FROM users WHERE id IN (${lockPlaceholders}) FOR UPDATE`,
            lockIds,
          );
        }
        if (uniqueParticipantIds.length) {
          const placeholders = questionMarks(uniqueParticipantIds.length);
          const participants = await connection.query<{ id: unknown }>(
            `SELECT id FROM users WHERE role = 'PARTICIPANT' AND status = 'ACTIVE' AND id IN (${placeholders})`,
            uniqueParticipantIds,
          );
          if (participants.length !== uniqueParticipantIds.length) {
            throw new AcademicConflictError(
              "Roster contains an unknown or inactive participant",
            );
          }
          const conflicts = await connection.query<{ participant_id: unknown }>(
            `SELECT cm.participant_id
             FROM class_members cm
             JOIN classes c ON c.id = cm.class_id
             WHERE c.academic_year_id = ?
               AND cm.left_at IS NULL
               AND cm.class_id <> ?
               AND cm.participant_id IN (${placeholders})
             FOR UPDATE`,
            [classRecord.academicYearId, classId, ...uniqueParticipantIds],
          );
          if (conflicts.length) {
            throw new AcademicConflictError(
              "Participant already belongs to another active class in this year",
            );
          }
        }
        const desiredSet = new Set(uniqueParticipantIds);
        const currentSet = new Set(currentIds);
        const removed = currentIds.filter(
          (participantId) => !desiredSet.has(participantId),
        );
        const added = uniqueParticipantIds.filter(
          (participantId) => !currentSet.has(participantId),
        );
        if (removed.length) {
          const placeholders = questionMarks(removed.length);
          await connection.execute(
            `UPDATE class_members SET left_at = UTC_TIMESTAMP(6)
             WHERE class_id = ? AND left_at IS NULL AND participant_id IN (${placeholders})`,
            [classId, ...removed],
          );
        }
        for (const participantId of added) {
          await connection.execute(
            "INSERT INTO class_members (class_id, participant_id) VALUES (?, ?)",
            [classId, participantId],
          );
        }
        const rows = await connection.query<MemberRow>(
          `${MEMBER_COLUMNS} WHERE class_id = ? AND left_at IS NULL ORDER BY participant_id ASC`,
          [classId],
        );
        return rows.map(mapMember);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AcademicConflictError(
          "Participant membership conflicts with existing history",
        );
      }
      throw error;
    }
  }

  async listClassMembers(
    classId: Id,
    request: PageRequest,
  ): Promise<AcademicPage<ClassMember>> {
    const limit = normalizePageLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const conditions = ["class_id = ?", "left_at IS NULL"];
    const parameters: unknown[] = [classId];
    if (cursor) {
      conditions.push("id > ?");
      parameters.push(cursor);
    }
    parameters.push(limit + 1);
    const rows = await this.database.query<MemberRow>(
      `${MEMBER_COLUMNS} WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ?`,
      parameters,
    );
    return page(rows.map(mapMember), limit);
  }

  async listClassMemberProfiles(
    classId: Id,
  ): Promise<readonly ClassMemberProfile[]> {
    const rows = await this.database.query<MemberProfileRow>(
      `SELECT cm.id, cm.class_id, cm.participant_id, cm.joined_at, cm.left_at,
              u.username, u.display_name
       FROM class_members cm
       JOIN users u ON u.id = cm.participant_id
       WHERE cm.class_id = ? AND cm.left_at IS NULL
       ORDER BY cm.id ASC
       LIMIT 1501`,
      [classId],
    );
    if (rows.length > 1500)
      throw new AcademicValidationError(
        "A class roster cannot exceed 1,500 participants",
      );
    return rows.map(mapMemberProfile);
  }

  async createSubject(input: CreateSubjectInput): Promise<Subject> {
    const code = validateCode(input.code, 50, "Subject code");
    const name = validateName(input.name, 150, "Subject name");
    try {
      return await this.database.transaction(async (connection) => {
        await connection.execute(
          "INSERT INTO subjects (code, name) VALUES (?, ?)",
          [code, name],
        );
        const rows = await connection.query<SubjectRow>(
          `${SUBJECT_COLUMNS} WHERE code = ? LIMIT 1`,
          [code],
        );
        if (!rows[0]) throw new Error("Created subject could not be read back");
        return mapSubject(rows[0]);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AcademicConflictError("Subject code already exists");
      }
      throw error;
    }
  }

  async listSubjects(request: PageRequest): Promise<AcademicPage<Subject>> {
    const limit = normalizePageLimit(request.limit);
    const cursor = decodeCursor(request.cursor);
    const where = cursor ? " WHERE id > ?" : "";
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = await this.database.query<SubjectRow>(
      `${SUBJECT_COLUMNS}${where} ORDER BY id ASC LIMIT ?`,
      params,
    );
    return page(rows.map(mapSubject), limit);
  }

  async updateSubject(
    id: Id,
    input: UpdateSubjectInput,
  ): Promise<Subject | null> {
    if (input.name === undefined && input.status === undefined) {
      throw new AcademicValidationError(
        "At least one subject field must be updated",
      );
    }
    const name =
      input.name === undefined
        ? undefined
        : validateName(input.name, 150, "Subject name");
    if (input.status !== undefined) validateStatus(input.status);
    return this.database.transaction(async (connection) => {
      const current = await querySubject(connection, id, true);
      if (!current) return null;
      const assignments: string[] = [];
      const parameters: unknown[] = [];
      if (name !== undefined) {
        assignments.push("name = ?");
        parameters.push(name);
      }
      if (input.status !== undefined) {
        assignments.push("status = ?");
        parameters.push(input.status);
      }
      assignments.push("updated_at = UTC_TIMESTAMP(6)");
      await connection.execute(
        `UPDATE subjects SET ${assignments.join(", ")} WHERE id = ?`,
        [...parameters, id],
      );
      return querySubject(connection, id, false);
    });
  }

  async replaceTeacherScopes(
    teacherId: Id,
    input: ScopeInput,
  ): Promise<TeacherScope> {
    const subjectIds = uniqueIds(input.subjectIds, "subjectIds");
    const classIds = uniqueIds(input.classIds, "classIds");
    return this.database.transaction(async (connection) => {
      const teachers = await connection.query<{ id: unknown }>(
        "SELECT id FROM users WHERE id = ? AND role = 'TEACHER' AND status = 'ACTIVE' FOR UPDATE",
        [teacherId],
      );
      if (!teachers[0])
        throw new AcademicConflictError(
          "Teacher does not exist or is inactive",
        );
      if (subjectIds.length) {
        const subjects = await connection.query<{ id: unknown }>(
          `SELECT id FROM subjects WHERE status = 'ACTIVE' AND id IN (${questionMarks(subjectIds.length)}) FOR UPDATE`,
          subjectIds,
        );
        if (subjects.length !== subjectIds.length) {
          throw new AcademicConflictError(
            "Scope contains an unknown or inactive subject",
          );
        }
      }
      if (classIds.length) {
        const classes = await connection.query<{ id: unknown }>(
          `SELECT id FROM classes WHERE status = 'ACTIVE' AND id IN (${questionMarks(classIds.length)}) FOR UPDATE`,
          classIds,
        );
        if (classes.length !== classIds.length) {
          throw new AcademicConflictError(
            "Scope contains an unknown or inactive class",
          );
        }
      }
      await connection.execute(
        "DELETE FROM teacher_subjects WHERE teacher_id = ?",
        [teacherId],
      );
      await connection.execute(
        "DELETE FROM teacher_classes WHERE teacher_id = ?",
        [teacherId],
      );
      for (const subjectId of subjectIds) {
        await connection.execute(
          "INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)",
          [teacherId, subjectId],
        );
      }
      for (const classId of classIds) {
        await connection.execute(
          "INSERT INTO teacher_classes (teacher_id, class_id) VALUES (?, ?)",
          [teacherId, classId],
        );
      }
      return { teacherId, subjectIds, classIds };
    });
  }

  async getTeacherScopes(teacherId: Id): Promise<TeacherScope | null> {
    const teachers = await this.database.query<{ id: unknown }>(
      "SELECT id FROM users WHERE id = ? AND role = 'TEACHER' LIMIT 1",
      [teacherId],
    );
    if (!teachers[0]) return null;
    const subjects = await this.database.query<{ subject_id: unknown }>(
      "SELECT subject_id FROM teacher_subjects WHERE teacher_id = ? ORDER BY subject_id ASC",
      [teacherId],
    );
    const classes = await this.database.query<{ class_id: unknown }>(
      "SELECT class_id FROM teacher_classes WHERE teacher_id = ? ORDER BY class_id ASC",
      [teacherId],
    );
    return {
      teacherId,
      subjectIds: subjects.map((row) => requiredId(row.subject_id)),
      classIds: classes.map((row) => requiredId(row.class_id)),
    };
  }
}

async function queryYear(
  connection: AcademicRepositoryConnection,
  id: Id,
  lock: boolean,
): Promise<AcademicYear | null> {
  const rows = await connection.query<AcademicYearRow>(
    `${YEAR_COLUMNS} WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? mapAcademicYear(rows[0]) : null;
}

async function queryClass(
  connection: AcademicRepositoryConnection,
  id: Id,
  lock: boolean,
): Promise<ClassRecord | null> {
  const rows = await connection.query<ClassRow>(
    `${CLASS_COLUMNS} WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? mapClass(rows[0]) : null;
}

async function querySubject(
  connection: AcademicRepositoryConnection,
  id: Id,
  lock: boolean,
): Promise<Subject | null> {
  const rows = await connection.query<SubjectRow>(
    `${SUBJECT_COLUMNS} WHERE id = ? LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return rows[0] ? mapSubject(rows[0]) : null;
}

function page<T extends { id: Id }>(
  items: readonly T[],
  limit: number,
): CursorPage<T> {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  const last = visible.at(-1);
  return {
    items: visible,
    nextCursor: hasMore ? (last?.id ?? null) : null,
  };
}

function questionMarks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function requiredId(value: unknown): Id {
  if (typeof value === "bigint") return formatId(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return formatId(BigInt(value));
  }
  const id = parseId(value);
  if (!id) throw new Error("Database returned an invalid ID");
  return id;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new Error(`Database returned an invalid ${field}`);
  return value;
}

function requiredDate(value: unknown, field: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return validateDate(requiredString(value, field), field);
}

function requiredTimestamp(value: unknown): UtcTimestamp {
  if (value instanceof Date) return formatUtcTimestamp(value);
  if (typeof value === "string") {
    const normalized = value.endsWith("Z")
      ? value
      : `${value.replace(" ", "T")}Z`;
    const timestamp = parseUtcTimestamp(normalized);
    if (timestamp) return timestamp;
  }
  throw new Error("Database returned an invalid timestamp");
}

function nullableTimestamp(value: unknown): UtcTimestamp | null {
  return value === null || value === undefined
    ? null
    : requiredTimestamp(value);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function mapAcademicYear(row: AcademicYearRow): AcademicYear {
  return {
    id: requiredId(row.id),
    name: requiredString(row.name, "academic year name"),
    startsOn: requiredDate(row.starts_on, "startsOn"),
    endsOn: requiredDate(row.ends_on, "endsOn"),
    isActive: toBoolean(row.is_active),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapClass(row: ClassRow): ClassRecord {
  const status = requiredString(row.status, "class status");
  validateStatus(status);
  return {
    id: requiredId(row.id),
    academicYearId: requiredId(row.academic_year_id),
    code: requiredString(row.code, "class code"),
    name: requiredString(row.name, "class name"),
    status,
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function mapMember(row: MemberRow): ClassMember {
  return {
    id: requiredId(row.id),
    classId: requiredId(row.class_id),
    participantId: requiredId(row.participant_id),
    joinedAt: requiredTimestamp(row.joined_at),
    leftAt: nullableTimestamp(row.left_at),
  };
}

function mapMemberProfile(row: MemberProfileRow): ClassMemberProfile {
  return {
    ...mapMember(row),
    username: requiredString(row.username, "participant username"),
    displayName: requiredString(row.display_name, "participant display name"),
  };
}

function mapSubject(row: SubjectRow): Subject {
  const status = requiredString(row.status, "subject status");
  validateStatus(status);
  return {
    id: requiredId(row.id),
    code: requiredString(row.code, "subject code"),
    name: requiredString(row.name, "subject name"),
    status,
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown } | null;
  const code = String(candidate?.code ?? candidate?.errno ?? "");
  return code === "ER_DUP_ENTRY" || code === "1062";
}
