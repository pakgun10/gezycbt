import { describe, expect, test } from "bun:test";
import type { CursorPage, Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  AcademicMasterService,
  AcademicNotFoundError,
  type AcademicRepository,
  type AcademicYear,
  type ClassMember,
  type ClassRecord,
  type Subject,
  type TeacherScope,
} from "./index";

const actorId = "1" as Id;
const resourceId = "2" as Id;
const page: CursorPage<AcademicYear> = { items: [], nextCursor: null };

function repository(): AcademicRepository & { readonly calls: string[] } {
  const calls: string[] = [];
  const year: AcademicYear = {
    id: resourceId,
    name: "2026/2027",
    startsOn: "2026-07-01",
    endsOn: "2027-06-30",
    isActive: true,
    createdAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
    updatedAt: "2026-09-17T01:00:00.000Z" as UtcTimestamp,
  };
  return {
    calls,
    async createAcademicYear() {
      calls.push("createYear");
      return year;
    },
    async listAcademicYears() {
      calls.push("listYears");
      return page;
    },
    async setAcademicYearActive(id) {
      calls.push(`activateYear:${id}`);
      return id === resourceId ? year : null;
    },
    async createClass(input) {
      calls.push(`createClass:${input.code}`);
      return {
        id: resourceId,
        academicYearId: input.academicYearId,
        code: input.code,
        name: input.name,
        status: "ACTIVE",
        createdAt: year.createdAt,
        updatedAt: year.updatedAt,
      } satisfies ClassRecord;
    },
    async listClasses() {
      return { items: [], nextCursor: null };
    },
    async updateClass() {
      return null;
    },
    async replaceClassMembers() {
      return [] satisfies readonly ClassMember[];
    },
    async listClassMembers() {
      return { items: [], nextCursor: null };
    },
    async createSubject(input) {
      return {
        id: resourceId,
        code: input.code,
        name: input.name,
        status: "ACTIVE",
        createdAt: year.createdAt,
        updatedAt: year.updatedAt,
      } satisfies Subject;
    },
    async listSubjects() {
      return { items: [], nextCursor: null };
    },
    async updateSubject() {
      return null;
    },
    async replaceTeacherScopes(teacherId, input) {
      return { teacherId, ...input } satisfies TeacherScope;
    },
    async getTeacherScopes() {
      return null;
    },
  };
}

const readContext = {
  actor: {
    actorType: "HUMAN" as const,
    userId: actorId,
    requestId: "academic-read",
  },
};
const mutationContext = {
  ...readContext,
  idempotencyKey: "academic-mutation-1",
};

describe("AcademicMasterService", () => {
  test("keeps reads paginated and passes the actor boundary", async () => {
    const repo = repository();
    const service = new AcademicMasterService(repo);
    const result = await service.listAcademicYears(readContext, { limit: 25 });

    expect(result).toEqual(page);
    expect(repo.calls).toEqual(["listYears"]);
  });

  test("requires idempotency for mutations and activates a known year", async () => {
    const repo = repository();
    const service = new AcademicMasterService(repo);
    expect(
      service.createAcademicYear(readContext, {
        name: "2027/2028",
        startsOn: "2027-07-01",
        endsOn: "2028-06-30",
      }),
    ).rejects.toThrow("idempotency");

    const result = await service.activateAcademicYear(
      mutationContext,
      resourceId,
    );
    expect(result.id).toBe(resourceId);
    expect(repo.calls).toEqual(["activateYear:2"]);
  });

  test("turns a missing academic resource into a domain not-found error", async () => {
    const service = new AcademicMasterService(repository());
    expect(
      service.activateAcademicYear(mutationContext, "99" as Id),
    ).rejects.toBeInstanceOf(AcademicNotFoundError);
  });
});
