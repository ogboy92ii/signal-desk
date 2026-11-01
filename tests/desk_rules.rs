//! The desk's guarantees beyond one call: the registry cannot hide a call, an unopened call counts
//! as lost and refunds, commitments are bound to their desk and number, only the publisher seals,
//! proceeds only reach the payout account, and a full desk keeps working.

mod common;

use common::*;
use tari_template_lib_types::{bytes::Bytes, constants::TARI_TOKEN, Amount, ComponentAddress, ResourceAddress};
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
    let (buyer2, proof2, key2) = buy(&mut test, desk, buried);
    let badges: ResourceAddress = test.call_method(desk, "badge_resource", args![buried], vec![]);

    set_epoch(&mut test, 5);
    reveal(&mut test, desk, opened, A);

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
    test.execute_expect_success(tx, vec![proof.clone()]);
    // The badge is burnt: the same buyer has nothing left to refund.
    let twice = refund_tx(&mut test, desk, buried, badges, buyer, &key);
    test.execute_expect_failure(twice, vec![proof]);
    let tx = refund_tx(&mut test, desk, buried, badges, buyer2, &key2);
    test.execute_expect_success(tx, vec![proof2]);
    assert_eq!(test.call_method::<u64>(desk, "refunded", args![buried], vec![]), 2);

    // Only the opened call's proceeds are payable; the refunds left exactly those in escrow.
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
    reveal(&mut test, desk, seq, A);
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
fn a_commitment_only_opens_under_its_own_number_and_desk() {
    let (mut test, desk) = new_desk();
    let key = test.secret_key().clone();

    // Sealed as call #0 with the commitment computed for #1: no payload can ever open it.
    let wrong_slot = digest(&test, desk, 1, A);
    test.call_method::<u64>(desk, "seal", args![0u64, wrong_slot, 5u64, Amount::from_u64(PRICE)], vec![]);

    // Copied from another desk of the same publisher: it does not open here either.
    let (payout, _, _) = test.create_empty_account();
    let other: ComponentAddress = test.call_function("SignalDesk", "open_desk", args![payout], vec![]);
    let copied = digest(&test, other, 1, B);
    test.call_method::<u64>(desk, "seal", args![1u64, copied, 5u64, Amount::from_u64(PRICE)], vec![]);

    set_epoch(&mut test, 5);
    for (seq, payload) in [(0u64, A), (1u64, B)] {
        let tx = test
            .transaction()
            .call_method(desk, "reveal", args![seq, payload.to_string(), Bytes::from_vec(NONCE.to_vec())])
            .build_and_seal(&key);
        expect_reject(&mut test, tx, vec![], "do not open this commitment");
    }
}

#[test]
fn a_seal_racing_another_is_refused_instead_of_misnumbered() {
    let (mut test, desk) = new_desk();
    let key = test.secret_key().clone();
    // Two seals both prepared for #0; the first lands, the second must not slip in as #1.
    let a = digest(&test, desk, 0, A);
    let b = digest(&test, desk, 0, B);
    test.call_method::<u64>(desk, "seal", args![0u64, a, 5u64, Amount::from_u64(PRICE)], vec![]);
    let racing = test.transaction().call_method(desk, "seal", args![0u64, b, 5u64, Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, racing, vec![], "next call number is 1");
    assert_eq!(test.call_method::<u64>(desk, "call_count", args![], vec![]), 1);
}

#[test]
fn only_the_publisher_seals_and_proceeds_only_reach_the_payout_account() {
    let (mut test, desk) = new_desk();
    let (_, _, other_key) = test.create_funded_account();
    let commitment = digest(&test, desk, 0, A);
    let seal_tx = test
        .transaction()
        .call_method(desk, "seal", args![0u64, commitment, 5u64, Amount::from_u64(PRICE)])
        .build_and_seal(&other_key);
    test.execute_expect_failure(seal_tx, vec![]);
    assert_eq!(test.call_method::<u64>(desk, "call_count", args![], vec![]), 0);

    let seq = seal(&mut test, desk, A, 5);
    buy(&mut test, desk, seq);
    set_epoch(&mut test, 5);
    reveal(&mut test, desk, seq, A);

    // Anyone may trigger the payout, but the money lands in the publisher's payout account.
    let before = payout_balance(&mut test, desk);
    let poke = test
        .transaction()
        .call_method(desk, "withdraw", args![Amount::from_u64(PRICE)])
        .build_and_seal(&other_key);
    test.execute_expect_success(poke, vec![]);
    assert_eq!(payout_balance(&mut test, desk), before.checked_add(Amount::from_u64(PRICE)).unwrap());

    // And nothing more than the earned proceeds.
    let more = test.transaction().call_method(desk, "withdraw", args![Amount::from_u64(1)]).build_and_seal(&other_key);
    expect_reject(&mut test, more, vec![], "only proceeds of opened calls");
}

#[test]
fn bad_terms_payloads_and_unknown_calls_are_refused() {
    let (mut test, desk) = new_desk();
    let key = test.secret_key().clone();
    let c = digest(&test, desk, 0, A);
    let past = test.transaction().call_method(desk, "seal", args![0u64, c, 1u64, Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, past, vec![], "must be in the future");
    let far = test.transaction().call_method(desk, "seal", args![0u64, c, 20_000u64, Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, far, vec![], "epochs away");
    let free = test.transaction().call_method(desk, "seal", args![0u64, c, 5u64, Amount::zero()]).build_and_seal(&key);
    expect_reject(&mut test, free, vec![], "price must be positive");

    // A payload that would read differently from how it hashes is refused even if it matches.
    let tricky = "v1|BTCUSDT|LONG\u{202E}TROHS|62000";
    let seq: u64 = test.call_method(desk, "call_count", args![], vec![]);
    let t = commitment_of(&desk.to_string(), test.to_public_key_bytes().as_bytes(), seq, tricky, NONCE);
    test.call_method::<u64>(desk, "seal", args![seq, t, 5u64, Amount::from_u64(PRICE)], vec![]);
    set_epoch(&mut test, 5);
    let bidi = test
        .transaction()
        .call_method(desk, "reveal", args![seq, tricky.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key);
    expect_reject(&mut test, bidi, vec![], "printable ascii");
    let short = test
        .transaction()
        .call_method(desk, "reveal", args![seq, A.to_string(), Bytes::from_vec(b"short".to_vec())])
        .build_and_seal(&key);
    expect_reject(&mut test, short, vec![], "nonce must be");

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

#[test]
fn a_full_desk_refuses_more_calls_and_still_works() {
    let (mut test, desk) = new_desk();
    for _ in 0..MAX_CALLS {
        seal(&mut test, desk, A, 5);
    }
    assert_eq!(test.call_method::<u64>(desk, "call_count", args![], vec![]), MAX_CALLS);

    let key = test.secret_key().clone();
    let c = digest(&test, desk, MAX_CALLS, A);
    let over = test
        .transaction()
        .call_method(desk, "seal", args![MAX_CALLS, c, 5u64, Amount::from_u64(PRICE)])
        .build_and_seal(&key);
    expect_reject(&mut test, over, vec![], "has reached");

    // The state of a full desk still loads: the last call sells, opens and pays out.
    let last = MAX_CALLS - 1;
    buy(&mut test, desk, last);
    set_epoch(&mut test, 5);
    assert_eq!(reveal(&mut test, desk, last, A), A);
    test.call_method::<()>(desk, "withdraw", args![Amount::from_u64(PRICE)], vec![]);
    assert_eq!(test.call_method::<(u64, u64, u64)>(desk, "stats", args![], vec![]), (MAX_CALLS, 1, 0));
}
