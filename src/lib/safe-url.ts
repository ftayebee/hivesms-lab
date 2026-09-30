import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";

/**
 * SSRF protection for customer-supplied URLs (webhooks). Rejects non-HTTPS URLs (except
 * localhost in development), credentials in URLs, and hosts that resolve to private, loopback,
 * link-local or otherwise internal addresses.
 */
function isPrivateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string) {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? isPrivateIPv4(mapped[1]) : false;
}

export function isPrivateAddress(ip: string) {
  return isIP(ip) === 4 ? isPrivateIPv4(ip) : isIP(ip) === 6 ? isPrivateIPv6(ip) : true;
}

const devAllowsLocal = () => process.env.NODE_ENV !== "production";

/** Static checks (no DNS) for form validation. */
export function assertAcceptableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Enter a valid URL.", { field: "url" });
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(devAllowsLocal() && local && url.protocol === "http:")) {
    throw new AppError("VALIDATION_ERROR", "Webhook URLs must use HTTPS.", { field: "url" });
  }
  if (url.username || url.password) throw new AppError("VALIDATION_ERROR", "Do not include credentials in the URL.", { field: "url" });
  if (!(devAllowsLocal() && local) && isIP(url.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new AppError("VALIDATION_ERROR", "Private and internal addresses are not allowed.", { field: "url" });
  }
  return url;
}

/** Full check including DNS resolution; call right before making the request. */
export async function assertPublicDestination(raw: string) {
  const url = assertAcceptableUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (devAllowsLocal() && (host === "localhost" || host === "127.0.0.1")) return url;
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new AppError("VALIDATION_ERROR", "The webhook host resolves to a private or internal address.", { field: "url" });
  }
  return url;
}
