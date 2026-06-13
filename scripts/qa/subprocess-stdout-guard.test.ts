/**
 * Regression test: stdout handlers must not buffer after settle.
 * Run: tsx scripts/qa/subprocess-stdout-guard.test.ts
 */

let passed = 0;
let failed = 0;

function assert(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}:`, err);
    process.exitCode = 1;
  }
}

/** Mirrors cvAgentStageRunner stdout handler after the settle guard fix. */
function createStdoutHandler(options: {
  maxStdoutBytes: number;
  onOversize: () => void;
}) {
  const stdoutChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let settled = false;

  const onData = (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (settled) return;
    if (stdoutBytes > options.maxStdoutBytes) {
      settled = true;
      options.onOversize();
      return;
    }
    stdoutChunks.push(chunk);
  };

  const settle = () => {
    settled = true;
  };

  return { onData, settle, stdoutChunks, get stdoutBytes() {
    return stdoutBytes;
  } };
}

assert("does not grow stdoutChunks after timeout settle", () => {
  const handler = createStdoutHandler({
    maxStdoutBytes: 100,
    onOversize: () => {},
  });
  handler.onData(Buffer.alloc(50));
  handler.onData(Buffer.alloc(60));
  const sizeAfterOversize = handler.stdoutChunks.length;
  handler.onData(Buffer.alloc(1_000_000));
  if (handler.stdoutChunks.length !== sizeAfterOversize) {
    throw new Error("chunks grew after settle");
  }
});

assert("does not grow stdoutChunks after explicit settle", () => {
  const handler = createStdoutHandler({
    maxStdoutBytes: 10_000,
    onOversize: () => {},
  });
  handler.onData(Buffer.alloc(10));
  handler.settle();
  handler.onData(Buffer.alloc(10_000));
  if (handler.stdoutChunks.length !== 1) {
    throw new Error(`expected 1 chunk, got ${handler.stdoutChunks.length}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
