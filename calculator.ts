import { Cell, Dictionary } from "@ton/core";

const SCALE = 65_536n;
const FIVE_YEARS = 5n * 365n * 24n * 3_600n;

export interface FeeConfig {
  flatGasLimit: bigint;
  flatGasPrice: bigint;
  gasPrice: bigint;
  lumpPrice: bigint;
  bitPrice: bigint;
  cellPrice: bigint;
  firstFraction: bigint;
  storageBitPrice: bigint;
  storageCellPrice: bigint;
  precompiled: Map<string, bigint>;
}

export interface WalletProfile {
  family: "legacy" | "modern";
  legacyGas?: bigint;
  legacyForwardMultiplier?: "raw" | "three-halves";
  alwaysTwoForwards?: boolean;
  sendGas?: bigint;
  receiveGas?: bigint;
  storageBits?: bigint;
  initBits?: bigint;
}

/** Integer rounding is part of the contract's acceptance boundary. */
export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n) {
    throw new Error("Expected a nonnegative value and a positive divisor");
  }

  return (value + divisor - 1n) / divisor;
}

/** Read basechain prices and the deployed-code-hash precompile table from one block. */
export function parseConfig(root: Cell, now: number): FeeConfig {
  const params = Dictionary.loadDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell(), root);
  const param = (id: number) => {
    const value = params.get(id);
    if (!value) throw new Error(`ConfigParam ${id} is missing`);
    return value.beginParse();
  };

  const gas = param(21);
  if (gas.loadUint(8) !== 0xd1) throw new Error("Unsupported gas price layout");
  const flatGasLimit = gas.loadUintBig(64);
  const flatGasPrice = gas.loadUintBig(64);
  if (gas.loadUint(8) !== 0xde) throw new Error("Unsupported extended gas price layout");
  const gasPrice = gas.loadUintBig(64);

  const forwarding = param(25);
  if (forwarding.loadUint(8) !== 0xea) throw new Error("Unsupported forwarding price layout");
  const lumpPrice = forwarding.loadUintBig(64);
  const bitPrice = forwarding.loadUintBig(64);
  const cellPrice = forwarding.loadUintBig(64);
  forwarding.skip(32); // ihr_price_factor is unused for these ordinary messages
  const firstFraction = BigInt(forwarding.loadUint(16));

  const storage = param(18).loadDictDirect(Dictionary.Keys.Uint(32), {
    serialize() { throw new Error("Read-only configuration parser"); },
    parse(slice) {
      if (slice.loadUint(8) !== 0xcc) throw new Error("Unsupported storage price layout");
      return {
        since: slice.loadUint(32),
        bitPrice: slice.loadUintBig(64),
        cellPrice: slice.loadUintBig(64),
      };
    },
  });

  const activeStorage = [...storage.values()]
    .filter(price => price.since <= now)
    .sort((a, b) => b.since - a.since)[0];
  if (!activeStorage) throw new Error("No storage prices active at the selected time");

  const precompiled = new Map<string, bigint>();
  const precompileCell = params.get(45);
  if (precompileCell) {
    const slice = precompileCell.beginParse();
    if (slice.loadUint(8) !== 0xc0) throw new Error("Unsupported precompile layout");

    const entries = slice.loadDict(Dictionary.Keys.BigUint(256), {
      serialize() { throw new Error("Read-only configuration parser"); },
      parse(value) {
        if (value.loadUint(8) !== 0xb0) throw new Error("Unsupported precompiled entry");
        return value.loadUintBig(64);
      },
    });

    for (const [hash, gasUsage] of entries) {
      precompiled.set(hash.toString(16).padStart(64, "0"), gasUsage);
    }
  }

  return {
    flatGasLimit, flatGasPrice, gasPrice, lumpPrice, bitPrice, cellPrice, firstFraction,
    storageBitPrice: activeStorage.bitPrice,
    storageCellPrice: activeStorage.cellPrice,
    precompiled,
  };
}

export function computeFee(gas: bigint, config: FeeConfig): bigint {
  return config.flatGasPrice + ceilDiv(
    (gas > config.flatGasLimit ? gas - config.flatGasLimit : 0n) * config.gasPrice,
    SCALE,
  );
}

/** GETORIGINALFWDFEE uses floor division, unlike the fee-generation ceiling. */
export function originalForwardFee(remaining: bigint, config: FeeConfig): bigint {
  return remaining * SCALE / (SCALE - config.firstFraction);
}

/**
 * Compute the forward_fee field of an ordinary basechain internal message.
 * Pass the exact serialized message emitted by the owner's wallet, including
 * its body placement and StateInit if present. The root is covered by lumpPrice.
 * Shared cells count once, as in TON's forwarding-fee calculation.
 */
