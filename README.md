# GRAM budgets for jetton and NFT transfers

This study measures the smallest attachment that completes an ordinary jetton or NFT ownership transfer.
Acton executes original contract bytecode. TypeScript calculators reproduce the measured funding boundaries.

Modern wallet BoCs and ABI interfaces come from the public [TON ABI catalog](https://github.com/ton-blockchain/abis/tree/7dc57067d85c95dc25c09ccaaf108eaba62f6303/data/jettons).

The [jetton report](JETTON_RESULTS.md) and [NFT report](NFT_RESULTS.md) contain the measured amounts.
The [jetton measurements](results/jetton-measurements.json) and [NFT measurements](results/nft-measurements.json) include code hashes, gas usage, retained balances, excesses, and failure diagnostics.
One GRAM equals 1,000,000,000 nanograms. All calculations use integers.

## Run the study

Requirements: Bun and Acton 1.2.0 in `PATH`. The recorded baseline uses Acton `1.2.0 (16d49e1)`.

```bash
git clone https://github.com/i582/jetton-fee-calculator.git
cd jetton-fee-calculator
bun install --frozen-lockfile
bun start
```

The command runs both Acton suites, checks their result snapshots, and writes `JETTON_RESULTS.md` and `NFT_RESULTS.md`.
Contract BoCs and network configuration are local fixtures. Normal runs need no RPC credentials, source downloads, or separate FunC installation.
Acton installs its standard library on first use if `.acton` is absent.
Full diagnostics remain in `results/jetton-acton.log` and `results/nft-acton.log`.

Other commands:

```bash
bun run check
bun test
bun run compile:jettons
bun run report:jettons
bun run report:nfts
```

`compile:jettons` rebuilds historical FunC wallets with project dependencies and checks their code hashes.
It uses FunC 0.4.6 through the pinned `func-js` dependency.
It requires no `NODE_PATH`. TypeScript scripts run directly through Bun.

## Jetton transfer budgets

There is no single efficient attachment for all jetton-wallets.
Modern wallets price gas and storage from network configuration. Older wallets enforce fixed GRAM amounts even when network prices decrease.

At mainnet block 104490013 (2026-11-10), an empty USDT transfer needs **0.001426106 GRAM** with the precompiled contract enabled.
The proposed attachment is **0.0016 GRAM**, after successful emulation.

Jetton 1.2 needs **0.002659439 GRAM**. Jetton 2.0 needs **0.002578373 GRAM**.
Jetton 1.07 still requires **0.040236272 GRAM** because of its fixed funding check.
These amounts apply to the exact message and state described in the report.

The USDT library-reference hash matches a public deployed wallet.
[usdt-code-check.json](fixtures/usdt-code-check.json) records that check.
The transfer scenarios use synthetic accounts, not that holder's state.

## NFT ownership transfers

NFT transfers change the owner of an existing item contract. They do not deploy a recipient jetton-wallet.
The calculator covers four bytecode implementations from the public TON ABI catalog:
standard v1.03, editable v1.02/v1.03, Getgems V2, and Getgems editable V2.
The catalog's NFT 1 and NFT 2.0 item fixtures have identical code hashes and share the same measurements.

At the recorded block, all four need a suggested **0.0007 GRAM** when the NFT already holds 0.05 GRAM.
This assumes one forwarded nanogram, a refund address, and no comment.
After a previous transfer has spent part of that reserve, the standard item needs **0.0009 GRAM** under the same policy.
An NFT with no GRAM needs **0.0504 GRAM** under the same policy. Most of that value stays on the NFT.

The [NFT report](NFT_RESULTS.md) explains the balance-dependent formula and the wallet integration algorithm.
Use `minimumNftAttachment()` from `nft-calculator.ts` for the four supported code hashes, followed by full-trace emulation.
The 36 Acton scenarios cover initial balances, notifications, refunds, and a referenced comment.
They verify ownership changes, outgoing messages, exact failure boundaries, and proposed attachment values.

Sales, auctions, minting, editorship transfers, DNS, TeleMint, Telegram gifts, and custom NFT forks are outside this study.

## Jetton attachment and transaction cost

An attachment is a temporary transfer budget. It includes network costs, forwarded value, storage funding, and possible excesses.
It is not the transaction fee.

The report separates these quantities:

- `minimum`: value attached to the sender's jetton-wallet.
- `pathNetworkCost`: costs within the two jetton-wallets, including their outgoing forwarding fees.
- `excessMessageValue`: value in the emitted refund message, before execution at its destination.
- `senderBalanceAfter` and `receiverBalanceAfter`: GRAM retained by the jetton-wallets.
- `jettonTransactionFees`: the sum of transaction `totalFees` for the two jetton-wallets.

`totalFees` alone misses forwarding fees still carried by outgoing messages.
The report also calculates network cost from conservation of value:

```text
pathNetworkCost = attached - excessMessageValue - forward_ton_amount
                  - changeInSenderGramBalance - changeInReceiverGramBalance
```

The source owner's transaction and execution at refund/notification destinations are outside this metric.
A wallet must estimate those costs separately for its actual wallet contract and batch.

Old wallets retain much more than their nominal 0.01 GRAM storage reserve.
For a new recipient, version 1.07 retains about **0.02493 GRAM** in this experiment.
That retained balance is not a validator fee. It is also not an immediate refund to the user.

## Covered jetton versions

The mapping follows the upstream [version history](https://github.com/ton-blockchain/jetton-contract/blob/jetton-2.0/VERSION_HISTORY.md).
Wallet code hashes, rather than marketing names or getter interfaces, identify the measured implementations.

| Version | Fixture | Treatment |
|---|---|---|
| 1.00 | `v100` | Original code, two forwarding fees even when forward value is zero |
| 1.01 | `v101` | Revised transfer and excess calculation |
| 1.02 | `v102` | Non-bounceable owner notification |
| 1.03 and 1.04 | `v103` | Required Either bit; 1.04 changes the minter |
| 1.05 and 1.06 | `v105` | Improved forward-fee estimate; 1.06 changes the minter |
| 1.07 | `v107` | Fixed gas allowance increases from 0.01 to 0.015 GRAM per wallet |
| 1.01M | `m101` | Original minter.ton.org source |
| 1.02M | `m102` | Original minter.ton.org source |
| 1.03M and 1.04M | `m103` | Same transfer implementation; minter discovery changes separately |
| 1.05M | `m105`, `minter` | Release source and later upstream revision |
| Stablecoin 1.04 / USDT | `StablecoinWallet` | Library deployment with the block's ConfigParam 45 entry |
| Jetton 1.2 / NOT | `JettonNotcoinWallet` | Library deployment |
| Jetton 2.0 | `Jetton2Wallet` | Library deployment, eight-bit owner shard prefix |
| Acton Tolk 2.1 | `JettonWallet` | Additional catalog fixture, full-code deployment |

Mintless claims, swaps, burns, governance operations, and custom wallet forks are outside this study.
Mintless is a separate implementation family in the version history.
The Acton 2.1 row is an additional implementation, not a historical FunC release.

## Jetton measurement method

The study uses mainnet prices from one pinned masterchain block.
[config-provenance.json](fixtures/config-provenance.json) records the block, fetch time, and BoC checksum.
The emulated accounts have no storage debt. Their `last_paid` equals the fixed emulation time.

Each sender starts with 1,000,000,000,000 jetton base units and sends 1,000,000 base units.
Its address derives from zero-balance initial data. The populated balance only changes its current storage.
The receiving owner is uninitialized. The response address is the funded sender relay.

The relay emits a real internal message through its action phase.
This supplies the actual incoming `forward_fee` that the jetton contract reads.
The relay's driver message funds its execution and stays outside the measured attachment.

Each implementation has five scenarios:

- A new recipient wallet, one forwarded nanogram, and an empty payload.
- An existing recipient wallet with 0.01 GRAM, with the same transfer.
- A new recipient wallet with zero forwarded value.
- A new recipient wallet with a 32-byte ASCII comment in a referenced cell.
- A new recipient wallet with zero pre-existing GRAM at the sender's jetton-wallet.

This gives 75 scenarios on the recorded mainnet configuration.

Each binary-search probe restores a complete world snapshot.
A failed probe cannot fund a later probe or leave a recipient deployed.
Success requires the expected balances at both jetton-wallets and notification emission when requested.
The test drains all messages, including bounces and excesses.

The notification carries one nanogram. Its destination can skip computation without invalidating the jetton transfer.
The test requires notification emission, not successful execution of arbitrary recipient code.

The search resolves the boundary to one nanogram and checks both neighboring amounts.
The TypeScript formula independently matches all measured boundaries.
Acton also checks that each suggested attachment completes the transfer.
The complete result table is compared with [jetton-expected-results.json](fixtures/jetton-expected-results.json).

## Jetton funding formulas

For legacy wallets, the sender requires:

```text
attachment > forward_ton_amount + forward_count * estimated_forward_fee
             + 2 * fixed_gas_allowance + 10,000,000
```

The fixed gas allowance is 10,000,000 nanograms, or 15,000,000 for version 1.07.
Version 1.00 always uses two forwards. Later versions use two only when forwarded value is positive.
Versions before 1.05 use the incoming remaining forwarding fee directly.
Version 1.05 and later use `floor(incoming_forward_fee * 3 / 2)`.

For the modern implementations, the sender requires:

```text
attachment > forward_ton_amount + forward_count * original_forward_fee
             + StateInit_forwarding_overhead
             + compute_fee(sender_gas) + compute_fee(receiver_gas)
             + five_year_storage_reserve
```

The calculator uses configuration parameters 18, 21, 25, and 45.
Its gas constants and cell-size bounds correspond to the pinned implementations.
For USDT, ConfigParam 45 uses the **deployed library-reference hash**.
Using the resolved code hash instead misses the precompiled discount.

Every strict comparison adds one nanogram to the calculated right-hand side.
`jetton-calculator.ts` preserves the protocol's integer ceilings and floors.
The shared `fees.ts` module provides network pricing, `incomingForwardFee()`, and `suggestedAttachment()` for both calculators.
`incomingForwardFee()` calculates the remaining forwarding fee from the exact serialized internal message.

## Jetton wallet integration algorithm

- Read sender code, recipient state, library availability, and network configuration from a consistent block.
- Match the deployed code and resolved library hash against a supported profile.
- Build the exact TEP-74 request with its real amount, response address, forward value, and payload.
- Calculate the inbound forwarding fee from the actual owner-wallet message serialization.
- Calculate the sender's funding threshold with `minimumJettonAttachment()`.
- Emulate the complete transfer against actual account state, including deployment and bounces.
- If the trace fails because of funding, increase the budget and repeat from the original state.
- If the trace fails because of a lock, authorization, balance, or invalid payload, report that error instead.
- Find the smallest successful attachment, then apply `suggestedAttachment()` and emulate that final amount.

Unknown code, frozen accounts, storage debt, unavailable libraries, custom payloads, and unusual recipients require a full trace estimate.
Successful execution at the sender alone is insufficient.
The fixed table is a reference for these fixtures, not a replacement for emulation with actual account state.

The proposed margin adds the larger of 0.0001 GRAM and 5% of the variable budget.
It rounds upward to 0.0001 GRAM. Legacy fixed GRAM allowances do not receive a percentage markup.
The margin is a product policy. It does not cover an arbitrary network price increase.

For wallet UI, show the predicted network cost separately from the required attachment.
Show retained storage funding and the expected refund when relevant.
The user must have the attachment plus the ordinary wallet's own execution and forwarding budget.

## Refresh inputs

The jetton source revisions are recorded in [jetton-sources.json](fixtures/jetton-sources.json).

To download the same pinned upstream jetton sources:

```bash
bun run refresh:jettons
bun run compile:jettons
```

To replace the configuration with a new mainnet block:

```bash
bun run refresh:config
bun start
```

A changed result fails the snapshot comparison.
After review, accept the new baseline with `bun start --update`.
The update flag changes both accepted result snapshots explicitly.

To download the same NFT bytecode and ABI interfaces from the pinned public catalog:

```bash
bun run refresh:nfts
```
