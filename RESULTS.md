# GRAM budgets for ordinary jetton transfers

Mainnet configuration: masterchain block **104490013**. All amounts use GRAM.
Configuration fetched at **2026-11-10T05:07:20.000Z**.

The recipient jetton-wallet does not exist before the transfer. Each transfer sends 1,000,000 jetton base units.
The request sets forward_ton_amount to 1 nanogram and response_destination to the sender. It contains no comment.

| Bytecode | Minimum attachment | Suggested attachment | Jetton-path network cost | Retained at recipient | Excess message value |
|---|---:|---:|---:|---:|---:|
| v100 | 0.030157516 | 0.030300000 | 0.002096471 | 0.019660557 | 0.008400487 |
| v101 | 0.030157516 | 0.030300000 | 0.002085472 | 0.019699669 | 0.008372374 |
| v102 | 0.030157516 | 0.030300000 | 0.002085472 | 0.019699669 | 0.008372374 |
| v103 | 0.030157516 | 0.030300000 | 0.002096672 | 0.019702513 | 0.008358330 |
| v105 | 0.030236272 | 0.030400000 | 0.002105738 | 0.019931404 | 0.008199129 |
| v107 | 0.040236272 | 0.040400000 | 0.002105738 | 0.024931404 | 0.013199129 |
| m101 | 0.030157516 | 0.030300000 | 0.002073405 | 0.019684047 | 0.008400063 |
| m102 | 0.030157516 | 0.030300000 | 0.002073405 | 0.019684047 | 0.008400063 |
| m103 | 0.030157516 | 0.030300000 | 0.002084604 | 0.019686891 | 0.008386020 |
| m105 | 0.030236272 | 0.030400000 | 0.002093672 | 0.019911138 | 0.008231461 |
| minter | 0.030236272 | 0.030400000 | 0.002093672 | 0.019911138 | 0.008231461 |
| StablecoinWallet | 0.001426106 | 0.001600000 | 0.000424938 | 0.001001167 | 0.000000000 |
| JettonNotcoinWallet | 0.002659439 | 0.002800000 | 0.001618138 | 0.000974433 | 0.000066867 |
| Jetton2Wallet | 0.002578373 | 0.002800000 | 0.001577071 | 0.001001301 | 0.000000000 |
| JettonWallet | 0.002202839 | 0.002400000 | 0.001600271 | 0.000602567 | 0.000000000 |
| StablecoinWalletTvm | 0.002600105 | 0.002800000 | 0.001576137 | 0.001023967 | 0.000000000 |

Costs, retained balances, and excesses correspond to the **minimum attachment**.
They do not represent the suggested attachment.
The network cost excludes the source owner's transaction and execution of notification/excess messages at their destinations.

The suggested attachment adds max(0.0001 GRAM, 5% of the variable budget), then rounds upward to 0.0001 GRAM.
This margin is a proposed wallet policy after successful emulation. It does not guarantee success for arbitrary state or payloads.

Acton checked **77** scenarios. Each minimum completes the transfer and satisfies both jetton balance checks.
One nanogram less fails. The TypeScript formula matches every Acton minimum.
Each suggested attachment also completes the corresponding Acton transfer.

Full measurements, code hashes, and boundary diagnostics: [measurements.json](results/measurements.json).
Method, version mapping, and wallet integration guidance: [README.md](README.md).
