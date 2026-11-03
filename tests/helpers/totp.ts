import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text: string): Buffer {
  let bits = "";
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The six-digit code an authenticator app shows for an otpauth:// URI (RFC 6238, SHA-1, 30 s). */
export function totpFromUri(uri: string, at: Date = new Date()): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("No secret in the otpauth URI");
  return totpFromKey(base32Decode(secret), at);
}

/** The same code from a secret as stored: the plugin treats the secret string's bytes as the key. */
export function totpFromSecret(secret: string, at: Date = new Date()): string {
  return totpFromKey(Buffer.from(secret, "utf8"), at);
}

function totpFromKey(key: Buffer, at: Date): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

/** The code for a setup key as the security page shows it (base32). */
export function totpFromBase32Key(key: string, at: Date = new Date()): string {
  return totpFromKey(base32Decode(key), at);
}
