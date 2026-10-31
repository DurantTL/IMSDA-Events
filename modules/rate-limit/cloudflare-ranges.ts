import { BlockList, isIP } from "node:net";

/**
 * Cloudflare's published IP ranges, copied by hand on 2026-10-31 from https://www.cloudflare.com/ips-v4 and
 * https://www.cloudflare.com/ips-v6 (#1397). There is no network fetch: when Cloudflare changes the lists, update
 * these two arrays. Used only to warn a system admin that the app is seeing Cloudflare's address, not the visitor's.
 */
export const CLOUDFLARE_IPV4_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

export const CLOUDFLARE_IPV6_RANGES = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;

function buildBlockList() {
  const list = new BlockList();
  for (const range of CLOUDFLARE_IPV4_RANGES) {
    const [network, prefix] = range.split("/");
    list.addSubnet(network, Number(prefix), "ipv4");
  }
  for (const range of CLOUDFLARE_IPV6_RANGES) {
    const [network, prefix] = range.split("/");
    list.addSubnet(network, Number(prefix), "ipv6");
  }
  return list;
}

const cloudflareRanges = buildBlockList();

/** True when the address is inside Cloudflare's published ranges. IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked as IPv4. */
export function isCloudflareAddress(ip: string | null | undefined) {
  if (!ip) return false;
  let candidate = ip.trim().toLowerCase();
  if (candidate.startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);
  const family = isIP(candidate);
  if (family === 0) return false;
  return cloudflareRanges.check(candidate, family === 4 ? "ipv4" : "ipv6");
}
