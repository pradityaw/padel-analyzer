import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

/**
 * Repo root whether the entry file is `server/_core/*.ts` (dev) or `dist/index.js` (prod bundle).
 */
export function resolveProjectRoot(fromModuleUrl: string): string {
  const entryDir = path.dirname(fileURLToPath(fromModuleUrl));
  const candidates = [
    path.resolve(entryDir, ".."),
    path.resolve(entryDir, "../.."),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1]!;
}
