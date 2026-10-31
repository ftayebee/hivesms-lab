import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers for every response. The Content-Security-Policy is intentionally strict:
 * no third-party scripts are loaded by the app. 'unsafe-inline' for scripts is required by the
 * pre-paint theme script and Next.js inline bootstrap; switch to nonces via proxy.ts if you add
 * stricter requirements.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://sandbox.sslcommerz.com https://securepay.sslcommerz.com",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // `next build` type-checks the app only; tests and test tooling need devDependencies, which
  // production installs omit. `npm run typecheck` still checks everything via tsconfig.json.
  typescript: { tsconfigPath: "tsconfig.build.json" },
  serverExternalPackages: ["pino", "pino-pretty", "@node-rs/argon2", "mariadb"],
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
    // CSV imports (10 MB) and sender ID documents (3 × 5 MB) are uploaded through server actions.
    serverActions: { bodySizeLimit: "16mb" },
    // proxy.ts buffers request bodies on matched routes; keep this at or above the action limit.
    proxyClientMaxBodySize: "16mb",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
