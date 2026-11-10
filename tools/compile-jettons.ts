import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileFunc, compilerVersion } from "@ton-community/func-js";
import { Cell } from "@ton/core";

const root = resolve(import.meta.dir, "..");
const versions = ["v100", "v101", "v102", "v103", "v105", "v107", "m101", "m102", "m103", "m105", "minter"];
const expected = JSON.parse(await readFile(resolve(root, "fixtures/jetton-historical-build.json"), "utf8"));

const metadata = {
  compiler: await compilerVersion(),
  contracts: {} as Record<string, { codeHash: string; targets: string[] }>,
};

for (const version of versions) {
  const started = performance.now();
  const base = resolve(root, "vendor", version);
  const targets = version.startsWith("m")
    ? ["contracts/jetton-wallet.fc"]
    : ["stdlib.fc", "ft/params.fc", "ft/op-codes.fc", "ft/jetton-utils.fc", "ft/jetton-wallet.fc"];

  // Compile the upstream sources without rewriting their gas checks or message layouts.
  const result = await compileFunc({
    targets,
    sources: name => readFileSync(resolve(base, name), "utf8"),
    optLevel: 2,
  });

  if (result.status !== "ok") {
    throw new Error(`${version}: ${result.message}`);
  }

  const bytes = Buffer.from(result.codeBoc, "base64");
  const codeHash = Cell.fromBoc(bytes)[0].hash().toString("hex");
  if (expected.contracts[version]?.codeHash !== codeHash) {
    throw new Error(`${version}: rebuilt code hash differs from the recorded fixture`);
  }

  await writeFile(resolve(root, "contracts/jetton", `${version}.boc`), bytes);
  metadata.contracts[version] = { codeHash, targets };

  console.log(JSON.stringify({
    operation: "compile", target: version,
    durationMs: Math.round(performance.now() - started), outcome: "ok",
  }));
}

await writeFile(resolve(root, "fixtures/jetton-historical-build.json"), `${JSON.stringify(metadata, null, 2)}\n`);
