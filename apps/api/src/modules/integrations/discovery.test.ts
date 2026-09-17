import { expect, test } from "bun:test";
import type { Id, UtcTimestamp } from "@gezycbt/contracts";
import {
  type DiscoveryAccess,
  type DiscoveryPage,
  type DiscoverySubject,
  SqlIntegrationDiscoveryRepository,
} from "./discovery";
import type { IntegrationAuthentication } from "./domain";
import { IntegrationCapabilityError } from "./domain";
import type { IntegrationRepository } from "./repository";
import { IntegrationService } from "./service";

const NOW = "2026-09-17T00:00:00.000Z" as UtcTimestamp;

function adminAuthentication(
  capability = "subjects.read",
): IntegrationAuthentication {
  return {
    client: {
      id: "10" as Id,
      name: "Discovery agent",
      platformHint: "HIVEKEEP",
      ownerUserId: "1" as Id,
      ownerDisplayName: "Admin",
      ownerRole: "ADMIN",
      status: "ACTIVE",
      description: null,
      policyVersion: 3,
      createdByUserId: "1" as Id,
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    credential: {
      id: "11" as Id,
      integrationClientId: "10" as Id,
      tokenPrefix: "discovery",
      status: "ACTIVE",
      validFrom: NOW,
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      revokeReason: null,
      createdAt: NOW,
    },
    grants: [
      {
        id: "12" as Id,
        integrationClientId: "10" as Id,
        capability,
        scopeType: "SCHOOL",
        scopeIds: [],
        constraints: {},
        grantVersion: 3,
        status: "ACTIVE",
        validFrom: NOW,
        expiresAt: null,
        issuedByUserId: "1" as Id,
        revokedAt: null,
        revokeReason: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
}

function subject(id: string): DiscoverySubject {
  return {
    id: id as Id,
    code: `S-${id}`,
    name: `Subject ${id}`,
    status: "ACTIVE",
  };
}

test("discovery marks multiple candidates as ambiguous and leaves one selectable", async () => {
  let returned: DiscoveryPage<DiscoverySubject> = {
    items: [subject("7")],
    nextCursor: null,
  };
  const seenAccess: { value?: DiscoveryAccess } = {};
  const discovery = {
    async searchSubjects(_query: unknown, access: DiscoveryAccess) {
      seenAccess.value = access;
      return returned;
    },
  } as unknown as import("./discovery").IntegrationDiscoveryRepository;
  const service = new IntegrationService({} as IntegrationRepository, {
    discovery,
  });
  const single = await service.searchSubjects(adminAuthentication(), {
    limit: 20,
  });
  expect(single.ambiguity).toBeNull();
  if (!seenAccess.value) throw new Error("Discovery access was not captured");
  expect(seenAccess.value.grants[0]?.capability).toBe("subjects.read");

  returned = { items: [subject("7"), subject("9")], nextCursor: null };
  const ambiguous = await service.searchSubjects(adminAuthentication(), {
    q: "subject",
    limit: 20,
  });
  expect(ambiguous.ambiguity).toEqual({
    code: "AMBIGUOUS_RESOURCE",
    resourceType: "subjects",
    candidateCount: 2,
    requiresSelection: true,
  });
});

test("discovery refuses a resource when its capability is absent", async () => {
  const discovery = {
    async searchSubjects() {
      throw new Error("must not query without capability");
    },
  } as unknown as import("./discovery").IntegrationDiscoveryRepository;
  const service = new IntegrationService({} as IntegrationRepository, {
    discovery,
  });
  await expect(
    service.searchSubjects(adminAuthentication("classes.read"), { limit: 20 }),
  ).rejects.toBeInstanceOf(IntegrationCapabilityError);
});

test("SQL discovery is bounded to 20 candidates and applies school scope", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: BigInt(index + 1),
    code: `S-${index + 1}`,
    name: `Subject ${index + 1}`,
    status: "ACTIVE",
  }));
  let statement = "";
  let parameters: readonly unknown[] = [];
  const repository = new SqlIntegrationDiscoveryRepository({
    async query<T extends Record<string, unknown>>(
      sql: string,
      values?: readonly unknown[],
    ) {
      statement = sql;
      parameters = values ?? [];
      return rows as unknown as readonly T[];
    },
  });
  const page = await repository.searchSubjects(
    { limit: 20 },
    {
      ownerUserId: "1" as Id,
      ownerRole: "ADMIN",
      teacherSubjectIds: [],
      teacherClassIds: [],
      grants: [requiredGrant(adminAuthentication())],
    },
  );
  expect(page.items).toHaveLength(20);
  expect(page.nextCursor).toBe("21" as Id);
  expect(statement).toContain("LIMIT ?");
  expect(statement).toContain("1 = 1");
  expect(parameters.at(-1)).toBe(21);
});

test("teacher discovery keeps owner and subject scope in SQL and never selects answer keys", async () => {
  let statement = "";
  const repository = new SqlIntegrationDiscoveryRepository({
    async query<T extends Record<string, unknown>>(
      sql: string,
    ): Promise<readonly T[]> {
      statement = sql;
      return [
        {
          id: 70n,
          question_id: 7n,
          question_bank_id: 6n,
          subject_id: 5n,
          owner_teacher_id: 42n,
          bank_name: "Algebra",
          type: "SINGLE_CHOICE",
          revision_no: 1,
          status: "PUBLISHED",
          question_status: "ACTIVE",
          label: "2 + 2",
          updated_at: "2026-09-17 00:00:00.000000",
        },
      ] as unknown as readonly T[];
    },
  });
  const grant = {
    ...requiredGrant(adminAuthentication("questions.read")),
    scopeType: "SUBJECT" as const,
    scopeIds: ["5" as Id],
  };
  const page = await repository.searchQuestions(
    { limit: 20 },
    {
      ownerUserId: "42" as Id,
      ownerRole: "TEACHER",
      teacherSubjectIds: ["5" as Id],
      teacherClassIds: [],
      grants: [grant],
    },
  );
  expect(page.items[0]).toMatchObject({ id: "70", subjectId: "5" });
  expect(JSON.stringify(page.items[0])).not.toContain("answer");
  expect(statement).toContain("qb.owner_teacher_id = ?");
  expect(statement).toContain("qb.subject_id IN (?)");
  expect(statement).not.toContain("is_correct");
});

function requiredGrant(authentication: IntegrationAuthentication) {
  const grant = authentication.grants[0];
  if (!grant) throw new Error("Expected test grant");
  return grant;
}
