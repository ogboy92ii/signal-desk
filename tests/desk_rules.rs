//! The desk's guarantees beyond one call: the registry cannot hide a call, an unopened call counts
//! as lost and refunds, commitments are bound to their number, and only the publisher seals and
//! withdraws.

mod common;

use common::*;
use tari_template_lib_types::{bytes::Bytes, constants::TARI_TOKEN, Amount, ResourceAddress};
use tari_template_test_tooling::transaction::args;

const A: &str = "v1|ETHUSDT|LONG|3100|3400|2950|2026-11-20T00:00Z";
const B: &str = "v1|SOLUSDT|SHORT|180|160|190|2026-11-20T00:00Z";

#[test]
fn an_unopened_call_counts_as_lost_and_refunds_its_buyers() {
    let (mut test, desk) = new_desk();
    let opened = seal(&mut test, desk, A, 5);
    let buried = seal(&mut test, desk, B, 5);
    assert_eq!((opened, buried), (0, 1), "calls are numbered in the order they are sealed");

    buy(&mut test, desk, opened);
    let (buyer, proof, key) = buy(&mut test, desk, buried);
    let badges: ResourceAddress = test.call_method(desk, "badge_resource", args![buried], vec![]);

    set_epoch(&mut test, 5);
    test.call_method::<()>(desk, "reveal", args![opened, A.to_string(), Bytes::from_vec(NONCE.to_vec())], vec![]);

    // Refunds wait for the end of the reveal window.
    let early = refund_tx(&mut test, desk, buried, badges, buyer, &key);
    expect_reject(&mut test, early, vec![proof.clone()], "refunds open at epoch");

    set_epoch(&mut test, 5 + REVEAL_WINDOW_EPOCHS);
    assert_eq!(
        test.call_method::<(u64, u64, u64)>(desk, "stats", args![], vec![]),
        (2, 1, 1),
        "the buried call must show as never opened"
    );

    // Too late to open it now.
    let key0 = test.secret_key().clone();
    let late = test
        .transaction()
        .call_method(desk, "reveal", args![buried, B.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key0);
    expect_reject(&mut test, late, vec![], "reveal window closed");

    let tx = refund_tx(&mut test, desk, buried, badges, buyer, &key);
    test.execute_expect_success(tx, vec![proof]);
    assert_eq!(test.call_method::<u64>(desk, "refunded", args![buried], vec![]), 1);
    // Only the opened call's proceeds are payable; the refund left exactly those in escrow.
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
    assert_eq!(test.call_method::<Amount>(desk, "earnings_balance", args![], vec![]), Amount::from_u64(PRICE));
}

#[test]
fn an_opened_call_does_not_refund() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, A, 5);
    let (buyer, proof, key) = buy(&mut test, desk, seq);
    let badges: ResourceAddress = test.call_method(desk, "badge_resource", args![seq], vec![]);
    set_epoch(&mut test, 5);
    test.call_method::<()>(desk, "reveal", args![seq, A.to_string(), Bytes::from_vec(NONCE.to_vec())], vec![]);
    set_epoch(&mut test, 5 + REVEAL_WINDOW_EPOCHS);
    let tx = refund_tx(&mut test, desk, seq, badges, buyer, &key);
    expect_reject(&mut test, tx, vec![proof], "nothing to refund");
}

#[test]
fn a_badge_of_one_call_cannot_refund_another() {
    let (mut test, desk) = new_desk();
    let first = seal(&mut test, desk, A, 5);
    let second = seal(&mut test, desk, B, 5);
    let (buyer, proof, key) = buy(&mut test, desk, first);
    buy(&mut test, desk, second);
    let first_badges: ResourceAddress = test.call_method(desk, "badge_resource", args![first], vec![]);
    set_epoch(&mut test, 5 + REVEAL_WINDOW_EPOCHS);
    let tx = refund_tx(&mut test, desk, second, first_badges, buyer, &key);
    expect_reject(&mut test, tx, vec![proof], "not a badge of this call");
}

#[test]
fn a_commitment_only_opens_under_its_own_number() {
    let (mut test, desk) = new_desk();
    // Sealed as call #0 with the commitment computed for #1: no payload can ever open it.
    let wrong_slot = digest(&test, 1, A);
    let seq: u64 = test.call_method(desk, "seal", args![wrong_slot, 5u64, Amount::from_u64(PRICE)], vec![]);
    assert_eq!(seq, 0);
    set_epoch(&mut test, 5);
    let key = test.secret_key().clone();
    let tx = test
        .transaction()
        .call_method(desk, "reveal", args![seq, A.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key);
    expect_reject(&mut test, tx, vec![], "do not open this commitment");
}

#[test]
fn only_the_publisher_seals_and_withdraws() {
    let (mut test, desk) = new_desk();
    let (_, _, other_key) = test.create_funded_account();
    let commitment = digest(&test, 0, A);
    let seal_tx = test
        .transaction()
        .call_method(desk, "seal", args![commitment, 5u64, Amount::from_u64(PRICE)])
        .build_and_seal(&other_key);
    test.execute_expect_failure(seal_tx, vec![]);
    assert_eq!(test.call_method::<u64>(desk, "call_count", args![], vec![]), 0);

    let seq = seal(&mut test, desk, A, 5);
    buy(&mut test, desk, seq);
    set_epoch(&mut test, 5);
    test.call_method::<()>(desk, "reveal", args![seq, A.to_string(), Bytes::from_vec(NONCE.to_vec())], vec![]);
    let steal = test
        .transaction()
        .call_method(desk, "withdraw", args![Amount::from_u64(PRICE)])
        .build_and_seal(&other_key);
    test.execute_expect_failure(steal, vec![]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
}

#[test]
fn bad_terms_and_unknown_calls_are_refused() {
    let (mut test, desk) = new_desk();
    let key = test.secret_key().clone();
    let c = digest(&test, 0, A);
    let past = test.transaction().call_method(desk, "seal", args![c, 1u64, Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, past, vec![], "must be in the future");
    let far = test.transaction().call_method(desk, "seal", args![c, 20_000u64, Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, far, vec![], "epochs away");
    let free = test.transaction().call_method(desk, "seal", args![c, 5u64, Amount::zero()]).build_and_seal(&key);
    expect_reject(&mut test, free, vec![], "price must be positive");

    let (buyer, proof, bkey) = test.create_funded_account();
    let ghost = test
        .transaction()
        .call_method(buyer, "withdraw", args![TARI_TOKEN, Amount::from_u64(PRICE)])
        .put_last_instruction_output_on_workspace("payment")
        .call_method(desk, "buy", args![7u64, Workspace("payment")])
        .put_last_instruction_output_on_workspace("out")
        .call_method(buyer, "deposit", args![Workspace("out.0")])
        .build_and_seal(&bkey);
    expect_reject(&mut test, ghost, vec![proof], "no call #7");
}
