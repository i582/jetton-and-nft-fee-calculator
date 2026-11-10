# GRAM budgets for ordinary jetton transfers

This study measures the smallest attachment that completes an ordinary jetton transfer.
Acton executes original wallet bytecode. A TypeScript calculator reproduces each contract's funding check.

The [generated report](RESULTS.md) contains the measured amounts.
The [complete measurements](results/measurements.json) include code hashes, gas usage, retained balances, excesses, and failure diagnostics.
One GRAM equals 1,000,000,000 nanograms. All calculations use integers.

## Run the study

Requirements: Bun and Acton 1.2.0 in `PATH`. The recorded baseline uses Acton `1.2.0 (16d49e1)`.

```bash
cd research/jetton-transfer-fees
bun install --frozen-lockfile
bun start
```

The command runs Acton, checks the result snapshot, and writes `RESULTS.md`.
Contract BoCs and network configuration are local fixtures. Normal runs need no RPC credentials, source downloads, or separate FunC installation.
Acton installs its standard library on first use if `.acton` is absent.
Full diagnostics remain in `results/acton.log`.

Other commands:

```bash
bun run check
bun test
bun run compile:func
bun run report
```

`compile:func` rebuilds historical FunC wallets with project dependencies and checks their code hashes.
It requires no `NODE_PATH`. TypeScript scripts run directly through Bun.

## Main finding

There is no single efficient attachment for all jetton-wallets.
Modern wallets price gas and storage from network configuration. Older wallets enforce fixed GRAM amounts even when network prices decrease.

At mainnet block 104490013 (2026-11-10), an empty USDT transfer needs **0.001426106 GRAM** with the precompiled contract enabled.
The proposed attachment is **0.0016 GRAM**, after successful emulation.
The same code without the precompiled discount needs **0.002600105 GRAM**.

Jetton 1.2 needs **0.002659439 GRAM**. Jetton 2.0 needs **0.002578373 GRAM**.
Jetton 1.07 still requires **0.040236272 GRAM** because of its fixed funding check.
These amounts apply to the exact message and state described in the report.

The USDT library-reference hash matches a public deployed wallet.
[usdt-code-check.json](fixtures/usdt-code-check.json) records that check.
The transfer scenarios use synthetic accounts, not that holder's state.

## Attached value and transaction cost

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

## Covered versions

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
| Stablecoin without precompilation | `StablecoinWalletTvm` | Same code and prices, with ConfigParam 45 cleared |
| Jetton 1.2 / NOT | `JettonNotcoinWallet` | Library deployment |
| Jetton 2.0 | `Jetton2Wallet` | Library deployment, eight-bit owner shard prefix |
| Acton Tolk 2.1 | `JettonWallet` | Additional catalog fixture, full-code deployment |

Mintless claims, swaps, burns, governance operations, and custom wallet forks are outside this study.
Mintless is a separate implementation family in the version history.
The Acton 2.1 row is an additional implementation, not a historical FunC release.

## Measurement method

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

Two additional scenarios disable precompilation for the stablecoin wallet.
This gives 77 scenarios in total.

Each binary-search probe restores a complete world snapshot.
A failed probe cannot fund a later probe or leave a recipient deployed.
Success requires the expected balances at both jetton-wallets and notification emission when requested.
The test drains all messages, including bounces and excesses.

The notification carries one nanogram. Its destination can skip computation without invalidating the jetton transfer.
The test requires notification emission, not successful execution of arbitrary recipient code.

The search resolves the boundary to one nanogram and checks both neighboring amounts.
The TypeScript formula independently matches all measured boundaries.
Acton also checks that each suggested attachment completes the transfer.
The complete result table is compared with [expected-results.json](fixtures/expected-results.json).

## Funding formulas

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
`calculator.ts` preserves the protocol's integer ceilings and floors.
`incomingForwardFee()` calculates the remaining forwarding fee from the exact serialized internal message.

## Wallet integration algorithm

- Read sender code, recipient state, library availability, and network configuration from a consistent block.
- Match the deployed code and resolved library hash against a supported profile.
- Build the exact TEP-74 request with its real amount, response address, forward value, and payload.
- Calculate the inbound forwarding fee from the actual owner-wallet message serialization.
- Calculate the sender's funding threshold with `minimumAttachment()`.
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

To download the same pinned upstream sources:

```bash
bun run refresh
bun run compile:func
```

To replace the configuration with a new mainnet block:

```bash
bun tools/fetch-sources.ts --config
bun start
```

A changed result fails the snapshot comparison.
After review, accept the new baseline with `bun start --update`.
The update flag changes `fixtures/expected-results.json` explicitly.

## Files and sources

| Path | Purpose |
|---|---|
| `tests/fees.test.tolk` | Acton scenarios, snapshot restoration, and boundary search |
| `contracts/Relay.tolk` | Owner relay that supplies authentic forwarding fees |
| `contracts/*.boc` | Original wallet bytecode |
| `contracts/*.types.tolk` | ABI interfaces for modern precompiled BoCs |
| `calculator.ts` | Integer funding formulas and proposed margin |
| `tools/*.ts` | Source download, historical compilation, execution, and report generation |
| `fixtures/` | Configuration, source revisions, provenance, and expected measurements |
| `vendor/` | Pinned upstream FunC sources and their license files |
| `results/` | Latest measurements and local diagnostic logs |

Historical wallets compile with FunC 0.4.6 through the pinned `func-js` dependency.
The resulting code hashes match the recorded catalog variants where those variants exist.
Modern BoCs and ABI interfaces came from the local `~/abis` catalog.
The study includes those files, so another machine does not need that directory.

Upstream sources retain their original comments and terminology. Their license files apply to those sources.
The pinned revisions are recorded in [sources.json](fixtures/sources.json).

Primary references:

- [Jetton version history](https://github.com/ton-blockchain/jetton-contract/blob/jetton-2.0/VERSION_HISTORY.md)
- [Stablecoin gas checks](https://github.com/ton-blockchain/stablecoin-contract/blob/main/contracts/gas.fc)
- [Jetton 1.2 gas checks](https://github.com/ton-blockchain/jetton-contract/blob/main/contracts/gas.fc)
- [TON precompiled contracts](https://docs.ton.org/foundations/precompiled)
- [TEP-74](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md)
- [Acton precompiled BoC workflow](https://ton-blockchain.github.io/acton/docs/building/precompiled-boc)
