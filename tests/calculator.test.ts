import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Address, beginCell, Cell, internal, storeMessageRelaxed } from "@ton/core";
import {
  incomingForwardFee,
  minimumAttachment,
  parseConfig,
  profiles,
  suggestedAttachment,
} from "../calculator";

const root = resolve(import.meta.dir, "..");
const rows = JSON.parse(readFileSync(resolve(root, "fixtures/expected-results.json"), "utf8")) as Array<{
  variant: string;
  forward: string;
  commentBytes: number;
  incomingForwardFee: string;
  deployedCodeHash: string;
  minimum: string;
  suggested: string;
}>;

const provenance = JSON.parse(readFileSync(resolve(root, "fixtures/config-provenance.json"), "utf8"));
const config = parseConfig(
  Cell.fromBoc(readFileSync(resolve(root, "fixtures/mainnet-config.boc")))[0],
  Math.floor(Date.parse(provenance.fetchedAt) / 1000),
);

describe("agreement with complete Acton traces", () => {
  test("funding formulas and margin match every recorded scenario", () => {
    const calculated = rows.map(row => {
      const profile = profiles[row.variant];
      const minimum = minimumAttachment(
        profile,
        config,
        BigInt(row.incomingForwardFee),
        BigInt(row.forward),
        row.deployedCodeHash,
      );
      const fixedFloor = profile.family === "legacy" ? 2n * profile.legacyGas! + 10_000_000n : 0n;

      return {
        minimum: minimum.toString(),
        suggested: suggestedAttachment(minimum, fixedFloor).toString(),
      };
    });

    // The fixture is produced by complete Acton traces, not by this calculator.
    expect(calculated).toEqual(rows.map(({ minimum, suggested }) => ({ minimum, suggested })));
  });

  test("serialized request forwarding fees match the owner's action phase", () => {
    const owner = Address.parseRaw(`0:${"11".repeat(32)}`);
    const recipient = Address.parseRaw(`0:${"22".repeat(32)}`);
    const senderJettonWallet = Address.parseRaw(`0:${"33".repeat(32)}`);

    const calculated = rows.map(row => {
      const body = beginCell()
        .storeUint(0x0f8a7ea5, 32)
        .storeUint(1, 64)
        .storeCoins(1_000_000n)
        .storeAddress(recipient)
        .storeAddress(owner)
        .storeBit(false)
        .storeCoins(BigInt(row.forward));

      if (row.commentBytes > 0) {
        const comment = beginCell()
          .storeUint(0, 32)
          .storeBuffer(Buffer.alloc(row.commentBytes, 65))
          .endCell();

        body.storeBit(true).storeRef(comment);
      } else {
        body.storeBit(false);
      }

      const message = internal({
        to: senderJettonWallet,
        value: BigInt(row.minimum),
        bounce: true,
        body: body.endCell(),
      });
      message.info.src = owner;

      const serialized = beginCell().store(storeMessageRelaxed(message)).endCell();
      return incomingForwardFee(serialized, config).toString();
    });

    expect(calculated).toEqual(rows.map(row => row.incomingForwardFee));
  });
});
