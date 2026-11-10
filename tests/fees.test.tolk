import "@stdlib/exotic-cells"
import "@acton/boc"
import "@acton/build"
import "@acton/fmt"
import "@acton/fs"
import "@acton/io"
import "@acton/emulation/config"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/tlb/maybe"
import "@acton/types/big_array"
import "@acton/types/message"
import "@acton/types/transaction"
import "../contracts/Relay"
import "../fixtures/config-time"

/// Common TEP-74 body; the Either tag is included in forwardPayload.
struct (0x0f8a7ea5) Transfer {
    queryId: uint64 = 1
    amount: coins = 1000000
    destination: address
    response: address?
    customPayload: cell? = null
    forward: coins
    forwardPayload: RemainingBitsAndRefs
}

enum WalletLayout {
    Legacy
    StatusPrefix
    Sharded
}

/// Wallet fixtures use an authentic zero-balance deployment address and funded data.
struct Variant {
    name: string
    kind: WalletLayout
    library: bool
}

fun walletData(
    layout: WalletLayout,
    balance: coins,
    owner: address,
    master: address,
    code: cell,
): cell {
    var data = beginCell();

    if (layout == WalletLayout.StatusPrefix) {
        data.storeUint(0, 4);
    }

    data.storeCoins(balance).storeAddress(owner).storeAddress(master);

    if (layout == WalletLayout.Legacy) {
        data.storeRef(code);
    }

    return data.endCell();
}

/// Install only local synthetic state. No network account is modified.
fun installAccount(addr: address, code: cell, data: cell, balance: coins) {
    val state = StateInit {
        code,
        data,
        fixedPrefixLength: null,
        special: null,
        library: null,
    };
    val (cells, bits, _) = state.toCell().calculateSizeStrict(10000);

    val account: TlbAccount = TlbAccountInfo {
        addr,
        storageStat: {
            used: { cells, bits },
            storageExtra: TlbStorageExtraNone {},
            lastPaid: testing.getNow(),
            duePayment: TlbMaybe.none(),
        },
        storage: {
            lastTransLt: 0,
            balance: { grams: balance, other: [] },
            state: TlbAccountStateActive { stateInit: state },
        },
    };

    testing.setShardAccount(
        addr,
        {
            account: account.toCell() as cell as Cell<TlbAccount>,
            lastTransHash: 0,
            lastTransLt: 0,
        },
    );
}

fun walletAddress(variant: Variant, owner: address, master: address, code: cell): address {
    // A wallet's address uses its initial zero jetton balance. Its current
    // funded balance must never participate in address derivation.
    val state: ContractState = { code, data: walletData(variant.kind, 0, owner, master, code) };

    val deploy = variant.kind == WalletLayout.Sharded
        ? AutoDeployAddress {
            stateInit: state,
            toShard: { fixedPrefixLength: 8, closeTo: owner },
        }
        : AutoDeployAddress { stateInit: state };

    return deploy.calculateAddress();
}

fun jettonBalance(addr: address, layout: WalletLayout): int {
    val account = testing.getAccountState(addr);

    if (account == null) {
        return -1;
    }

    val state = account!.storage.state;

    if (state !is TlbAccountStateActive) {
        return -1;
    }

    var data = state.stateInit.data!.beginParse();

    if (layout == WalletLayout.StatusPrefix) {
        data.skipBits(4);
    }

    return data.loadCoins();
}

/// A complete transfer observation. Missing compute phases keep exit code -999.
/// fees contains transaction totalFees, while retained balances permit a
/// separate conservation-based calculation that includes carried forwarding fees.
struct Observation {
    success: bool
    senderExit: int = -999
    receiverExit: int = -999
    senderGas: int = 0
    receiverGas: int = 0
    fees: int = 0
    excess: int = 0
    incomingForwardFee: int = 0
    senderGrams: int = 0
    receiverGrams: int = 0
    notification: bool = false
}

