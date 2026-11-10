/// Test owner that produces a real action-phase message with network forwarding fees.
/// Its inbound command and compute fee are outside the jetton attachment budget.
struct (0x12345678) RelayTransfer {
    destination: address
    attached: coins
    body: cell
    // Keep the synthetic driver envelope's body out of the root cell even
    // after source and forwarding-fee fields are filled in. This padding never
    // enters the actual transfer request or its measured forwarding fee.
    padding: uint256 = 0
}

fun onInternalMessage(in: InMessage) {
    if (in.body.preloadUint(32) == 0x12345678) {
        val command = RelayTransfer.fromSlice(in.body);
        createMessage({
            bounce: true,
            value: command.attached,
            dest: command.destination,
            body: command.body,
        }).send(SEND_MODE_PAY_FEES_SEPARATELY);
    }
}
