# GRAM budgets for ordinary NFT transfers

Mainnet configuration: masterchain block **104490013**, fetched at **2026-11-10T05:07:20.000Z**.
All amounts use GRAM. These are ownership transfers of initialized NFT items.
Sales, auctions, minting, editorship transfers, and metadata changes are outside this study.

## Funded NFT items

Each NFT starts with 0.05 GRAM. The request forwards one nanogram to the new owner,
uses the current owner as the response address, and has no comment or custom payload.

| Implementation | Minimum attachment | Suggested attachment | NFT-path network cost | NFT balance after | Excess message value |
|---|---:|---:|---:|---:|---:|
| NftV1Item | 0.000582201 | 0.000700000 | 0.000746469 | 0.049486069 | 0.000349662 |
| NftV1EditableItem | 0.000583068 | 0.000700000 | 0.000747336 | 0.049485202 | 0.000350529 |
| GetgemsNftItemV2 | 0.000573734 | 0.000700000 | 0.000738002 | 0.049494536 | 0.000341195 |
| GetgemsNftEditableItemV2 | 0.000581868 | 0.000700000 | 0.000746136 | 0.049486402 | 0.000349329 |

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
| 0.000000000 | 0.050232539 | 0.050400000 | 0.000746469 | 0.049486069 | 0.000000000 |
| 0.010000000 | 0.040232539 | 0.040400000 | 0.000746469 | 0.049486069 | 0.000000000 |
| 0.050000000 | 0.000582201 | 0.000700000 | 0.000746469 | 0.049486069 | 0.000349662 |
| 0.049486069 | 0.000746470 | 0.000900000 | 0.000746469 | 0.049486069 | 0.000000000 |
| 0.100000000 | 0.000582201 | 0.000700000 | 0.000746469 | 0.049486069 | 0.050349662 |

A nearly empty NFT needs about 0.05 GRAM of funding. Most of that value stays on the NFT.
It is not a validator fee. The final balance can be below 0.05 GRAM because computation spends part of that reserve.
The balance table also includes another transfer from the balance left by the preceding one.
That ordinary subsequent transfer needs a suggested **0.000900000 GRAM** for the standard item.
An excess refund can include funds that were already on the NFT before the transfer.
Do not present the entire refund as unused value from the new attachment.

## Message options

Standard item, initial balance 0.05 GRAM:

| Forwarded value | Comment bytes | Refund requested | Minimum attachment | Suggested attachment | NFT-path network cost |
|---|---:|---|---:|---:|---:|
| 0.000000001 | 0 | Yes | 0.000582201 | 0.000700000 | 0.000746469 |
| 0.000000000 | 0 | Yes | 0.000453334 | 0.000600000 | 0.000520001 |
| 0.000000001 | 32 | Yes | 0.000582201 | 0.000700000 | 0.000772336 |
| 0.000000001 | 0 | No | 0.000446134 | 0.000600000 | 0.000543735 |
| 0.000000000 | 0 | No | 0.000317268 | 0.000500000 | 0.000317268 |

With no response address, unused funds stay on the NFT. With zero forward value, no ownership notification is emitted.
A referenced 32-byte comment increases forwarding cost, although the gas bound still determines the funded item's minimum here.

## Calculation and wallet integration

For these four code hashes, calculate a candidate with [minimumNftAttachment()](nft-calculator.ts):

```text
count = (forward_ton_amount > 0 ? 1 : 0) + (response_destination exists ? 1 : 0)
estimated_forward_fee = floor(incoming_forward_fee * 3 / 2)
reserve_bound = 50,000,000 - NFT_balance + forward_ton_amount + count * estimated_forward_fee
attachment = max(compute_fee(transfer_gas), reserve_bound)
```

All formula inputs use nanograms. The reserve guard accepts equality; there is no extra nanogram for a strict comparison.
Gas figures depend on the implementation and whether notification and refund messages are requested.
They are calibrated from full Acton traces, then checked against all 36 scenarios.
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

Run `bun start` to measure jettons and NFTs. Acton checks all 36 NFT boundaries and suggested values.
The TypeScript formula must match each boundary. The accepted snapshot must also match.
The jetton measurements are checked separately and remain unchanged.

Full results: [nft-measurements.json](results/nft-measurements.json).
Full execution log: `results/nft-acton.log`.
Use `bun run refresh:nfts` to download the same pinned public catalog fixtures.
