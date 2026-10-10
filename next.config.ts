import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import { assertBuildRuntime } from "./scripts/pivot-build-runtime";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const allowedDevOrigins = [
  "localhost",
  "127.0.0.1",
  ...(process.env.PIVOT_ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
];

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
    "node-pty",
  ],
  allowedDevOrigins,
  // Attachment uploads (multipart) can reach ~10 MiB of file data plus
  // multipart overhead; the default 10 MB proxy body cap would truncate them.
  experimental: {
    proxyClientMaxBodySize: "25mb",
    // TS7 has no classic JS compiler API; use Next's native CLI path.
    useTypeScriptCli: true,
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default function configureNext(phase: string): NextConfig {
  // Also protect direct `next start` users, including the WinSW service.
  if (phase === PHASE_PRODUCTION_SERVER) assertBuildRuntime(__dirname);
  return nextConfig;
}
