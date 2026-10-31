import { SQUARE_APPLE_PAY_ASSOCIATION_URL as squareAssociationFile } from "@/modules/payments/apple-pay-association";

/**
 * Apple verifies the public payment-page domain through this extensionless
 * path. Square owns and rotates the association payload, so serve its current
 * file instead of letting a checked-in certificate silently go stale.
 */
export async function GET() {
  let response: Response;
  try {
    response = await fetch(squareAssociationFile, {
      next: { revalidate: 86_400 },
    });
  } catch {
    return new Response("Apple Pay domain association is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (!response.ok) {
    return new Response("Apple Pay domain association is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(await response.text(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