/// Restore every attempt so failed probes cannot subsidize the next probe.
/// Success requires both jetton balances and the requested notification emission.
fun attempt(
    variant: Variant,
    sender: address,
    receiver: address,
    owner: address,
    body: Transfer,
    attached: coins,
): Observation {
    expect(testing.loadSnapshot("build/checkpoint.json")).toBeTrue();

    // The relay's action phase supplies the real incoming forward_fee. A
    // directly injected transfer could bypass this part of the funding guard.
    val txs = net.send(
        randomAddress("driver"),
        createMessage({
            bounce: false,
            value: grams("0.3"),
            dest: owner,
            body: RelayTransfer {
                destination: sender,
                attached,
                body: body.toCell(),
            },
        }),
    );

    var result = Observation { success: false };
    var transactionIndex = 0;

    while (transactionIndex < txs.size()) {
        val item = txs.at(transactionIndex);
        val tx = item.tx.load();
        val incoming = tx.loadInMsg<RemainingBitsAndRefs>();
        val info = incoming.info;

        if (info is TlbInternalMessage) {
            val destination = info.dest;
            val description = tx.description.load();

            if (destination == sender || destination == receiver) {
                result.fees += tx.totalFees.grams;

                if (description is TlbTransOrd && description.computePh is TlbTrComputeVm) {
                    val exit = description.computePh.data.load().exitCode;

                    if (destination == sender) {
                        result.senderExit = exit;
                        result.senderGas = item.gasUsed;
                        result.incomingForwardFee = info.forwardFee;
                    } else {
                        result.receiverExit = exit;
                        result.receiverGas = item.gasUsed;
                    }
                }

                var messageIndex = 0;

                while (messageIndex < item.outMessages.size()) {
                    val out = TlbMessageRelaxedGeneric.fromCell(
                        item.outMessages.atCell(messageIndex),
                    );
                    val opcode = out.loadOpcode();

                    if (opcode != null && opcode == 0xd53276db) {
                        result.excess += out.info.value.grams;
                    }

                    if (opcode != null && opcode == 0x7362d09c) {
                        result.notification = true;
                    }

                    messageIndex += 1;
                }
            }
        }

        transactionIndex += 1;
    }

    result.senderGrams = testing.getAccountBalance(sender);
    result.receiverGrams = testing.getAccountBalance(receiver);

    // Successful computation at the sender alone is insufficient: an internal
    // transfer can fail downstream and restore the sender's jetton balance.
    result.success = jettonBalance(sender, variant.kind) == 999999000000 &&
        jettonBalance(receiver, variant.kind) == 1000000 &&
        (body.forward == 0 || result.notification);

    txs.hideTraceFromUi();

    return result;
}

/// Find the smallest successful attachment for one fixed message and state.
/// Every probe restores the same snapshot, including account balances and time.
fun measure(
    variant: Variant,
    deployed: bool,
    forward: coins,
    commentBytes: int,
    senderBalance: coins,
) {
    val rawCode = build(variant.name);
    testing.registerLibrary(rawCode);

    val code = variant.library ? rawCode.toLibraryReference() : rawCode;
    val owner = randomAddress("sender-owner");
    val recipient = randomAddress("recipient-owner");
    val master = randomAddress("jetton-master");

    val sender = walletAddress(variant, owner, master, code);
    val receiver = walletAddress(variant, recipient, master, code);
    val senderData = walletData(variant.kind, 1000000000000, owner, master, code);

    installAccount(owner, build("Relay"), createEmptyCell(), grams("10"));
    installAccount(sender, code, senderData, senderBalance);

    testing.setShardAccount(receiver, null);
    testing.setShardAccount(recipient, null);

    if (deployed) {
        val receiverData = walletData(variant.kind, 0, recipient, master, code);

        installAccount(receiver, code, receiverData, grams("0.01"));
    }

    var payload = beginCell();

    if (commentBytes > 0) {
        var comment = beginCell().storeUint(0, 32);

        repeat (commentBytes) {
            comment.storeUint(65, 8);
        }

        payload.storeBool(true).storeRef(comment.endCell());
    } else {
        payload.storeBool(false);
    }

    val body = Transfer {
        destination: recipient,
        response: owner,
        forward,
        forwardPayload: payload.endCell().beginParse(),
    };

    expect(testing.saveSnapshot("build/checkpoint.json")).toBeTrue();

    var failingAmount = 0;
    var passingAmount = grams("0.2");
    val upperBound = attempt(
        variant,
        sender,
        receiver,
        owner,
        body,
        passingAmount,
    );

    if (!upperBound.success) {
        println("FAILED_SETUP {} deployed={} result={}", variant.name, deployed, upperBound);
    }

    expect(upperBound.success).toBeTrue();

    // Maintain a failed lower bound and successful upper bound. Keep the
    // resolution at one nanogram because the contracts use strict > checks.
    while (passingAmount - failingAmount > 1) {
        val candidate = (failingAmount + passingAmount) / 2;
        val observation = attempt(
            variant,
            sender,
            receiver,
            owner,
            body,
            candidate,
        );

        if (observation.success) {
            passingAmount = candidate;
        } else {
            failingAmount = candidate;
        }
    }

    val below = attempt(
        variant,
        sender,
        receiver,
        owner,
        body,
        passingAmount - 1,
    );
    expect(below.success).toBeFalse();

    val at = attempt(
        variant,
        sender,
        receiver,
        owner,
        body,
        passingAmount,
    );
    expect(at.success).toBeTrue();

    // A proposed wallet budget must also complete the transfer. The percentage
    // margin applies only to variable fees, not legacy hardcoded allowances.
    var fixedAllowance = 0;

    if (variant.kind == WalletLayout.Legacy) {
        fixedAllowance = rawCode.hash() == build("v107").hash() ? grams("0.04") : grams("0.03");
    }

    val percentageMargin = mulDivCeil(passingAmount - fixedAllowance, 5, 100);
    val margin = max(100000, percentageMargin);
    val suggested = mulDivCeil(passingAmount + margin, 1, 100000) * 100000;
    val suggestedResult = attempt(
        variant,
        sender,
        receiver,
        owner,
        body,
        suggested,
    );

    expect(suggestedResult.success).toBeTrue();

    val scenario = format(
        "{},{},{},{},{}",
        variant.name,
        deployed,
        forward,
        commentBytes,
        senderBalance,
    );
    val costs = format("{},{},{},{}", at.senderGas, at.receiverGas, at.fees, at.excess);
    val diagnostics = format(
        "{},{},{},{},{}",
        at.senderGrams,
        at.receiverGrams,
        at.incomingForwardFee,
        below.senderExit,
        below.receiverExit,
    );

    println(
        "RESULT,{},{},{},{},{}",
        scenario,
        passingAmount,
        costs,
        diagnostics,
        suggested,
    );
}

