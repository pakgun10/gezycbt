import {
  type CredentialArtifactCipher,
  type CredentialArtifactRow,
  ImportValidationError,
} from "./domain";

const VERSION = 1;
const IV_LENGTH = 12;

export function createAesGcmCredentialArtifactCipher(
  secret: Uint8Array,
): CredentialArtifactCipher {
  let keyPromise: Promise<CryptoKey> | undefined;
  const key = async (): Promise<CryptoKey> => {
    keyPromise ??= deriveKey(secret);
    return keyPromise;
  };
  return {
    async seal(rows) {
      const iv = new Uint8Array(IV_LENGTH);
      crypto.getRandomValues(iv);
      const plaintext = new TextEncoder().encode(JSON.stringify(rows));
      const encrypted = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          await key(),
          plaintext,
        ),
      );
      const output = new Uint8Array(1 + iv.length + encrypted.length);
      output[0] = VERSION;
      output.set(iv, 1);
      output.set(encrypted, 1 + iv.length);
      return output;
    },
    async open(payload) {
      if (payload.length <= 1 + IV_LENGTH || payload[0] !== VERSION) {
        throw new ImportValidationError(
          "Credential artifact payload is invalid",
        );
      }
      const iv = payload.slice(1, 1 + IV_LENGTH);
      const ciphertext = payload.slice(1 + IV_LENGTH);
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv },
          await key(),
          ciphertext,
        );
        return parseRows(new TextDecoder().decode(plaintext));
      } catch {
        throw new ImportValidationError(
          "Credential artifact could not be opened",
        );
      }
    },
  };
}

async function deriveKey(secret: Uint8Array): Promise<CryptoKey> {
  const copy = new Uint8Array(secret.byteLength);
  copy.set(secret);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function parseRows(value: string): readonly CredentialArtifactRow[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new ImportValidationError("Credential artifact payload is invalid");
  }
  return parsed.map((row) => {
    if (!row || typeof row !== "object") {
      throw new ImportValidationError("Credential artifact payload is invalid");
    }
    const candidate = row as Record<string, unknown>;
    if (
      typeof candidate.username !== "string" ||
      typeof candidate.displayName !== "string" ||
      typeof candidate.temporaryPassword !== "string"
    ) {
      throw new ImportValidationError("Credential artifact payload is invalid");
    }
    return {
      username: candidate.username,
      displayName: candidate.displayName,
      temporaryPassword: candidate.temporaryPassword,
    };
  });
}
