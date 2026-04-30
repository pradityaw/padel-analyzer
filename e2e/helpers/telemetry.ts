import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

type ConsoleEvent = {
  type: string;
  text: string;
  location?: string;
};

type FailedRequestEvent = {
  method: string;
  url: string;
  errorText?: string;
};

type ErrorResponseEvent = {
  status: number;
  url: string;
};

function shouldIgnoreUrl(url: string): boolean {
  return url.includes("/@vite/") || url.includes("sockjs-node");
}

export type TelemetrySession = {
  flush: (testInfo: TestInfo) => Promise<void>;
};

export function startTelemetry(page: Page): TelemetrySession {
  const consoleEvents: ConsoleEvent[] = [];
  const failedRequests: FailedRequestEvent[] = [];
  const errorResponses: ErrorResponseEvent[] = [];

  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const loc = msg.location();
    consoleEvents.push({
      type,
      text: msg.text(),
      location: loc.url ? `${loc.url}:${loc.lineNumber}` : undefined,
    });
  });

  page.on("requestfailed", (req) => {
    const url = req.url();
    if (shouldIgnoreUrl(url)) return;
    failedRequests.push({
      method: req.method(),
      url,
      errorText: req.failure()?.errorText,
    });
  });

  page.on("response", (res) => {
    const url = res.url();
    if (res.status() < 400 || shouldIgnoreUrl(url)) return;
    errorResponses.push({
      status: res.status(),
      url,
    });
  });

  return {
    async flush(testInfo: TestInfo) {
      const consolePath = testInfo.outputPath("console-events.json");
      const networkPath = testInfo.outputPath("network-events.json");
      await writeFile(consolePath, JSON.stringify(consoleEvents, null, 2), "utf8");
      await writeFile(
        networkPath,
        JSON.stringify({ failedRequests, errorResponses }, null, 2),
        "utf8"
      );

      const artifactSafeTitle = testInfo.title.replace(/[^a-z0-9_-]+/gi, "-");
      const qaConsolePath = `qa-artifacts/console/${artifactSafeTitle}.json`;
      const qaNetworkPath = `qa-artifacts/network/${artifactSafeTitle}.json`;
      await mkdir(path.dirname(qaConsolePath), { recursive: true });
      await mkdir(path.dirname(qaNetworkPath), { recursive: true });
      await writeFile(qaConsolePath, JSON.stringify(consoleEvents, null, 2), "utf8");
      await writeFile(
        qaNetworkPath,
        JSON.stringify({ failedRequests, errorResponses }, null, 2),
        "utf8"
      );

      await testInfo.attach("console-events", {
        path: consolePath,
        contentType: "application/json",
      });
      await testInfo.attach("network-events", {
        path: networkPath,
        contentType: "application/json",
      });
    },
  };
}
