import { lookup as dnsLookup } from "dns/promises";
import { BlockList, isIP } from "net";

const MAX_REDIRECTS = 5;

const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addSubnet("198.18.0.0", 15, "ipv4");
PRIVATE.addSubnet("224.0.0.0", 4, "ipv4");
PRIVATE.addSubnet("240.0.0.0", 4, "ipv4");
PRIVATE.addAddress("255.255.255.255", "ipv4");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");
PRIVATE.addSubnet("ff00::", 8, "ipv6");

export type ResolveAddresses = (hostname: string) => Promise<string[]>;

/** Strip IPv6 brackets and trailing dots (`localhost.` → `localhost`). */
export function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return host.replace(/\.+$/, "");
}

export function isBlockedIp(ip: string): boolean {
  const address = normalizeHostname(ip);
  const family = isIP(address);
  if (family === 4) return PRIVATE.check(address, "ipv4");
  if (family === 6) return PRIVATE.check(address, "ipv6");
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".corp")) {
    return true;
  }
  if (host === "metadata" || host === "instance-data") return true;
  if (isIP(host) && isBlockedIp(host)) return true;
  return false;
}

export async function defaultResolve(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
}

/**
 * Throws if `url` is not a fetchable http(s) target. Resolves DNS and rejects
 * when any address is loopback, private, link-local, or metadata.
 */
export async function assertSafeUrl(
  url: string,
  resolve: ResolveAddresses = defaultResolve
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL must not include credentials");
  }
  const host = normalizeHostname(parsed.hostname);
  if (!host) throw new Error("Invalid URL");
  if (isBlockedHostname(host)) {
    throw new Error("URL targets a private or internal address");
  }
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new Error("Could not resolve URL hostname");
  }
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new Error("URL targets a private or internal address");
  }
  return parsed;
}

/** Resolve a redirect Location against the current URL. */
export function redirectUrl(current: string, location: string): string {
  return new URL(location, current).href;
}

/**
 * fetch() that re-validates every redirect hop (Node's default `follow`
 * would skip assertSafeUrl on the Location target).
 */
export async function fetchFollowingSafeRedirects(
  url: string,
  init: RequestInit = {},
  resolve: ResolveAddresses = defaultResolve
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(current, resolve);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = redirectUrl(current, location);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
