import "@acton/emulation/testing"
import "@acton/tlb/maybe"
import "@acton/types/message"
import "@acton/types/transaction"

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
