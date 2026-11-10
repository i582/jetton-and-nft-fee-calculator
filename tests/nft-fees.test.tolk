import "@acton/boc"
import "@acton/build"
import "@acton/fmt"
import "@acton/fs"
import "@acton/io"
import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/tlb/maybe"
import "@acton/types/big_array"
import "@acton/types/message"
import "@acton/types/transaction"
import "emulation-utils"
import "../contracts/Relay"
import "../fixtures/config-time"
import "../contracts/nft/NftV1Item.types"

struct NftVariant {
    name: string
    editable: bool
}

/// Costs cover only the NFT transaction and its outgoing forwarding fees.
struct NftObservation {
    success: bool = false
    computeExit: int = -999
    actionResult: int = -999
    gas: int = 0
    transactionFees: coins = 0
    balanceAfter: coins = 0
    excess: coins = 0
    incomingForwardFee: coins = 0
    notification: bool = false
    response: bool = false
}

/// The item's real action phase must commit the new owner and emit every
/// requested message. A successful compute phase alone is insufficient.
fun attemptNft(
    variant: NftVariant,
    itemAddress: address,
    owner: address,
    body: NftV1Transfer,
    attached: coins,
): NftObservation {
    expect(testing.loadSnapshot("build/nft-checkpoint.json")).toBeTrue();

    val command = RelayTransfer {
        destination: itemAddress,
        attached,
        body: body.toCell(),
    };

    val txs = net.send(
        randomAddress("nft-driver"),
        createMessage({
            bounce: false,
            value: grams("0.3"),
            dest: owner,
            body: command,
        }),
    );

    var result = NftObservation {};
    var transactionIndex = 0;

    while (transactionIndex < txs.size()) {
        val item = txs.at(transactionIndex);
        val tx = item.tx.load();
        val info = tx.loadInMsg<RemainingBitsAndRefs>().info;

        if (info is TlbInternalMessage && info.dest == itemAddress) {
            val description = tx.description.load();

            result.transactionFees += tx.totalFees.grams;
            result.incomingForwardFee = info.forwardFee;
            result.gas = item.gasUsed;

            if (description is TlbTransOrd) {
                if (description.computePh is TlbTrComputeVm) {
                    result.computeExit = description.computePh.data.load().exitCode;
                }

                if (description.action !is TlbNone) {
                    result.actionResult = description.action.unwrap().load().resultCode;
                }
            }

            var messageIndex = 0;

            while (messageIndex < item.outMessages.size()) {
                val message = TlbMessageRelaxedGeneric.fromCell(
                    item.outMessages.atCell(messageIndex),
                );
                val opcode = message.loadOpcode();

                if (opcode != null && opcode == 0x05138d91) {
                    result.notification = message.info.dest == body.newOwnerAddress &&
                        message.info.value.grams == body.forwardTonAmount;
                }

                if (opcode != null && opcode == 0xd53276db) {
                    result.response = message.info.dest == owner;
                    result.excess += message.info.value.grams;
                }

                messageIndex += 1;
            }
        }

        transactionIndex += 1;
    }

    val account = testing.getAccountState(itemAddress)!;
    val state = account.storage.state;

    if (state is TlbAccountStateActive) {
        var data = state.stateInit.data!.beginParse();

        data.skipBits(64);
        data.loadAddress();

        val newOwner = data.loadAddress();
        val contentUnchanged = data.loadRef().hash() ==
            beginCell().storeString("item.json").endCell().hash();
        val editorUnchanged = !variant.editable || data.loadAddress() == owner;

        result.success = newOwner == body.newOwnerAddress && contentUnchanged && editorUnchanged &&
            result.computeExit == 0 &&
            result.actionResult == 0 &&
            (body.forwardTonAmount == 0 || result.notification) &&
            (body.responseDestination == null || result.response);
    }

    result.balanceAfter = testing.getAccountBalance(itemAddress);
    txs.hideTraceFromUi();

    return result;
}

