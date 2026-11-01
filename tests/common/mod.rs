//! Shared helpers for the integration tests (Linux/macOS: the engine's JIT does not build on Windows).

#![allow(dead_code)]

use blake2::{digest::consts::U32, Blake2b, Digest};
use tari_template_lib_types::{bytes::Bytes, constants::TARI_TOKEN, Amount, ComponentAddress, Hash32, NonFungibleAddress, ResourceAddress};
use tari_template_test_tooling::{
    crypto::RistrettoSecretKey,
    engine_types::virtual_substate::{VirtualSubstate, VirtualSubstateId},
    transaction::{args, Transaction},
    TemplateTest,
};

pub const PRICE: u64 = 1_000;
pub const REVEAL_WINDOW_EPOCHS: u64 = 10;
pub const MAX_CALLS: u64 = 1_000;
pub const NONCE: &[u8] = b"demo-nonce-0123456789abcdefghijk";

/// `commitment_of` from the template, computed off-chain as a caller must. The crate is a `cdylib`
/// only, so the tests keep this copy; every successful reveal checks it against the template's.
pub fn commitment_of(desk: &str, publisher: &[u8], seq: u64, payload: &str, nonce: &[u8]) -> Hash32 {
    let mut hasher = Blake2b::<U32>::new();
    let seq = seq.to_le_bytes();
    for part in [
        b"tari.ootle.signal_desk.commitment.v2".as_slice(),
        desk.as_bytes(),
        publisher,
        seq.as_slice(),
        payload.as_bytes(),
        nonce,
    ] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    Hash32::from_array(hasher.finalize().into())
}

/// The commitment for call `seq` of `desk`, opened with the test's default key.
pub fn digest(test: &TemplateTest, desk: ComponentAddress, seq: u64, payload: &str) -> Hash32 {
    commitment_of(&desk.to_string(), test.to_public_key_bytes().as_bytes(), seq, payload, NONCE)
}

pub fn set_epoch(test: &mut TemplateTest, epoch: u64) {
    test.set_virtual_substate(VirtualSubstateId::CurrentEpoch, VirtualSubstate::CurrentEpoch(epoch));
}

/// A test ledger at epoch 1 with a desk opened by the default key, paying out into a fresh account.
pub fn new_desk() -> (TemplateTest, ComponentAddress) {
    let mut test = TemplateTest::new_cwd(["."]);
    set_epoch(&mut test, 1);
    let (payout, _, _) = test.create_empty_account();
    let desk: ComponentAddress = test.call_function("SignalDesk", "open_desk", args![payout], vec![]);
    (test, desk)
}

/// TARI balance of the desk's payout account.
pub fn payout_balance(test: &mut TemplateTest, desk: ComponentAddress) -> Amount {
    let payout: ComponentAddress = test.call_method(desk, "payout", args![], vec![]);
    test.call_method(payout, "balance", args![TARI_TOKEN], vec![])
}

/// Seals `payload` as the next call of `desk` (default key), revealing at `reveal_at`.
pub fn seal(test: &mut TemplateTest, desk: ComponentAddress, payload: &str, reveal_at: u64) -> u64 {
    let seq: u64 = test.call_method(desk, "call_count", args![], vec![]);
    let commitment = digest(test, desk, seq, payload);
    test.call_method(desk, "seal", args![seq, commitment, reveal_at, Amount::from_u64(PRICE)], vec![])
}

/// Opens call `seq` and returns the `payload` published in its `call_revealed` event.
pub fn reveal(test: &mut TemplateTest, desk: ComponentAddress, seq: u64, payload: &str) -> String {
    let key = test.secret_key().clone();
    let tx = test
        .transaction()
        .call_method(desk, "reveal", args![seq, payload.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result
        .finalize
        .events
        .iter()
        .find(|e| e.topic() == "call_revealed")
        .expect("reveal emits call_revealed");
    assert_eq!(event.payload().get_str("seq"), Some(seq.to_string().as_str()));
    event.payload().get_str("payload").expect("the event carries the payload").to_string()
}

/// A funded buyer buys one badge of call `seq` and keeps it.
pub fn buy(test: &mut TemplateTest, desk: ComponentAddress, seq: u64) -> (ComponentAddress, NonFungibleAddress, RistrettoSecretKey) {
    let (buyer, proof, key) = test.create_funded_account();
    let tx = test
        .transaction()
        .call_method(buyer, "withdraw", args![TARI_TOKEN, Amount::from_u64(PRICE)])
        .put_last_instruction_output_on_workspace("payment")
        .call_method(desk, "buy", args![seq, Workspace("payment")])
        .put_last_instruction_output_on_workspace("out")
        .call_method(buyer, "deposit", args![Workspace("out.0")])
        .build_and_seal(&key);
    test.execute_expect_success(tx, vec![proof.clone()]);
    (buyer, proof, key)
}

/// Burns one badge of call `seq` held by `buyer` for a refund, depositing the money back.
pub fn refund_tx(test: &mut TemplateTest, desk: ComponentAddress, seq: u64, badges: ResourceAddress, buyer: ComponentAddress, key: &RistrettoSecretKey) -> Transaction {
    test.transaction()
        .call_method(buyer, "withdraw", args![badges, Amount::from_u64(1)])
        .put_last_instruction_output_on_workspace("badge")
        .call_method(desk, "refund", args![seq, Workspace("badge")])
        .put_last_instruction_output_on_workspace("money")
        .call_method(buyer, "deposit", args![Workspace("money")])
        .build_and_seal(key)
}

#[track_caller]
pub fn expect_reject(test: &mut TemplateTest, tx: Transaction, proofs: Vec<NonFungibleAddress>, needle: &str) {
    let reason = format!("{:?}", test.execute_expect_failure(tx, proofs));
    assert!(
        reason.to_lowercase().contains(&needle.to_lowercase()),
        "rejected for the wrong reason (wanted {needle:?}): {reason}"
    );
}
