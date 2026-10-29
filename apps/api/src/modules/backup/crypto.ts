import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Passphrase encryption for the backup file.
 *
 * The ZIP container is encrypted as a whole with AES-256-GCM; the key is
 * derived with scrypt from the admin-chosen passphrase and a random salt.
 * This deliberately does NOT use legacy ZipCrypto: its encryption is weak
 * and a `zip -P` passphrase would also leak through process listings.
 *
 * Layout: magic "GZYBK001" (8 bytes) || salt (16) || iv (12) || tag (16)
 * || ciphertext. A wrong passphrase or any tampering fails authentication
 * in GCM and is reported as one indistinguishable error, so the caller
 * cannot tell which of the two happened.
 */
const MAGIC = Buffer.from("GZYBK001", "ascii");

export function encryptBackup(
  passphrase: string,
  plaintext: Uint8Array,
): Uint8Array {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

export function decryptBackup(
  passphrase: string,
  encrypted: Uint8Array,
): Uint8Array {
  const buffer = Buffer.from(encrypted);
  if (
    buffer.byteLength <= MAGIC.byteLength + 16 + 12 + 16 ||
    !buffer.subarray(0, MAGIC.byteLength).equals(MAGIC)
  )
    throw new Error("Not a GezyCBT backup file");
  const salt = buffer.subarray(8, 24);
  const iv = buffer.subarray(24, 36);
  const tag = buffer.subarray(36, 52);
  const ciphertext = buffer.subarray(52);
  const key = scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Wrong passphrase or corrupted backup file");
  }
}
