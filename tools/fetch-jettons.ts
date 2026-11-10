import { mkdir, mkdtemp, readFile, readdir, rm, copyFile, writeFile } from "node:fs/promises";
import { resolve, join, relative, basename } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dir, "..");
type Source = { repository: string; revision: string };
const sources: Record<string, Source> = JSON.parse(await readFile(join(root, "fixtures/jetton-sources.json"), "utf8"));

async function download(url: string): Promise<Buffer> {
  const started = performance.now();
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  console.log(JSON.stringify({
    operation: "fetch", target: url,
    durationMs: Math.round(performance.now() - started), outcome: "ok",
  }));
  return bytes;
}

async function copySources(directory: string, destination: string, archiveRoot: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    const local = relative(archiveRoot, source);

    if (entry.isDirectory()) {
      // Wallet source dependencies live in contracts/, ft/, or the archive root.
      if (local === "ft" || local === "contracts" || local.startsWith("contracts/")) {
        await copySources(source, destination, archiveRoot);
      }
      continue;
    }

    if (!entry.isFile() || !(/\.(fc|func)$/.test(entry.name) || ["LICENSE", "VERSION_HISTORY.md"].includes(entry.name))) {
      continue;
    }

    // Keep only wallet code and its dependencies. Minter, discovery, and
    // deployment-helper implementations are outside the transfer study.
    if (/minter|discovery|vanity|librarian/.test(entry.name)) {
      continue;
    }

    const target = join(destination, local);
    await mkdir(resolve(target, ".."), { recursive: true });
    await copyFile(source, target);
  }
}

if (process.argv.includes("--config")) {
  // Pin config retrieval to the exact block returned by getMasterchainInfo.
  // Never mix prices from different blocks in the same estimate.
  const master = JSON.parse((await download("https://toncenter.com/api/v2/getMasterchainInfo")).toString());
  const seqno = master.result.last.seqno;
  const config = JSON.parse((await download(`https://toncenter.com/api/v2/getConfigAll?seqno=${seqno}`)).toString());
  const bytes = Buffer.from(config.result.config.bytes, "base64");
  const fetchedAt = new Date();

  await writeFile(join(root, "fixtures/mainnet-config.boc"), bytes);
  await writeFile(join(root, "fixtures/mainnet-block.json"), `${JSON.stringify(master, null, 2)}\n`);
  await writeFile(join(root, "fixtures/config-provenance.json"), `${JSON.stringify({
    network: "mainnet", seqno, fetchedAt: fetchedAt.toISOString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }, null, 2)}\n`);

  await writeFile(join(root, "fixtures/config-time.tolk"),
    "// Recorded configuration fetch time. Refreshed by tools/fetch-jettons.ts --config.\n"
    + `const MEASUREMENT_TIME = ${Math.floor(fetchedAt.getTime() / 1000)}\n`);
} else {
  for (const [name, source] of Object.entries(sources)) {
    const temporary = await mkdtemp("/tmp/jetton-fees-");

    try {
      const url = `https://codeload.github.com/${source.repository}/tar.gz/${source.revision}`;
      const archive = join(temporary, "source.tar.gz");
      await writeFile(archive, await download(url));

      const unpack = Bun.spawn(["tar", "-xzf", archive, "-C", temporary], { stdout: "ignore", stderr: "inherit" });
      if (await unpack.exited !== 0) {
        throw new Error(`Cannot unpack ${basename(archive)} for ${name}`);
      }

      const entries = await readdir(temporary, { withFileTypes: true });
      const extracted = entries.find(entry => entry.isDirectory());
      if (!extracted) {
        throw new Error(`${name}: archive has no source directory`);
      }

      const archiveRoot = join(temporary, extracted.name);
      await copySources(archiveRoot, join(root, "vendor", name), archiveRoot);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