export function incomingForwardFee(message: Cell, config: FeeConfig): bigint {
  const visited = new Set<string>();
  let bits = 0n;
  let cells = 0n;

  function visit(cell: Cell): void {
    const hash = cell.hash().toString("hex");
    if (visited.has(hash)) return;
    visited.add(hash);

    bits += BigInt(cell.bits.length);
    cells += 1n;
    for (const reference of cell.refs) visit(reference);
  }

  visited.add(message.hash().toString("hex"));
  for (const reference of message.refs) visit(reference);

  const total = config.lumpPrice + ceilDiv(bits * config.bitPrice + cells * config.cellPrice, SCALE);
  return total - total * config.firstFraction / SCALE;
}

/**
 * Reproduce the sender's strict funding guard, in nanograms.
 * This is a lower bound, not a guarantee that downstream execution succeeds.
 * The caller must identify exact code, supply actual inbound forward_fee, and
 * emulate the complete transfer against current state before submitting it.
 */
export function minimumAttachment(
  profile: WalletProfile,
  config: FeeConfig,
  incomingForwardFee: bigint,
  forwardAmount: bigint,
  deployedCodeHash: string,
): bigint {
  if (incomingForwardFee < 0n || forwardAmount < 0n) {
    throw new Error("Amounts cannot be negative");
  }

  const count = profile.alwaysTwoForwards || forwardAmount > 0n ? 2n : 1n;

  if (profile.family === "legacy") {
    const forward = profile.legacyForwardMultiplier === "three-halves"
      ? incomingForwardFee * 3n / 2n
      : incomingForwardFee;

    return forwardAmount + count * forward + 2n * profile.legacyGas! + 10_000_000n + 1n;
  }

  // ConfigParam 45 keys are hashes of the deployed code cell. For USDT this is
  // the library-reference cell hash, not the hash of the resolved FunC code.
  const precompiledGas = config.precompiled.get(deployedCodeHash);
  const senderGas = precompiledGas ?? profile.sendGas!;
  const receiverGas = precompiledGas ?? profile.receiveGas!;

  const stateInitOverhead = ceilDiv(profile.initBits! * config.bitPrice + 3n * config.cellPrice, SCALE);
  const storageReserve = ceilDiv(
    FIVE_YEARS * (profile.storageBits! * config.storageBitPrice + 3n * config.storageCellPrice),
    SCALE,
  );

  return forwardAmount
    + count * originalForwardFee(incomingForwardFee, config)
    + stateInitOverhead
    + computeFee(senderGas, config)
    + computeFee(receiverGas, config)
    + storageReserve
    + 1n;
}

/**
 * Suggested policy after successful full-trace emulation, not a protocol bound.
 * The 5% margin covers only the variable budget; old hardcoded GRAM floors
 * should not receive a percentage markup. Round upward to 0.0001 GRAM.
 */
export function suggestedAttachment(minimum: bigint, fixedFloor: bigint = 0n): bigint {
  const variable = minimum > fixedFloor ? minimum - fixedFloor : 0n;
  const percentageMargin = ceilDiv(variable * 5n, 100n);
  const margin = percentageMargin > 100_000n ? percentageMargin : 100_000n;

  return ceilDiv(minimum + margin, 100_000n) * 100_000n;
}

const legacy = (gas = 10_000_000n, updated = false): WalletProfile => ({
  family: "legacy", legacyGas: gas,
  legacyForwardMultiplier: updated ? "three-halves" : "raw",
});

const modern = (sendGas: bigint, receiveGas: bigint, storageBits = 1033n, initBits = 931n): WalletProfile => ({
  family: "modern", sendGas, receiveGas, storageBits, initBits,
});

/** Research labels map to pinned BoCs; production must use the recorded hashes. */
export const profiles: Record<string, WalletProfile> = {
  v100: { ...legacy(), alwaysTwoForwards: true },
  v101: legacy(),
  v102: legacy(),
  v103: legacy(),
  v105: legacy(10_000_000n, true),
  v107: legacy(15_000_000n, true),
  m101: legacy(),
  m102: legacy(),
  m103: legacy(),
  m105: legacy(10_000_000n, true),
  minter: legacy(10_000_000n, true),
  StablecoinWallet: modern(9255n, 10355n),
  StablecoinWalletTvm: modern(9255n, 10355n),
  JettonNotcoinWallet: modern(10065n, 10435n),
  Jetton2Wallet: modern(9115n, 10288n, 1026n, 812n),
  JettonWallet: modern(6327n, 7443n, 1026n, 812n),
};
