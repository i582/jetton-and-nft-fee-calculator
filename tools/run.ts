import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const results = join(root, "results");
await mkdir(results, { recursive: true });

const version = Bun.spawn(["acton", "--version"], { stdout: "pipe", stderr: "inherit" });
const versionText = (await new Response(version.stdout).text()).trim();
if (await version.exited !== 0) throw new Error("acton --version failed");
console.log(versionText);

const logPath = join(results, "acton.log");
const log = await open(logPath, "w");
const started = performance.now();
const progress = () => console.log(JSON.stringify({
  operation: "measure", target: "ordinary jetton transfers",
  durationMs: Math.round(performance.now() - started), outcome: "running", log: logPath,
}));

progress();
const heartbeat = setInterval(progress, 15_000);

try {
  // Use Acton from PATH; all contract code, ABI interfaces, and network prices
  // are local fixtures. No wallet credentials or broadcast are involved.
  const child = Bun.spawn(["acton", "test", "tests/fees.test.tolk", "--color", "never"], {
    cwd: root, stdout: log.fd, stderr: log.fd,
  });
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`Acton failed with exit ${exitCode}; full diagnostics: ${logPath}`);
  }
} finally {
  clearInterval(heartbeat);
  await log.close();
}

console.log(JSON.stringify({
  operation: "measure", target: "ordinary jetton transfers",
  durationMs: Math.round(performance.now() - started), outcome: "ok", log: logPath,
}));

const report = Bun.spawn(["bun", "tools/report.ts", ...process.argv.slice(2)], {
  cwd: root, stdout: "inherit", stderr: "inherit",
});

if (await report.exited !== 0) {
  throw new Error("Report verification failed; see diagnostics above");
}

console.log("Open RESULTS.md for the table and README.md for integration guidance");