/// Each probe restores time and all balances, including failed transfer bounces.
fun measureNft(
    variant: NftVariant,
    initialBalance: coins,
    forward: coins,
    commentBytes: int,
    response: bool,
): coins {
    val owner = randomAddress("nft-owner");
    val recipient = randomAddress("nft-recipient");
    val collection = randomAddress("nft-collection");
    val code = build(variant.name);
    val content = beginCell().storeString("item.json").endCell();
    var storage = beginCell()
        .storeUint(1, 64)
        .storeAddress(collection)
        .storeAddress(owner)
        .storeRef(content);

    if (variant.editable) {
        storage.storeAddress(owner);
    }

    // NFT addresses derive from uninitialized index + collection data. Current
    // ownership, content, and GRAM balance must not enter address derivation.
    val initialData = beginCell().storeUint(1, 64).storeAddress(collection).endCell();
    val itemAddress = AutoDeployAddress {
        stateInit: { code, data: initialData },
    }.calculateAddress();

    installAccount(owner, build("Relay"), createEmptyCell(), grams("10"));
    installAccount(itemAddress, code, storage.endCell(), initialBalance);
    testing.setShardAccount(recipient, null);

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

    val body = NftV1Transfer {
        queryId: 1,
        newOwnerAddress: recipient,
        responseDestination: response ? owner : null,
        customPayload: null,
        forwardTonAmount: forward,
        forwardPayload: payload.endCell().beginParse(),
    };

    expect(testing.saveSnapshot("build/nft-checkpoint.json")).toBeTrue();

    var failing = 0;
    var passing = grams("0.2");
    val upper = attemptNft(variant, itemAddress, owner, body, passing);

    if (!upper.success) {
        println("NFT_SETUP_FAILURE {} {}", variant.name, upper);
    }

    expect(upper.success).toBeTrue();
    expect(attemptNft(variant, itemAddress, owner, body, failing).success).toBeFalse();

    while (passing - failing > 1) {
        val candidate = (failing + passing) / 2;
        val observation = attemptNft(variant, itemAddress, owner, body, candidate);

        if (observation.success) {
            passing = candidate;
        } else {
            failing = candidate;
        }
    }

    val below = attemptNft(variant, itemAddress, owner, body, passing - 1);
    val at = attemptNft(variant, itemAddress, owner, body, passing);

    expect(below.success).toBeFalse();
    expect(at.success).toBeTrue();

    // Do not apply a percentage markup to the item's fixed reserve shortfall.
    // This is a budget policy after emulation, not a contract gas constant.
    val reserveShortfall = max(0, grams("0.05") - initialBalance);
    val variable = max(0, passing - reserveShortfall);
    val margin = max(100000, mulDivCeil(variable, 5, 100));
    val suggested = mulDivCeil(passing + margin, 1, 100000) * 100000;

    expect(attemptNft(variant, itemAddress, owner, body, suggested).success).toBeTrue();

    val scenario = format(
        "{},{},{},{},{}",
        variant.name,
        initialBalance,
        forward,
        commentBytes,
        response,
    );
    val costs = format("{},{},{},{}", at.gas, at.transactionFees, at.balanceAfter, at.excess);
    val diagnostics = format(
        "{},{},{}",
        at.incomingForwardFee,
        below.computeExit,
        below.actionResult,
    );

    println(
        "NFT_RESULT,{},{},{},{},{}",
        scenario,
        passing,
        suggested,
        costs,
        diagnostics,
    );

    return at.balanceAfter;
}

get fun `test NFT transfer budgets`() {
    val configCell = boc.decode(fs.readBytes("fixtures/mainnet-config.boc")!)!;

    expect(testing.setConfig(createMapFromLowLevelDict<int32, cell>(configCell))).toBeTrue();
    testing.setNow(MEASUREMENT_TIME);

    val variants: array<NftVariant> = [
        { name: "NftV1Item", editable: false },
        { name: "NftV1EditableItem", editable: true },
        { name: "GetgemsNftItemV2", editable: false },
        { name: "GetgemsNftEditableItemV2", editable: true },
    ];
    var index = 0;

    while (index < variants.size()) {
        val variant = variants.get(index);

        measureNft(variant, 0, 1, 0, true);
        measureNft(variant, grams("0.01"), 1, 0, true);
        val balanceAfterTransfer = measureNft(variant, grams("0.05"), 1, 0, true);

        // A preceding transfer spends part of the nominal reserve. Measure the
        // next transfer from that balance instead of assuming a fresh 0.05 GRAM.
        measureNft(variant, balanceAfterTransfer, 1, 0, true);
        measureNft(variant, grams("0.1"), 1, 0, true);
        measureNft(variant, grams("0.05"), 0, 0, true);
        measureNft(variant, grams("0.05"), 1, 32, true);
        measureNft(variant, grams("0.05"), 1, 0, false);
        measureNft(variant, grams("0.05"), 0, 0, false);

        index += 1;
    }
}
