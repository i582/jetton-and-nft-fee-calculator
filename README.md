# GRAM budgets for jetton and NFT transfers

This study measures the smallest attachment that completes an ordinary jetton or NFT ownership transfer.
Acton executes original contract bytecode. TypeScript calculators reproduce the measured funding boundaries.

Modern jetton-wallet and NFT item BoCs and ABI interfaces come from the public [TON ABI catalog](https://github.com/ton-blockchain/abis/tree/7dc57067d85c95dc25c09ccaaf108eaba62f6303/data).

The [jetton report](JETTON_RESULTS.md) and [NFT report](NFT_RESULTS.md) contain the measured amounts.
Both reports link to measurements with code hashes, gas usage, retained balances, excesses, and failure diagnostics.
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

The following amounts use mainnet block **104490013**, recorded on **2026-11-10**. All table amounts use GRAM.
The sender's jetton-wallet starts with 0.01 GRAM. The recipient's jetton-wallet does not exist.
Each request transfers 1,000,000 jetton base units, forwards one nanogram, and requests a refund to the sender.
The request contains no comment or custom payload.

| Implementation | Minimum attachment | Suggested attachment | Transfer network cost |
|---|---:|---:|---:|
| Stablecoin / USDT | 0.001426106 | 0.001600000 | 0.000424938 |
| Jetton 1.2 / NOT | 0.002659439 | 0.002800000 | 0.001618138 |
| Jetton 2.0 | 0.002578373 | 0.002800000 | 0.001577071 |
| Acton Tolk 2.1 | 0.002202839 | 0.002400000 | 0.001600271 |
| Jetton 1.07 | 0.040236272 | 0.040400000 | 0.002105738 |

Network costs correspond to the minimum attachment. They exclude the owner's transaction and execution at notification and refund destinations.
USDT uses the precompiled contract entry in the recorded configuration.
Jetton 1.07 requires a much larger attachment because its funding check uses fixed GRAM amounts.
The [jetton report](JETTON_RESULTS.md) includes all 15 fixtures, retained balances, and refunds.

The USDT library-reference hash matches a public deployed wallet.
[usdt-code-check.json](fixtures/usdt-code-check.json) records that check.
The transfer scenarios use synthetic accounts, not that holder's state.

## NFT transfer budgets

An NFT transfer changes the owner of an existing item contract.
Its current GRAM balance helps satisfy the contract's reserve check.

These amounts use the same mainnet block as the jetton table. All table amounts use GRAM.
Each initialized NFT starts with 0.05 GRAM. Each request forwards one nanogram and requests a refund to the current owner.
The request contains no comment or custom payload. The new owner is uninitialized.

| Implementation | Minimum attachment | Suggested attachment | Transfer network cost |
|---|---:|---:|---:|
| Standard v1.03 | 0.000582201 | 0.000700000 | 0.000746469 |
| Editable v1.02/v1.03 | 0.000583068 | 0.000700000 | 0.000747336 |
| Getgems V2 | 0.000573734 | 0.000700000 | 0.000738002 |
| Getgems editable V2 | 0.000581868 | 0.000700000 | 0.000746136 |

Network costs correspond to the minimum attachment. They exclude the owner's transaction and execution at notification and refund destinations.
Network cost can exceed the attachment because the NFT pays some costs from its existing balance.
The [NFT report](NFT_RESULTS.md) includes retained balances, refunds, and message options.

### Effect of the NFT balance

For the standard v1.03 item, the same request produces these results:

| Initial NFT balance | Minimum attachment | Suggested attachment | NFT balance after | Excess message value |
|---|---:|---:|---:|---:|
| 0.000000000 | 0.050232539 | 0.050400000 | 0.049486069 | 0.000000000 |
| 0.010000000 | 0.040232539 | 0.040400000 | 0.049486069 | 0.000000000 |
| 0.049486069 | 0.000746470 | 0.000900000 | 0.049486069 | 0.000000000 |
| 0.050000000 | 0.000582201 | 0.000700000 | 0.049486069 | 0.000349662 |
| 0.100000000 | 0.000582201 | 0.000700000 | 0.049486069 | 0.050349662 |

Balances and refunds correspond to the minimum attachment. Network cost is **0.000746469 GRAM** in every row.
The 0.049486069 GRAM initial balance is the amount left by a preceding transfer.
An empty NFT needs about 0.05 GRAM of funding, but most of that value stays on the NFT.
A refund can also include funds that the NFT held before the transfer.

## Attachment and transaction cost

An attachment is a temporary transfer budget. It includes network costs, forwarded value, storage funding, and possible excesses.
It is not the transaction fee.

Both measurement files separate these quantities:

| Quantity | Jetton measurements | NFT measurements |
|---|---|---|
| Attached value | `minimum`, sent to the sender's jetton-wallet | `minimum`, sent to the NFT item |
| Budget with margin | `suggested` | `suggested` |
| Transfer network cost | `pathNetworkCost`, across both jetton-wallets | `pathNetworkCost`, within the NFT item |
| Refund before destination execution | `excessMessageValue` | `excessMessageValue` |
| Retained GRAM | `senderBalanceAfter`, `receiverBalanceAfter` | `balanceAfter` |
| Transaction `totalFees` | `jettonTransactionFees`, summed across both jetton-wallets | `transactionFees`, for the NFT item |

`totalFees` alone misses forwarding fees still carried by outgoing messages.
Both reports calculate network cost from conservation of value:

```text
pathNetworkCost = attached - excessMessageValue - forward_ton_amount
                  - changeInContractGramBalances
```

For jettons, the balance change includes both jetton-wallets. For NFTs, it includes the item contract.
The source owner's transaction and execution at refund/notification destinations are outside this metric.
A wallet must estimate those costs separately for its actual wallet contract and batch.

Old wallets retain much more than their nominal 0.01 GRAM storage reserve.
For a new recipient, version 1.07 retains about **0.02493 GRAM** in this experiment.
That retained balance is not a validator fee. It is also not an immediate refund to the user.
NFTs can spend part of their existing balance or return it to the sender.
Their attachment, retained balance, and refund must remain separate in the wallet UI.

## Covered jetton versions

The mapping follows the upstream [version history](https://github.com/ton-blockchain/jetton-contract/blob/jetton-2.0/VERSION_HISTORY.md).
Wallet code hashes, rather than marketing names or getter interfaces, identify the measured implementations.

| Version | Fixture | Treatment |
|---|---|---|
| 1.00 | `v100` | Original code, two forwarding fees even when forward value is zero |
| 1.01 | `v101` | Revised transfer and excess calculation |
| 1.02 | `v102` | Non-bounceable owner notification |
| 1.03 and 1.04 | `v103` | Required Either bit. Version 1.04 changes the minter |
| 1.05 and 1.06 | `v105` | Improved forward-fee estimate. Version 1.06 changes the minter |
| 1.07 | `v107` | Fixed gas allowance increases from 0.01 to 0.015 GRAM per wallet |
| 1.01M | `m101` | Original minter.ton.org source |
| 1.02M | `m102` | Original minter.ton.org source |
| 1.03M and 1.04M | `m103` | Same transfer implementation. Minter discovery changes separately |
| 1.05M | `m105`, `minter` | Release source and later upstream revision |
| Stablecoin 1.04 / USDT | `StablecoinWallet` | Library deployment with the block's ConfigParam 45 entry |
| Jetton 1.2 / NOT | `JettonNotcoinWallet` | Library deployment |
| Jetton 2.0 | `Jetton2Wallet` | Library deployment, eight-bit owner shard prefix |
| Acton Tolk 2.1 | `JettonWallet` | Additional catalog fixture, full-code deployment |

Mintless claims, swaps, burns, governance operations, and custom wallet forks are outside this study.
Mintless is a separate implementation family in the version history.
The Acton 2.1 row is an additional implementation, not a historical FunC release.

## Covered NFT versions

The mapping uses the pinned [NFT catalog](https://github.com/ton-blockchain/abis/tree/7dc57067d85c95dc25c09ccaaf108eaba62f6303/data/nfts).
The calculator selects each implementation by its exact code hash.
[nft-sources.json](fixtures/nft-sources.json) records those hashes and public download URLs.

| Version | Fixture | Treatment |
|---|---|---|
| Standard v1.03 | `NftV1Item` | Initialized item, ownership transfer |
| Editable v1.02/v1.03 | `NftV1EditableItem` | Ownership changes, editor and content remain unchanged |
| Getgems V2 | `GetgemsNftItemV2` | Initialized item, ownership transfer |
| Getgems editable V2 | `GetgemsNftEditableItemV2` | Ownership changes, editor and content remain unchanged |

The catalog's NFT 1 and NFT 2.0 item fixtures have identical bytecode. Each unique implementation has one set of measurements.
This coverage does not include every historical NFT release or simple-schema variant.
Sales, auctions, minting, editorship transfers, DNS, TeleMint, Telegram gifts, and custom NFT forks are outside this study.

## Measurement method

The study uses mainnet prices from one pinned masterchain block.
[config-provenance.json](fixtures/config-provenance.json) records the block, fetch time, and BoC checksum.
The emulated accounts have no storage debt. Their `last_paid` equals the fixed emulation time.

The relay emits a real internal message through its action phase.
This supplies the actual incoming `forward_fee` that each contract reads.
The relay's driver message funds its execution and stays outside the measured attachment.

### Jetton scenarios

Each sender starts with 1,000,000,000,000 jetton base units and sends 1,000,000 base units.
Its address derives from zero-balance initial data. The populated balance only changes its current storage.
The receiving owner is uninitialized. The response address is the funded sender relay.

Each of the 15 fixtures has five scenarios:

- A new recipient wallet, one forwarded nanogram, and an empty payload.
- An existing recipient wallet with 0.01 GRAM, with the same transfer.
- A new recipient wallet with zero forwarded value.
- A new recipient wallet with a 32-byte ASCII comment in a referenced cell.
- A new recipient wallet with zero pre-existing GRAM at the sender's jetton-wallet.

This gives 75 scenarios on the recorded mainnet configuration.

### NFT scenarios

Each NFT is initialized with an owner and short metadata. Editable items also have an editor.
Its address derives from the item index, collection address, and code. Current ownership and GRAM balance do not enter address derivation.
The new owner is uninitialized. The current owner's funded relay receives refunds, except in scenarios without a response address.

Each of the four fixtures has nine scenarios:

| Scenario | Initial NFT balance | Forwarded value | Comment bytes | Refund requested |
|---|---|---|---:|---|
| Empty balance | 0 GRAM | 1 nanogram | 0 | Yes |
| Low balance | 0.01 GRAM | 1 nanogram | 0 | Yes |
| Nominal reserve | 0.05 GRAM | 1 nanogram | 0 | Yes |
| Subsequent transfer | Balance left by the nominal-reserve scenario | 1 nanogram | 0 | Yes |
| Surplus balance | 0.1 GRAM | 1 nanogram | 0 | Yes |
| No notification | 0.05 GRAM | 0 nanograms | 0 | Yes |
| Referenced comment | 0.05 GRAM | 1 nanogram | 32 | Yes |
| No refund | 0.05 GRAM | 1 nanogram | 0 | No |
| No outgoing messages | 0.05 GRAM | 0 nanograms | 0 | No |

This gives 36 scenarios on the same mainnet configuration.

### Success checks

Each binary-search probe restores a complete world snapshot.
A failed probe cannot fund a later probe or leave a recipient deployed.
The tests process all messages, including bounces and excesses.

For jettons, success requires the expected balances at both jetton-wallets and emission of the requested notification.
For NFTs, success requires a committed owner change and a successful action phase.
The NFT checks also require the requested notification and refund, unchanged content, and an unchanged editor for editable items.

Notifications carry one nanogram. Their destinations can skip computation without invalidating either transfer.
The tests require notification emission, not successful execution of arbitrary recipient code.

The search resolves the boundary to one nanogram and checks both neighboring amounts.
The TypeScript calculators match all measured boundaries.
Acton also checks that each suggested attachment completes the transfer.
The complete results must match [jetton-expected-results.json](fixtures/jetton-expected-results.json) and [nft-expected-results.json](fixtures/nft-expected-results.json).

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

## NFT funding formula

For the four supported NFT code hashes, the calculator uses:

```text
forward_count = (forward_ton_amount > 0 ? 1 : 0)
                + (response_destination exists ? 1 : 0)
estimated_forward_fee = floor(incoming_forward_fee * 3 / 2)
reserve_bound = 50,000,000 - NFT_balance + forward_ton_amount
                + forward_count * estimated_forward_fee
attachment = max(compute_fee(transfer_gas), reserve_bound)
```

All amounts in this formula use nanograms. `NFT_balance` is the balance after storage collection.
The reserve check accepts equality. It does not need the extra nanogram used for strict jetton funding checks.

Existing funds satisfy the reserve check, but they do not increase the incoming message's initial gas limit.
The attachment must satisfy both bounds. The calculator takes their maximum rather than their sum.

Gas usage depends on the implementation and the requested outgoing messages.
The following gas units come from successful Acton traces:

| Fixture | No messages | Refund only | Notification only | Both messages |
|---|---:|---:|---:|---:|
| `NftV1Item` | 4759 | 6800 | 6692 | 8733 |
| `NftV1EditableItem` | 4972 | 6913 | 6805 | 8746 |
| `GetgemsNftItemV2` | 4832 | 6773 | 6665 | 8606 |
| `GetgemsNftEditableItemV2` | 4954 | 6895 | 6787 | 8728 |

`minimumNftAttachment()` in `nft-calculator.ts` combines these gas profiles with the configuration prices and reserve check.
Its result matches all 36 measured boundaries. The gas profiles cover the recorded initialized items and message layouts.
Other code, custom payloads, storage debt, or future precompiled NFT implementations require a new full-trace estimate.

## Wallet integration algorithm

- Read contract code, account state, and network configuration from one consistent block.
- Match the deployed code against a supported profile. For library deployments, also check the resolved library hash and availability.
- Build the exact TEP-74 jetton request or TEP-62 NFT request.
- Calculate the inbound forwarding fee from the actual owner-wallet message serialization.
- Calculate the candidate attachment with the corresponding function below.
- If the attachment changes the message serialization, recalculate the forwarding fee and candidate.
- Emulate the complete transfer against actual account state, including deployment and bounces.
- If the trace fails because of funding, increase the budget and repeat from the original state.
- If the trace fails because of a lock, authorization, balance, or invalid payload, report that error instead.
- Find the smallest successful attachment, then apply `suggestedAttachment()` and emulate that final amount.

| Transfer | Calculator | Required success checks |
|---|---|---|
| Jetton | `minimumJettonAttachment()` in `jetton-calculator.ts` | Expected balances at both jetton-wallets and requested notification |
| NFT | `minimumNftAttachment()` in `nft-calculator.ts` | Committed owner change, successful action phase, requested notification and refund |

For NFTs, also check that the item is initialized and the sender is its current owner.
Use the actual NFT balance after storage collection.

Unknown code, frozen accounts, storage debt, unavailable libraries, custom payloads, and unusual recipients require a full trace estimate.
Successful execution at the sender alone is insufficient.
The fixed table is a reference for these fixtures, not a replacement for emulation with actual account state.

The proposed margin adds the larger of 0.0001 GRAM and 5% of the variable budget.
It rounds upward to 0.0001 GRAM. The `fixedFloor` argument excludes fixed funding from the percentage calculation:

| Transfer | `fixedFloor` for `suggestedAttachment()` |
|---|---|
| Modern jetton-wallet | `0` |
| Legacy jetton-wallet | `2 * fixed_gas_allowance + 10,000,000` nanograms |
| NFT item | `max(0, 50,000,000 - NFT_balance)` nanograms |

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