get fun `test transfer budgets`() {
    val configCell = boc.decode(fs.readBytes("fixtures/mainnet-config.boc")!)!;
    val config = createMapFromLowLevelDict<int32, cell>(configCell);

    expect(testing.setConfig(config)).toBeTrue();
    testing.setNow(MEASUREMENT_TIME);

    println(
        "CONFIG gas={} forwarding={} precompiled={}",
        config.getGasPrices(BASECHAIN),
        config.getMsgForwardPrices(BASECHAIN),
        config.getPrecompiledContractsConfig(),
    );

    val variants: array<Variant> = [
        {
            name: "v100",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "v101",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "v102",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "v103",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "v105",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "v107",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "m101",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "m102",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "m103",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "m105",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "minter",
            kind: WalletLayout.Legacy,
            library: false,
        },
        {
            name: "StablecoinWallet",
            kind: WalletLayout.StatusPrefix,
            library: true,
        },
        {
            name: "JettonNotcoinWallet",
            kind: WalletLayout.StatusPrefix,
            library: true,
        },
        {
            name: "Jetton2Wallet",
            kind: WalletLayout.Sharded,
            library: true,
        },
        {
            name: "JettonWallet",
            kind: WalletLayout.Sharded,
            library: false,
        },
    ];
    var variantIndex = 0;

    while (variantIndex < variants.size()) {
        val variant = variants.get(variantIndex);

        println("VARIANT {} hash={:064x}", variant.name, build(variant.name).hash());

        measure(variant, false, 1, 0, grams("0.01"));
        measure(variant, true, 1, 0, grams("0.01"));
        measure(variant, false, 0, 0, grams("0.01"));
        measure(variant, false, 1, 32, grams("0.01"));
        measure(variant, false, 1, 0, 0);

        variantIndex += 1;
    }

    // A future ConfigParam 45 change can remove the discount. Measure the same
    // library code with ordinary TVM charging instead of assuming 1000 gas.
    var ordinaryConfig = config;
    ordinaryConfig.setPrecompiledContractsConfig({ list: [] });

    expect(testing.setConfig(ordinaryConfig)).toBeTrue();

    val stablecoinTvm = Variant {
        name: "StablecoinWalletTvm",
        kind: WalletLayout.StatusPrefix,
        library: true,
    };

    measure(stablecoinTvm, false, 1, 0, grams("0.01"));
    measure(stablecoinTvm, true, 1, 0, grams("0.01"));
}
