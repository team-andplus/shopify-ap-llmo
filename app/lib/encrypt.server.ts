/**
 * OpenAI API Key 等を DB に保存する際の暗号化／復号。
 * OPENAI_ENCRYPTION_SECRET（32文字以上）または SHOPIFY_API_SECRET から鍵を導出。
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SALT = "llmo-openai-v1";

function getKey(): Buffer {
  const secret = process.env.OPENAI_ENCRYPTION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error("OPENAI_ENCRYPTION_SECRET or SHOPIFY_API_SECRET is required for encryption");
  }
  if (secret.length >= KEY_LEN) {
    return Buffer.from(secret.slice(0, KEY_LEN), "utf8");
  }
  return scryptSync(secret, SALT, KEY_LEN);
}

/**
 * 平文を暗号化し、iv + ciphertext + tag を base64 で返す。
 */
export function encrypt(plain: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

/**
 * base64 の暗号文を復号して平文を返す。
 */
export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted value");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}
