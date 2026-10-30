import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for secrets kept in the database (AES-256-GCM). Each value is bound to
 * a context string (for example the owner of a token), so a sealed value copied to another row,
 * or tampered with, fails to open instead of yielding a secret.
 *
 * Sealed form: `v1.<iv>.<tag>.<ciphertext>`, base64url. The prefix leaves room for a new key or
 * algorithm later without guessing which one sealed an old value.
 */
export type SecretBox = {
  seal(plaintext: string, context: string): string;
  /** Throws when the value was not sealed with this key and context, or was altered. */
  open(sealed: string, context: string): string;
};

const VERSION = "v1";
const KEY_BYTES = 32;

/** Decodes a base64 key of exactly 32 bytes (`openssl rand -base64 32`); undefined when invalid. */
export function parseSecretKey(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return undefined;
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES ? key : undefined;
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) throw new Error("The secret key must be 32 bytes");
  return {
    seal(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), body].map(encode).join(".");
    },
    open(sealed, context) {
      const [version, iv, tag, body, extra] = sealed.split(".");
      if (version !== VERSION || !iv || !tag || !body || extra !== undefined) {
        throw new Error("Unrecognised sealed value");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

function encode(part: string | Buffer): string {
  return typeof part === "string" ? part : part.toString("base64url");
}
