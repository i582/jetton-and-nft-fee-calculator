import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Cell } from "@ton/core";

const root = resolve(import.meta.dir, "..");
const revision = "7dc57067d85c95dc25c09ccaaf108eaba62f6303";
const base = `https://raw.githubusercontent.com/ton-blockchain/abis/${revision}/data/nfts`;

// The catalog's NFT 1 and NFT 2.0 items have identical bytecode. Keep one copy
// of each implementation; collection names do not identify transfer behavior.
const contracts = [
  { name: "NftV1Item", directory: "nft_1", types: "nft_v1_item" },
  { name: "NftV1EditableItem", directory: "nft_1", types: "nft_v1_editable_item" },
  { name: "GetgemsNftItemV2", directory: "getgems_nft_2_0", types: "getgems_nft_v2_item" },
  { name: "GetgemsNftEditableItemV2", directory: "getgems_nft_2_0", types: "getgems_nft_v2_editable_item" },
];

await mkdir(resolve(root, "contracts/nft"), { recursive: true });
const provenance = [];

for (const contract of contracts) {
  const started = performance.now();
  const codeUrl = `${base}/${contract.directory}/testdata/${contract.name}.boc`;
  const typesUrl = `${base}/${contract.directory}/types/${contract.types}.types.tolk`;
  const responses = await Promise.all([codeUrl, typesUrl].map(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });

    if (!response.ok) {
      throw new Error(`${url}: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }));

  const [code, types] = responses;
  const codeHash = Cell.fromBoc(code)[0].hash().toString("hex");

  await writeFile(resolve(root, `contracts/nft/${contract.name}.boc`), code);
  await writeFile(resolve(root, `contracts/nft/${contract.name}.types.tolk`), types);
  provenance.push({ name: contract.name, codeHash, codeUrl, typesUrl });

  console.log(JSON.stringify({
    operation: "fetch", target: contract.name,
    durationMs: Math.round(performance.now() - started), outcome: "ok",
  }));
}

await writeFile(resolve(root, "fixtures/nft-sources.json"), `${JSON.stringify(provenance, null, 2)}\n`);
