import { computeFee, type FeeConfig } from "./fees";

/**
 * Exact deployed bytecode identifies these initialized NFT item profiles.
 * Gas figures come from successful Acton traces of ordinary ownership transfers.
 * Each tuple contains: no messages, refund only, notification only, both.
 */
export const nftProfiles: Record<string, { name: string; gas: readonly bigint[] }> = {
  ba4d975d2b66231c1f0a0ccca6e8ff8f7ba0610c4b7639584b8e98303dc3128c: {
    name: "NftV1Item",
    gas: [4759n, 6800n, 6692n, 8733n],
  },
  e9d46f1ad4f3d05866b9800a3dc2202e4730bed1d344a54999b5e20f7f5226cc: {
    name: "NftV1EditableItem",
    gas: [4972n, 6913n, 6805n, 8746n],
  },
  "02e3a2370ea36b24eabff810cd84ef63dc180443d0b51adb9d3be4c0ea8f7319": {
    name: "GetgemsNftItemV2",
    gas: [4832n, 6773n, 6665n, 8606n],
  },
  "585913bfeb388db1997d2befb1806f2c79f1821337e1b0e8fb182bdec40e28c2": {
    name: "GetgemsNftEditableItemV2",
    gas: [4954n, 6895n, 6787n, 8728n],
  },
};

/**
 * Calculate a candidate attachment for the four pinned basechain implementations.
 * The caller supplies the balance after storage collection and the actual
 * remaining incoming forward_fee. Recalculate if message serialization changes.
 * No deployment, custom payload, precompiled code, or storage debt is modeled.
 * Always emulate the complete transfer and the final margin before sending.
 */
export function minimumNftAttachment(input: {
  codeHash: string;
  config: FeeConfig;
  balance: bigint;
  incomingForwardFee: bigint;
  forward: bigint;
  response: boolean;
}): bigint {
  const { codeHash, config, balance, incomingForwardFee, forward, response } = input;
  const profile = nftProfiles[codeHash];

  if (!profile) {
    throw new Error(`Unsupported NFT code hash: ${codeHash}`);
  }

  if (config.precompiled.has(codeHash)) {
    throw new Error("Precompiled NFT code requires a new full-trace estimate");
  }

  if (balance < 0n || incomingForwardFee < 0n || forward < 0n) {
    throw new Error("NFT balances and message values must be nonnegative");
  }

  const notification = forward > 0n;
  const branch = (notification ? 2 : 0) + (response ? 1 : 0);
  const gasBudget = computeFee(profile.gas[branch], config);
  const count = BigInt(Number(notification) + Number(response));
  const estimatedForwardFee = incomingForwardFee * 3n / 2n;
  const reserveBudget = 50_000_000n + forward + count * estimatedForwardFee - balance;

  // Existing funds satisfy the storage guard, but do not increase an internal
  // message's initial gas limit. Both bounds must hold; they are not additive.
  return gasBudget > reserveBudget ? gasBudget : reserveBudget;
}
