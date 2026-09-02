/**
 * SSRF guard for the AI proxy routes.
 *
 * The route handlers forward to a base URL supplied by the browser, so without
 * a guard the app would be an open relay into whatever network the Next server
 * can reach. Only local and tailnet destinations are allowed by default.
 *
 * Set AI_ALLOWED_HOSTS (comma-separated hostnames) to permit anything else.
 */

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^169\.254\./, // link-local
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./ // CGNAT 100.64.0.0/10 — Tailscale
];

const LOCAL_HOSTNAME_SUFFIXES = [".ts.net", ".local", ".internal", ".localdomain"];

function envAllowedHosts(): string[] {
  return (process.env.AI_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

function isIpv4(hostname: string): boolean {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  // fc00::/7 unique-local and fe80::/10 link-local
  return /^f[cd][0-9a-f]{2}:/.test(normalized) || /^fe[89ab][0-9a-f]:/.test(normalized);
}

export interface AllowlistResult {
  allowed: boolean;
  reason: string;
}

export function isAllowedAiHost(rawUrl: string): AllowlistResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "Base URL is not a valid absolute URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `Unsupported protocol "${url.protocol}". Use http or https.` };
  }

  const hostname = url.hostname.toLowerCase();

  if (envAllowedHosts().includes(hostname)) {
    return { allowed: true, reason: "Host is listed in AI_ALLOWED_HOSTS." };
  }

  if (hostname === "localhost" || hostname === "0.0.0.0") {
    return { allowed: true, reason: "Loopback host." };
  }

  if (isIpv4(hostname)) {
    if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname))) {
      return { allowed: true, reason: "Private or tailnet IPv4 address." };
    }
    return {
      allowed: false,
      reason: `Refusing to proxy to public address ${hostname}. Add it to AI_ALLOWED_HOSTS if this is intentional.`
    };
  }

  if (hostname.includes(":") || hostname.startsWith("[")) {
    if (isPrivateIpv6(hostname)) {
      return { allowed: true, reason: "Private or link-local IPv6 address." };
    }
    return {
      allowed: false,
      reason: `Refusing to proxy to public IPv6 address ${hostname}. Add it to AI_ALLOWED_HOSTS if this is intentional.`
    };
  }

  if (LOCAL_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { allowed: true, reason: "Local or tailnet hostname." };
  }

  return {
    allowed: false,
    reason: `Host "${hostname}" is not a local, private, or tailnet address. Add it to AI_ALLOWED_HOSTS to allow it.`
  };
}

export function defaultBaseUrl(): string {
  return process.env.AI_DEFAULT_BASE_URL?.trim() || "http://localhost:11434";
}
