import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const results = join(root, "results");
await mkdir(results, { recursive: true });

const version = Bun.spawn(["acton", "--version"], { stdout: "pipe", stderr: "inherit" });
const versionText = (await new Response(version.stdout).text()).trim();
if (await version.exited !== 0) throw new Error("acton --version failed");
console.log(versionText);

const studies = [
  { target: "ordinary jetton transfers", test: "jetton-fees", log: "jetton-acton.log", report: "jetton-report" },
  { target: "ordinary NFT transfers", test: "nft-fees", log: "nft-acton.log", report: "nft-report" },
];

for (const study of studies) {
  const logPath = join(results, study.log);
  const log = await open(logPath, "w");
  const started = performance.now();
  const progress = () => console.log(JSON.stringify({
    operation: "measure", target: study.target,
    durationMs: Math.round(performance.now() - started), outcome: "running", log: logPath,
  }));

  progress();
  const heartbeat = setInterval(progress, 15_000);

  try {
    // Use Acton from PATH; all contract code, ABI interfaces, and network prices
    // are local fixtures. No wallet credentials or broadcast are involved.
    const child = Bun.spawn(["acton", "test", `tests/${study.test}.test.tolk`, "--color", "never"], {
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
    operation: "measure", target: study.target,
    durationMs: Math.round(performance.now() - started), outcome: "ok", log: logPath,
  }));

  const report = Bun.spawn(["bun", `tools/${study.report}.ts`, ...process.argv.slice(2)], {
    cwd: root, stdout: "inherit", stderr: "inherit",
  });

  if (await report.exited !== 0) {
    throw new Error("Report verification failed; see diagnostics above");
  }
}

console.log("Open JETTON_RESULTS.md and NFT_RESULTS.md for measurements, README.md for usage");
