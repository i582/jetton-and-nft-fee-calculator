import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Cell, beginCell } from "@ton/core";
import { minimumAttachment, parseConfig, profiles, suggestedAttachment } from "../calculator";

const root = resolve(import.meta.dir, "..");
const log = await readFile(join(root, "results/acton.log"), "utf8");
const block = JSON.parse(await readFile(join(root, "fixtures/mainnet-block.json"), "utf8"));
const provenance = JSON.parse(await readFile(join(root, "fixtures/config-provenance.json"), "utf8"));
const configCell = Cell.fromBoc(await readFile(join(root, "fixtures/mainnet-config.boc")))[0];
const config = parseConfig(configCell, Math.floor(Date.parse(provenance.fetchedAt) / 1000));

export interface Measurement {
  variant: string;
  deployed: boolean;
  forward: string;
  commentBytes: number;
  senderBalance: string;
  minimum: string;
  suggested: string;
  senderGas: number;
  receiverGas: number;
  jettonTransactionFees: string;
  pathNetworkCost: string;
  excessMessageValue: string;
  senderBalanceAfter: string;
  receiverBalanceAfter: string;
  incomingForwardFee: string;
  belowSenderExit: number;
  belowReceiverExit: number;
  rawCodeHash: string;
  deployedCodeHash: string;
}

const measurements: Measurement[] = [];

for (const line of log.split("\n")) {
  const marker = line.indexOf("RESULT,");
  if (marker < 0) continue;

  const fields = line.slice(marker).trim().split(",");
  if (fields.length !== 17) throw new Error(`Malformed result line: ${line}`);

  const [, variant, deployedText, forward, commentBytes, senderBalance, minimum,
    senderGas, receiverGas, fees, excess, senderAfter, receiverAfter, incomingFee,
    belowSenderExit, belowReceiverExit, testedSuggestion] = fields;

  const profile = profiles[variant];
  if (!profile) throw new Error(`Missing fee profile for ${variant}`);

  const fileName = variant === "StablecoinWalletTvm" ? "StablecoinWallet" : variant;
  const code = Cell.fromBoc(await readFile(join(root, "contracts", `${fileName}.boc`)))[0];
  const usesLibrary = profile.family === "modern" && variant !== "JettonWallet";
  const deployedCode = usesLibrary
    ? beginCell().storeUint(2, 8).storeBuffer(code.hash()).endCell({ exotic: true })
    : code;

  const scenarioConfig = variant === "StablecoinWalletTvm"
    ? { ...config, precompiled: new Map<string, bigint>() }
    : config;

  const guard = minimumAttachment(profile, scenarioConfig, BigInt(incomingFee), BigInt(forward), deployedCode.hash().toString("hex"));
  if (guard !== BigInt(minimum)) {
    throw new Error(`${variant}: Acton minimum ${minimum} differs from analytic guard ${guard}`);
  }

  const deployed = deployedText === "true";
  const recipientBefore = deployed ? 10_000_000n : 0n;
  const retained = BigInt(senderAfter) - BigInt(senderBalance) + BigInt(receiverAfter) - recipientBefore;

  // Balance conservation includes all outgoing forwarding fees. Transaction
  // totalFees alone omits fees still carried by notification/excess messages.
  // Source owner execution and destination owner execution are outside this metric.
  const pathCost = BigInt(minimum) - BigInt(excess) - BigInt(forward) - retained;
  const fixedFloor = profile.family === "legacy" ? 2n * profile.legacyGas! + 10_000_000n : 0n;
  const suggested = suggestedAttachment(BigInt(minimum), fixedFloor).toString();

  if (suggested !== testedSuggestion) {
    throw new Error(`${variant}: suggested attachment differs from the budget checked by Acton`);
  }

  measurements.push({
    variant, deployed, forward, commentBytes: Number(commentBytes), senderBalance, minimum,
    suggested,
    senderGas: Number(senderGas), receiverGas: Number(receiverGas),
    jettonTransactionFees: fees, pathNetworkCost: pathCost.toString(),
    excessMessageValue: excess, senderBalanceAfter: senderAfter, receiverBalanceAfter: receiverAfter,
    incomingForwardFee: incomingFee,
    belowSenderExit: Number(belowSenderExit), belowReceiverExit: Number(belowReceiverExit),
    rawCodeHash: code.hash().toString("hex"), deployedCodeHash: deployedCode.hash().toString("hex"),
  });
}

if (measurements.length !== 77 || !log.includes("1 passed")) {
  throw new Error(`Incomplete Acton run: found ${measurements.length} scenarios; see results/acton.log`);
}

const serialized = `${JSON.stringify(measurements, null, 2)}\n`;
const snapshot = join(root, "fixtures/expected-results.json");

// Preserve the new observations even when they differ from the accepted baseline.
await writeFile(join(root, "results/measurements.json"), serialized);

if (process.argv.includes("--update")) {
  await writeFile(snapshot, serialized);
} else if (await readFile(snapshot, "utf8") !== serialized) {
  throw new Error("results/measurements.json differs from fixtures/expected-results.json; inspect the changes before bun report --update");
}

function gram(value: string | bigint): string {
  const amount = BigInt(value);
  return `${amount / 1_000_000_000n}.${(amount % 1_000_000_000n).toString().padStart(9, "0")}`;
}

const baseline = measurements.filter(row => !row.deployed && row.forward === "1" && row.commentBytes === 0 && row.senderBalance === "10000000");
const rows = baseline.map(row => `| ${row.variant} | ${gram(row.minimum)} | ${gram(row.suggested)} | ${gram(row.pathNetworkCost)} | ${gram(row.receiverBalanceAfter)} | ${gram(row.excessMessageValue)} |`);

const markdown = `# GRAM budgets for ordinary jetton transfers

Mainnet configuration: masterchain block **${block.result.last.seqno}**. All amounts use GRAM.
Configuration fetched at **${provenance.fetchedAt}**.

The recipient jetton-wallet does not exist before the transfer. Each transfer sends 1,000,000 jetton base units.
The request sets forward_ton_amount to 1 nanogram and response_destination to the sender. It contains no comment.

| Bytecode | Minimum attachment | Suggested attachment | Jetton-path network cost | Retained at recipient | Excess message value |
|---|---:|---:|---:|---:|---:|
${rows.join("\n")}

Costs, retained balances, and excesses correspond to the **minimum attachment**.
They do not represent the suggested attachment.
The network cost excludes the source owner's transaction and execution of notification/excess messages at their destinations.

The suggested attachment adds max(0.0001 GRAM, 5% of the variable budget), then rounds upward to 0.0001 GRAM.
This margin is a proposed wallet policy after successful emulation. It does not guarantee success for arbitrary state or payloads.

Acton checked **${measurements.length}** scenarios. Each minimum completes the transfer and satisfies both jetton balance checks.
One nanogram less fails. The TypeScript formula matches every Acton minimum.
Each suggested attachment also completes the corresponding Acton transfer.

Full measurements, code hashes, and boundary diagnostics: [measurements.json](results/measurements.json).
Method, version mapping, and wallet integration guidance: [README.md](README.md).
`;

await writeFile(join(root, "RESULTS.md"), markdown);
console.log(JSON.stringify({ operation: "report", target: "RESULTS.md", outcome: "ok", scenarios: measurements.length }));
