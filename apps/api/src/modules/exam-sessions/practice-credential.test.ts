import { describe, expect, test } from "bun:test";
import {
  createPracticeCredential,
  digestPracticeCredential,
  readPracticeCredential,
  serializePracticeCookie,
} from "./practice-credential";

describe("isolated practice credential", () => {
  test("creates a host-only cookie and only exposes a digest to persistence", async () => {
    const credential = await createPracticeCredential(
      "10" as never,
      "a".repeat(43),
    );
    expect(credential.cookie).toContain("__Host-gezycbt-practice=");
    expect(credential.cookie).toContain("HttpOnly");
    expect(readPracticeCredential(credential.cookie)).toBe("a".repeat(43));
    expect(Buffer.from(credential.digest).toString("hex")).toHaveLength(64);
  });

  test("rejects malformed tokens and does not accept a login cookie", async () => {
    await expect(digestPracticeCredential("short")).rejects.toThrow();
    expect(readPracticeCredential("__Host-gezycbt-auth=abc")).toBeNull();
    expect(() => serializePracticeCookie("short")).toThrow();
  });
});
