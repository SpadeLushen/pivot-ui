import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveDependencyRoot } from "../scripts/pivot-runtime-aliases.js";

/** Private dist entry points in the pinned SDK; resolve hoisted and pnpm installs too. */
export function piSdkModulePath(file: string): string {
  const root = resolveDependencyRoot(process.cwd(), "@earendil-works/pi-coding-agent");
  if (!root) throw new Error("Installed pi SDK could not be located");
  return join(root, "dist", file);
}
export function piSdkModule<T>(file: string): T {
  return createRequire(join(process.cwd(), "package.json"))(piSdkModulePath(file)) as T;
}
