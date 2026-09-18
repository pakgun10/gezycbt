import { describe, expect, test } from "bun:test";
import { agentActionsMigration } from "./0020_agent_actions";
import { migrations } from "./index";

describe("agent action migration", () => {
  test("creates durable action and approval tables with bounded states", () => {
    expect(agentActionsMigration.id).toBe("0020_agent_actions");
    expect(agentActionsMigration.statements).toHaveLength(2);
    expect(agentActionsMigration.statements[0]).toContain(
      "CREATE TABLE agent_action_requests",
    );
    expect(agentActionsMigration.statements[0]).toContain(
      "idx_agent_action_requests_status_expiry",
    );
    expect(agentActionsMigration.statements[1]).toContain(
      "CREATE TABLE agent_action_approvals",
    );
    expect(migrations.at(-1)).toBe(agentActionsMigration);
  });
});
