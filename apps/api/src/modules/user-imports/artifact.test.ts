import { describe, expect, test } from "bun:test";
import { createAesGcmCredentialArtifactCipher } from "./artifact";

describe("credential artifact cipher", () => {
  test("seals and opens credentials without storing plaintext in the payload", async () => {
    const cipher = createAesGcmCredentialArtifactCipher(
      new TextEncoder().encode("test-artifact-key"),
    );
    const rows = [
      {
        username: "participant-1",
        displayName: "Participant One",
        temporaryPassword: "temporary-secret",
      },
    ];
    const encrypted = await cipher.seal(rows);
    expect(new TextDecoder().decode(encrypted)).not.toContain(
      "temporary-secret",
    );
    await expect(cipher.open(encrypted)).resolves.toEqual(rows);
  });
});
