import { Cell, Dictionary } from "@ton/core";

const SCALE = 65_536n;

/** Prices from one basechain configuration, shared by jetton and NFT estimates. */
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

/** Convert VM gas units to nanograms using the configured flat charge and ceiling. */
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
