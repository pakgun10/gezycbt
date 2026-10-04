import { describe, expect, test } from "bun:test";
import type { Id } from "@gezycbt/contracts";
import type { DatabasePort } from "@gezycbt/database";
import { ParticipantMediaService } from "./participant-serving";

describe("participant media authorization", () => {
  test("binds the requested asset ID before session access predicates", async () => {
    let parameters: readonly unknown[] | undefined;
    let sql = "";
    const database = {
      query: async (query: string, values?: readonly unknown[]) => {
        sql = query;
        parameters = values;
        return [
          {
            id: 42n,
            storage_key: `media/${"a".repeat(24)}`,
            mime_type: "image/png",
          },
        ];
      },
    } as unknown as DatabasePort;
    const service = new ParticipantMediaService(database);

    const result = await service.authorize("42" as Id, {
      participantId: "7" as Id,
    });

    expect(result?.id).toBe("42" as Id);
    expect(parameters?.[0]).toBe("42");
    expect(parameters).toHaveLength(9);
    expect(sql).toContain("p.`usage` IN ('STIMULUS', 'PROMPT', 'OPTION', 'STATEMENT')");
    expect(sql).toContain("legacy.`usage` IN ('STIMULUS', 'PROMPT', 'OPTION', 'STATEMENT')");
  });
});
