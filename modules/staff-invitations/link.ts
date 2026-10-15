import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A personal invitation link is derived, never stored (#804): `<invitation id>.<signature>`, where the signature is an HMAC of
 * the id and the invitation's `linkVersion` under the private-link secret (the one that already derives registration manage
 * links, `MANAGE_LINK_DERIVATION_SECRET`, with its rotation partner). So the office can copy the same link again later, a
 * reissue (which bumps `linkVersion`) makes every earlier copy fail, and a database dump holds no usable link.
 *
 * The namespace below keeps these signatures from ever being confused with a manage link's, which share the secret.
 */

const NAMESPACE = "imsda:staff-invite:v1:";
const LOCAL_SECRET = "imsda-events-local-registration-link-secret-2026";
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function secrets() {
  const current = process.env.MANAGE_LINK_DERIVATION_SECRET?.trim();
  const previous = process.env.MANAGE_LINK_DERIVATION_SECRET_PREVIOUS?.trim();
  if (previous && previous.length < 32) {
    throw new Error("MANAGE_LINK_DERIVATION_SECRET_PREVIOUS must contain at least 32 characters when configured.");
  }
  if (current && current.length >= 32) return [...new Set([current, ...(previous ? [previous] : [])])];
  if (process.env.NODE_ENV === "production") {
    throw new Error("MANAGE_LINK_DERIVATION_SECRET must contain at least 32 characters before personal invitation links can be made.");
  }
  return [LOCAL_SECRET];
}

function sign(id: string, linkVersion: number, secret: string) {
  return createHmac("sha256", secret).update(`${NAMESPACE}${id}:${linkVersion}`).digest("base64url");
}

/** The link's token for an invitation at its current link version. */
export function invitationToken(invitation: { id: string; linkVersion: number }) {
  return `${invitation.id}.${sign(invitation.id, invitation.linkVersion, secrets()[0])}`;
}

/** The id a token names, or null when it is not shaped like one. Says nothing about whether the token is genuine. */
export function invitationIdFromToken(token: string) {
  const [id, signature, ...rest] = token.split(".");
  if (rest.length > 0 || !id || !signature || !ID_PATTERN.test(id) || !SIGNATURE_PATTERN.test(signature)) return null;
  return id;
}

/** Whether `token` is the genuine link for this invitation at its current link version. */
export function invitationTokenMatches(token: string, invitation: { id: string; linkVersion: number }) {
  if (invitationIdFromToken(token) !== invitation.id) return false;
  const candidate = Buffer.from(token.slice(invitation.id.length + 1), "base64url");
  return secrets().some((secret) => {
    const expected = Buffer.from(sign(invitation.id, invitation.linkVersion, secret), "base64url");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
