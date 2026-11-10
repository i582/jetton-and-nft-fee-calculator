import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Cell } from "@ton/core";
import { parseConfig, suggestedAttachment } from "../fees";
import { minimumNftAttachment } from "../nft-calculator";

const root = resolve(import.meta.dir, "..");
const log = await readFile(resolve(root, "results/nft-acton.log"), "utf8");
const provenance = JSON.parse(await readFile(resolve(root, "fixtures/config-provenance.json"), "utf8"));
const sources: Array<{ name: string; codeHash: string }> = JSON.parse(
  await readFile(resolve(root, "fixtures/nft-sources.json"), "utf8"),
);
const config = parseConfig(
  Cell.fromBoc(await readFile(resolve(root, "fixtures/mainnet-config.boc")))[0],
  Math.floor(Date.parse(provenance.fetchedAt) / 1000),
);

export interface NftMeasurement {
  variant: string;
  codeHash: string;
  initialBalance: string;
  forward: string;
  commentBytes: number;
  response: boolean;
  minimum: string;
  suggested: string;
  gas: number;
  transactionFees: string;
  pathNetworkCost: string;
  balanceAfter: string;
  excessMessageValue: string;
  incomingForwardFee: string;
  belowComputeExit: number;
  belowActionResult: number;
}

const measurements: NftMeasurement[] = [];

for (const source of sources) {
  const code = Cell.fromBoc(await readFile(resolve(root, `contracts/nft/${source.name}.boc`)))[0];

  if (code.hash().toString("hex") !== source.codeHash) {
    throw new Error(`NFT bytecode differs from pinned catalog: ${source.name}`);
  }
}

for (const line of log.split("\n")) {
  const marker = line.indexOf("NFT_RESULT,");

  if (marker < 0) {
    continue;
  }

  const fields = line.slice(marker).trim().split(",");

  if (fields.length !== 15) {
    throw new Error(`Malformed NFT result: ${line}`);
  }

  const [, variant, initialBalance, forward, commentBytes, responseText, minimum,
    suggested, gas, transactionFees, balanceAfter, excessMessageValue,
    incomingForwardFee, belowComputeExit, belowActionResult] = fields;
  const source = sources.find(source => source.name === variant);

  if (!source) {
    throw new Error(`Unknown NFT fixture: ${variant}`);
  }

  const response = responseText === "true";
  const calculated = minimumNftAttachment({
    codeHash: source.codeHash,
    config,
    balance: BigInt(initialBalance),
    incomingForwardFee: BigInt(incomingForwardFee),
    forward: BigInt(forward),
    response,
  });
  const reserveShortfall = BigInt(initialBalance) < 50_000_000n
    ? 50_000_000n - BigInt(initialBalance)
    : 0n;
  const calculatedSuggestion = suggestedAttachment(calculated, reserveShortfall);

  if (calculated.toString() !== minimum || calculatedSuggestion.toString() !== suggested) {
    throw new Error(`${variant}: NFT formula or margin differs from the complete Acton trace`);
  }

  const retained = BigInt(balanceAfter) - BigInt(initialBalance);
  const pathCost = BigInt(minimum) - BigInt(excessMessageValue) - BigInt(forward) - retained;

  measurements.push({
    variant,
    codeHash: source.codeHash,
    initialBalance,
    forward,
    commentBytes: Number(commentBytes),
    response,
    minimum,
    suggested,
    gas: Number(gas),
    transactionFees,
    pathNetworkCost: pathCost.toString(),
    balanceAfter,
    excessMessageValue,
    incomingForwardFee,
    belowComputeExit: Number(belowComputeExit),
    belowActionResult: Number(belowActionResult),
  });
}

const scenarioKeys = measurements.map(row => JSON.stringify([
  row.variant, row.initialBalance, row.forward, row.commentBytes, row.response,
]));

if (new Set(scenarioKeys).size !== 36 || measurements.length !== 36 || !log.includes("1 passed")) {
  throw new Error(`Incomplete NFT run: ${measurements.length} rows; see results/nft-acton.log`);
}

const serialized = `${JSON.stringify(measurements, null, 2)}\n`;
const snapshot = resolve(root, "fixtures/nft-expected-results.json");

await writeFile(resolve(root, "results/nft-measurements.json"), serialized);

if (process.argv.includes("--update")) {
  await writeFile(snapshot, serialized);
} else if (await readFile(snapshot, "utf8") !== serialized) {
  throw new Error("NFT measurements differ from the baseline; inspect results/nft-measurements.json before bun start --update");
}

function gram(value: string): string {
  const amount = BigInt(value);

  return `${amount / 1_000_000_000n}.${(amount % 1_000_000_000n).toString().padStart(9, "0")}`;
}

const baseline = measurements.filter(row =>
  row.initialBalance === "50000000" && row.forward === "1" && row.commentBytes === 0 && row.response,
);
const balances = measurements.filter(row =>
  row.variant === "NftV1Item" && row.forward === "1" && row.commentBytes === 0 && row.response,
);
const subsequent = balances.find(row => row.initialBalance === baseline[0].balanceAfter)!;
const options = measurements.filter(row => row.variant === "NftV1Item" && row.initialBalance === "50000000");

