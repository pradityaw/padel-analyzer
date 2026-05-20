#!/usr/bin/env node
/**
 * Release gates: typecheck, contracts, tracking helpers, Python CV tests, optional build.
 * Beta (no production build): `npm run release:beta-gates`
 * Full ship: `npm run release:gates`
 * Browser e2e remains optional: `npm run qa:browser`
 */
import { spawnSync } from "node:child_process";

const skipBuild =
  process.argv.includes("--skip-build") || process.env.SKIP_BUILD === "1";

function run(label, cmd, args, opts = {}) {
  console.log(`\n▶ ${label}\n`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    console.error(`\n✖ ${label} failed (exit ${r.status ?? "unknown"})`);
    process.exit(r.status ?? 1);
  }
}

run("Typecheck", "npm", ["run", "typecheck"]);
run("Mobile typecheck", "npm", ["run", "mobile:typecheck"]);
run("Contract tests", "npm", ["run", "test:contracts"]);
run("Court calibration tests", "npx", ["tsx", "scripts/qa/court-calibration.test.ts"]);
run("Mobile ball-tracking tests", "npx", ["tsx", "mobile/scripts/ball-tracking.test.ts"]);
run("Tracking integration smoke", "npx", ["tsx", "scripts/qa/tracking-integration-smoke.ts"]);
run("Python CV tests", "python3", ["-m", "pytest", "scripts/cv/tests", "-q"]);

if (!skipBuild) {
  run("Production build", "npm", ["run", "build"]);
}

console.log(`
✓ Release gates passed${skipBuild ? " (build skipped)" : ""}.

Optional before widening beta:
  • npm run release:gates — includes production build
  • npm run qa:browser
  • docs/MOBILE_DEVICE_QA.md — simulator + physical device checklist
`);
