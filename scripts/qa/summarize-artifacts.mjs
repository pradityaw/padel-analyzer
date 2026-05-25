#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const artifactsDir = path.join(repoRoot, "qa-artifacts");
const consoleDir = path.join(artifactsDir, "console");
const networkDir = path.join(artifactsDir, "network");
const resultsDir = path.join(artifactsDir, "playwright-results");
const inputPath = path.join(artifactsDir, "latest-feedback-input.json");
const reportPath = path.join(artifactsDir, "latest-feedback-report.md");

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { parseError: error instanceof Error ? error.message : String(error) };
  }
}

function listFilesRecursive(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFilesRecursive(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function relativeFiles(files) {
  return files.map((file) => path.relative(repoRoot, file));
}

function collectConsoleEvents() {
  return listFilesRecursive(consoleDir, (file) => file.endsWith(".json")).flatMap((file) => {
    const parsed = readJsonFile(file);
    const events = Array.isArray(parsed) ? parsed : [];
    return events.map((event) => ({
      file: path.relative(repoRoot, file),
      type: event.type ?? "unknown",
      text: event.text ?? "",
      location: event.location,
    }));
  });
}

function collectNetworkEvents() {
  return listFilesRecursive(networkDir, (file) => file.endsWith(".json")).flatMap((file) => {
    const parsed = readJsonFile(file);
    const failedRequests = Array.isArray(parsed.failedRequests)
      ? parsed.failedRequests.map((event) => ({
          file: path.relative(repoRoot, file),
          kind: "requestfailed",
          method: event.method,
          url: event.url,
          errorText: event.errorText,
        }))
      : [];
    const errorResponses = Array.isArray(parsed.errorResponses)
      ? parsed.errorResponses.map((event) => ({
          file: path.relative(repoRoot, file),
          kind: "error-response",
          status: event.status,
          url: event.url,
        }))
      : [];
    return [...failedRequests, ...errorResponses];
  });
}

function main() {
  mkdirSync(artifactsDir, { recursive: true });

  const consoleEvents = collectConsoleEvents();
  const networkEvents = collectNetworkEvents();
  const screenshots = listFilesRecursive(resultsDir, (file) => file.endsWith(".png"));
  const traces = listFilesRecursive(resultsDir, (file) => file.endsWith(".zip"));
  const videos = listFilesRecursive(resultsDir, (file) => file.endsWith(".webm"));
  const errorContexts = listFilesRecursive(resultsDir, (file) => file.endsWith("error-context.md"));

  const summary = {
    generatedAt: new Date().toISOString(),
    artifactRoot: "qa-artifacts",
    counts: {
      consoleWarnings: consoleEvents.filter((event) => event.type === "warning").length,
      consoleErrors: consoleEvents.filter((event) => event.type === "error").length,
      failedNetworkEvents: networkEvents.length,
      screenshots: screenshots.length,
      traces: traces.length,
      videos: videos.length,
      errorContexts: errorContexts.length,
    },
    consoleEvents,
    networkEvents,
    screenshots: relativeFiles(screenshots),
    traces: relativeFiles(traces),
    videos: relativeFiles(videos),
    errorContexts: relativeFiles(errorContexts),
  };

  writeFileSync(inputPath, JSON.stringify(summary, null, 2), "utf8");

  const report = [
    "# Latest Self-Test Feedback Input",
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Console errors: ${summary.counts.consoleErrors}`,
    `- Console warnings: ${summary.counts.consoleWarnings}`,
    `- Failed/error network events: ${summary.counts.failedNetworkEvents}`,
    `- Screenshots: ${summary.counts.screenshots}`,
    `- Traces: ${summary.counts.traces}`,
    `- Videos: ${summary.counts.videos}`,
    "",
    "## Files",
    "",
    `- Structured input: \`${path.relative(repoRoot, inputPath)}\``,
    `- Playwright artifacts: \`qa-artifacts/playwright-results/\``,
    `- Console artifacts: \`qa-artifacts/console/\``,
    `- Network artifacts: \`qa-artifacts/network/\``,
    "",
  ];

  if (consoleEvents.length > 0) {
    report.push("## Console Events", "");
    for (const event of consoleEvents.slice(0, 20)) {
      report.push(`- ${event.type}: ${event.text}`);
    }
    report.push("");
  }

  if (networkEvents.length > 0) {
    report.push("## Network Events", "");
    for (const event of networkEvents.slice(0, 20)) {
      report.push(`- ${event.kind}: ${event.url}`);
    }
    report.push("");
  }

  writeFileSync(reportPath, report.join("\n"), "utf8");
  console.log(`Feedback input written: ${path.relative(repoRoot, inputPath)}`);
  console.log(`Feedback report written: ${path.relative(repoRoot, reportPath)}`);
}

main();
