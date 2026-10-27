import { randomBytes, scryptSync } from "node:crypto";

/**
 * A stored password hash in the production format but at a tiny scrypt cost.
 * `verifyPassword` reads N, r and p from the stored hash, so it checks this one
 * exactly as it checks a real one. Production hashes use N=131072 (about 128 MB
 * and a second or more of CPU each), which contends badly when tests run in
 * parallel; tests that only need "a hash this password verifies against" should
 * use this instead of `hashPassword`.
 */
export function lowCostPasswordHash(password: string): string {
  const n = 1024;
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: n, r: 8, p: 1 });
  return ["scrypt", n, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}
