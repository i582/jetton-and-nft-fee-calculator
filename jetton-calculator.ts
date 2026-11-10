import { ceilDiv, computeFee, originalForwardFee, type FeeConfig } from "./fees";

const SCALE = 65_536n;
const FIVE_YEARS = 5n * 365n * 24n * 3_600n;

/** Funding rules for a pinned jetton-wallet implementation, selected by its code. */
export interface JettonWalletProfile {
  family: "legacy" | "modern";
  legacyGas?: bigint;
  legacyForwardMultiplier?: "raw" | "three-halves";
  alwaysTwoForwards?: boolean;
  sendGas?: bigint;
  receiveGas?: bigint;
  storageBits?: bigint;
  initBits?: bigint;
}

/**
 * Reproduce the sender's strict funding guard, in nanograms.
 * This is a lower bound, not a guarantee that downstream execution succeeds.
 * The caller must identify exact code, supply actual inbound forward_fee, and
 * emulate the complete transfer against current state before submitting it.
 */
export function minimumJettonAttachment(
  profile: JettonWalletProfile,
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

const legacy = (gas = 10_000_000n, updated = false): JettonWalletProfile => ({
  family: "legacy", legacyGas: gas,
  legacyForwardMultiplier: updated ? "three-halves" : "raw",
});

const modern = (sendGas: bigint, receiveGas: bigint, storageBits = 1033n, initBits = 931n): JettonWalletProfile => ({
  family: "modern", sendGas, receiveGas, storageBits, initBits,
});

/** Research labels map to pinned BoCs; production must use the recorded hashes. */
export const jettonProfiles: Record<string, JettonWalletProfile> = {
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
  JettonNotcoinWallet: modern(10065n, 10435n),
  Jetton2Wallet: modern(9115n, 10288n, 1026n, 812n),
  JettonWallet: modern(6327n, 7443n, 1026n, 812n),
};