const markdown = `# GRAM budgets for ordinary NFT transfers

Mainnet configuration: masterchain block **${provenance.seqno}**, fetched at **${provenance.fetchedAt}**.
All amounts use GRAM. These are ownership transfers of initialized NFT items.
Sales, auctions, minting, editorship transfers, and metadata changes are outside this study.

## Funded NFT items

Each NFT starts with 0.05 GRAM. The request forwards one nanogram to the new owner,
uses the current owner as the response address, and has no comment or custom payload.

| Implementation | Minimum attachment | Suggested attachment | NFT-path network cost | NFT balance after | Excess message value |
|---|---:|---:|---:|---:|---:|
${baseline.map(row => `| ${row.variant} | ${gram(row.minimum)} | ${gram(row.suggested)} | ${gram(row.pathNetworkCost)} | ${gram(row.balanceAfter)} | ${gram(row.excessMessageValue)} |`).join("\n")}

Costs, balances, and excesses correspond to the **minimum attachment**.
Network cost includes NFT computation and its outgoing forwarding fees.
It excludes the source owner's transaction and execution at notification/refund destinations.
Network cost can exceed the attachment when the NFT's existing balance pays part of it.

The catalog's NFT 1 and NFT 2.0 item fixtures share the same code hashes.
The first two rows cover standard v1.03 and editable v1.02/v1.03 bytecode, respectively.
They do not cover every older NFT release, simple-schema variants, DNS, TeleMint, Telegram gifts, or custom forks.
Exact code hashes and public download URLs are in [nft-sources.json](fixtures/nft-sources.json).

## Existing balance changes the attachment

The standard item retains a fixed nominal reserve of 0.05 GRAM before computation and outgoing message costs.
Its existing balance helps satisfy that guard. It does not increase the incoming message's initial gas limit.

| NFT balance before | Minimum attachment | Suggested attachment | NFT-path network cost | NFT balance after | Excess message value |
|---|---:|---:|---:|---:|---:|
${balances.map(row => `| ${gram(row.initialBalance)} | ${gram(row.minimum)} | ${gram(row.suggested)} | ${gram(row.pathNetworkCost)} | ${gram(row.balanceAfter)} | ${gram(row.excessMessageValue)} |`).join("\n")}

A nearly empty NFT needs about 0.05 GRAM of funding. Most of that value stays on the NFT.
It is not a validator fee. The final balance can be below 0.05 GRAM because computation spends part of that reserve.
The balance table also includes another transfer from the balance left by the preceding one.
That ordinary subsequent transfer needs a suggested **${gram(subsequent.suggested)} GRAM** for the standard item.
An excess refund can include funds that were already on the NFT before the transfer.
Do not present the entire refund as unused value from the new attachment.

## Message options

Standard item, initial balance 0.05 GRAM:

| Forwarded value | Comment bytes | Refund requested | Minimum attachment | Suggested attachment | NFT-path network cost |
|---|---:|---|---:|---:|---:|
${options.map(row => `| ${gram(row.forward)} | ${row.commentBytes} | ${row.response ? "Yes" : "No"} | ${gram(row.minimum)} | ${gram(row.suggested)} | ${gram(row.pathNetworkCost)} |`).join("\n")}

With no response address, unused funds stay on the NFT. With zero forward value, no ownership notification is emitted.
A referenced 32-byte comment increases forwarding cost, although the gas bound still determines the funded item's minimum here.

## Calculation and wallet integration

For these four code hashes, calculate a candidate with [minimumNftAttachment()](nft-calculator.ts):

\`\`\`text
count = (forward_ton_amount > 0 ? 1 : 0) + (response_destination exists ? 1 : 0)
estimated_forward_fee = floor(incoming_forward_fee * 3 / 2)
reserve_bound = 50,000,000 - NFT_balance + forward_ton_amount + count * estimated_forward_fee
attachment = max(compute_fee(transfer_gas), reserve_bound)
\`\`\`

All formula inputs use nanograms. The reserve guard accepts equality; there is no extra nanogram for a strict comparison.
Gas figures depend on the implementation and whether notification and refund messages are requested.
They are calibrated from full Acton traces, then checked against all ${measurements.length} scenarios.
The reserve check follows the [reference transfer implementation](https://github.com/ton-blockchain/nft-contract/blob/0b493104cd547d0fd52b7e6fd3c046fc365fe3d4/nft/nft-item.fc).

Read the NFT's state and configuration from one block. Check that the item is initialized and the sender is its current owner.
Use the balance after storage collection, and build the exact TEP-62 message.
Calculate its incoming forwarding fee using the source wallet's actual serialization.
Recalculate when a different attachment changes that serialization.

Emulate the candidate against the original state. Require a committed owner change, a successful action phase,
and emission of every requested notification and refund. Recipient notification execution is not required.
Search only funding failures; report authorization, payload, and unsupported-code errors directly.
Restore the same state for each probe, then verify the minimum and one nanogram below it.

Apply suggestedAttachment(minimum, max(0, 50,000,000 - NFT_balance)) and emulate that final amount.
The policy adds max(0.0001 GRAM, 5% of the amount above the reserve shortfall), then rounds upward to 0.0001 GRAM.
It is a margin after successful emulation, not a guarantee for arbitrary state, messages, or future prices.

The fixture accounts have no storage debt, use basechain addresses, and contain short metadata.
The new owner is uninitialized. Editable items preserve their existing editor; only ownership changes.
Do not apply these gas profiles to different code, precompiled NFT implementations, or arbitrary custom payloads.

## Reproduce

Run \`bun start\` to measure jettons and NFTs. Acton checks all ${measurements.length} NFT boundaries and suggested values.
The TypeScript formula must match each boundary. The accepted snapshot must also match.
The jetton measurements are checked separately and remain unchanged.

Full results: [nft-measurements.json](results/nft-measurements.json).
Full execution log: \`results/nft-acton.log\`.
Use \`bun run refresh:nfts\` to download the same pinned public catalog fixtures.
`;

await writeFile(resolve(root, "NFT_RESULTS.md"), markdown);
console.log(JSON.stringify({
  operation: "report", target: "NFT_RESULTS.md", outcome: "ok", scenarios: measurements.length,
}));
