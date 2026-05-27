export function parseJsonlLines(text, opts = {}) {
  const label = opts.label || "jsonl";
  const log = opts.log || (() => {});
  const records = [];
  let skipped = 0;

  for (const [idx, line] of String(text ?? "").split(/\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (err) {
      skipped += 1;
      log(
        `Skipping corrupt JSONL line ${idx + 1} in ${label}: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  return { records, skipped };
}
