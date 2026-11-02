//! Stage 2: the call reaches its buyer before the reveal, encrypted to them alone, and the template
//! itself judges a dispute. A caller who delivers something else is condemned on chain; a caller who
//! does not deliver is never paid; nobody but the buyer can dispute; nothing replays across sales.

mod common;

use common::*;
use tari_template_lib_types::{bytes::Bytes, Amount};
use tari_template_test_tooling::transaction::args;

const CALL: &str = "v1|BTCUSDT|LONG|62000|65000|60500|2026-11-20T00:00Z";
const OTHER: &str = "v1|BTCUSDT|SHORT|62000|59000|63500|2026-11-20T00:00Z";
const REVEAL_AT: u64 = 5;

fn stats(test: &mut tari_template_test_tooling::TemplateTest, desk: tari_template_lib_types::ComponentAddress) -> (u64, u64, u64, u64) {
    test.call_method(desk, "stats", args![], vec![])
}

#[test]
fn an_honest_delivery_survives_a_dispute_and_is_paid() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    let buyer = buy(&mut test, desk, seq);
    let delivery = deliver(&mut test, desk, &buyer, CALL);

    assert_eq!(dispute(&mut test, desk, &buyer, &delivery), "upheld");
    assert_eq!(sale_status(&mut test, desk, &buyer), "Upheld");
    // Judged once.
    let again = dispute_tx(&mut test, desk, &buyer, &delivery);
    expect_reject(&mut test, again, vec![], "no delivery to dispute");
    // An upheld sale does not refund.
    set_epoch(&mut test, REVEAL_AT);
    let tx = refund_of(&mut test, desk, &buyer);
    expect_reject(&mut test, tx, vec![buyer.proof.clone()], "nothing to refund");

    reveal(&mut test, desk, seq, CALL);
    set_epoch(&mut test, REVEAL_AT + REVEAL_WINDOW_EPOCHS);
    test.call_method::<()>(desk, "settle", args![seq], vec![]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
    assert_eq!(stats(&mut test, desk), (1, 1, 0, 0));
}

#[test]
fn delivering_something_else_is_judged_fraud_refunded_and_never_paid() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    let cheated = buy(&mut test, desk, seq);
    let honest = buy(&mut test, desk, seq);
    // The caller shows one buyer the opposite call, well formed and with the right nonce.
    let fake = deliver(&mut test, desk, &cheated, OTHER);
    deliver(&mut test, desk, &honest, CALL);

    assert_eq!(dispute(&mut test, desk, &cheated, &fake), "fraud");
    assert_eq!(sale_status(&mut test, desk, &cheated), "Fraud");
    assert_eq!(stats(&mut test, desk), (1, 0, 0, 1), "the verdict is on the desk's record");

    // Refunded at once, even before the reveal.
    let before: Amount = test.call_method(cheated.account, "balance", args![tari_template_lib_types::constants::TARI_TOKEN], vec![]);
    let tx = refund_of(&mut test, desk, &cheated);
    test.execute_expect_success(tx, vec![cheated.proof.clone()]);
    let after: Amount = test.call_method(cheated.account, "balance", args![tari_template_lib_types::constants::TARI_TOKEN], vec![]);
    assert_eq!(after, before.checked_add(Amount::from_u64(PRICE)).unwrap());
    assert_eq!(sale_status(&mut test, desk, &cheated), "Refunded");

    // The caller still opens the call and is paid for the honest sale only.
    set_epoch(&mut test, REVEAL_AT);
    reveal(&mut test, desk, seq, CALL);
    set_epoch(&mut test, REVEAL_AT + REVEAL_WINDOW_EPOCHS);
    test.call_method::<()>(desk, "settle", args![seq], vec![]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
    assert_eq!(stats(&mut test, desk), (1, 1, 0, 1), "a fraud stays on the record after the reveal");
}

#[test]
fn an_unreadable_delivery_is_fraud() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    for block in [
        vec![0u8; BLOCK_LEN],                                          // nothing in it
        client::block(CALL.as_bytes(), &NONCE[..8], BLOCK_LEN),        // nonce too short
        client::block(b"v1|BTC\nLONG", NONCE, BLOCK_LEN),              // not printable ASCII
        { let mut b = client::block(CALL.as_bytes(), NONCE, BLOCK_LEN); b[BLOCK_LEN - 1] = 7; b }, // bytes after the nonce
    ] {
        let buyer = buy(&mut test, desk, seq);
        let delivery = deliver_block(&mut test, desk, &buyer, &block);
        assert_eq!(dispute(&mut test, desk, &buyer, &delivery), "fraud");
    }
}

#[test]
fn an_undelivered_sale_refunds_from_the_reveal_epoch_and_is_never_paid() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    let buyer = buy(&mut test, desk, seq);
    let early = refund_of(&mut test, desk, &buyer);
    expect_reject(&mut test, early, vec![buyer.proof.clone()], "nothing to refund");

    set_epoch(&mut test, REVEAL_AT);
    // Too late to deliver now: the call is about to be public.
    let (late, _) = deliver_tx(&mut test, desk, &buyer, &client::block(CALL.as_bytes(), NONCE, BLOCK_LEN), None);
    expect_reject(&mut test, late, vec![], "too late to deliver");
    reveal(&mut test, desk, seq, CALL);
    let tx = refund_of(&mut test, desk, &buyer);
    test.execute_expect_success(tx, vec![buyer.proof.clone()]);

    set_epoch(&mut test, REVEAL_AT + REVEAL_WINDOW_EPOCHS);
    test.call_method::<()>(desk, "settle", args![seq], vec![]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::zero());
    assert_eq!(test.call_method::<Amount>(desk, "earnings_balance", args![], vec![]), Amount::zero());
}

#[test]
fn only_the_publisher_delivers_once_and_only_with_its_own_ephemeral_proof() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    let buyer = buy(&mut test, desk, seq);
    let second = buy(&mut test, desk, seq);
    let block = client::block(CALL.as_bytes(), NONCE, BLOCK_LEN);

    let (_, _, stranger) = test.create_funded_account();
    let (forged, _) = deliver_tx(&mut test, desk, &buyer, &block, Some(&stranger));
    test.execute_expect_failure(forged, vec![]);
    assert_eq!(sale_status(&mut test, desk, &buyer), "Paid");

    let delivery = deliver(&mut test, desk, &buyer, CALL);
    let (twice, _) = deliver_tx(&mut test, desk, &buyer, &block, None);
    expect_reject(&mut test, twice, vec![], "not awaiting delivery");

    // The first sale's `R` and its proof, replayed onto the second sale: the proof is bound to its sale.
    let ctx = client::context(&desk, seq, Some(buyer.sale));
    let r = client::secret(&[b"ephemeral".as_slice(), &ctx].concat());
    let (rc, rz) = client::prove_knows(&ctx, &r, b"ephemeral");
    let key = test.secret_key().clone();
    let replay = test
        .transaction()
        .call_method(desk, "deliver", args![seq, second.sale, point(delivery.ephemeral), scalar(rc), scalar(rz), Bytes::from_vec(delivery.ciphertext.clone())])
        .build_and_seal(&key);
    expect_reject(&mut test, replay, vec![], "invalid ephemeral key proof");

    // A short ciphertext is refused outright.
    let short = test
        .transaction()
        .call_method(desk, "deliver", args![seq, second.sale, point(delivery.ephemeral), scalar(rc), scalar(rz), Bytes::from_vec(vec![0u8; 64])])
        .build_and_seal(&key);
    expect_reject(&mut test, short, vec![], "ciphertext must be exactly");
}

#[test]
fn nobody_but_the_buyer_can_dispute_and_only_the_delivered_ciphertext() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    let buyer = buy(&mut test, desk, seq);
    let delivery = deliver(&mut test, desk, &buyer, OTHER);
    let ctx = client::context(&desk, seq, Some(buyer.sale));

    // Someone without the sale key: a proof for another secret does not verify.
    let (_, _, stranger) = test.create_funded_account();
    let fake_b = client::secret(b"not the buyer");
    let (shared, c, z) = client::prove_shared(&ctx, &fake_b, &delivery.ephemeral);
    let forged = test
        .transaction()
        .call_method(desk, "dispute", args![seq, buyer.sale, point(shared), scalar(c), scalar(z), Bytes::from_vec(delivery.ciphertext.clone())])
        .build_and_seal(&stranger);
    expect_reject(&mut test, forged, vec![], "invalid proof that the shared point");

    // The buyer's own proof, but with a ciphertext other than the delivered one.
    let (shared, c, z) = client::prove_shared(&ctx, &buyer.b, &delivery.ephemeral);
    let mut swapped = delivery.ciphertext.clone();
    swapped[0] ^= 1;
    let tx = test
        .transaction()
        .call_method(desk, "dispute", args![seq, buyer.sale, point(shared), scalar(c), scalar(z), Bytes::from_vec(swapped)])
        .build_and_seal(&buyer.key);
    expect_reject(&mut test, tx, vec![], "not the ciphertext of this delivery");

    // Submitted by anyone, the buyer's genuine dispute only changes the sale's status: the money
    // still leaves through the buyer's badge.
    let relayed = test
        .transaction()
        .call_method(desk, "dispute", args![seq, buyer.sale, point(shared), scalar(c), scalar(z), Bytes::from_vec(delivery.ciphertext.clone())])
        .build_and_seal(&stranger);
    test.execute_expect_success(relayed, vec![]);
    assert_eq!(sale_status(&mut test, desk, &buyer), "Fraud");
    assert_eq!(test.call_method::<Amount>(desk, "earnings_balance", args![], vec![]), Amount::from_u64(PRICE));

    // And no dispute once the reveal window is over.
    let late_buyer = buy(&mut test, desk, seq);
    let late_delivery = deliver(&mut test, desk, &late_buyer, CALL);
    set_epoch(&mut test, REVEAL_AT + REVEAL_WINDOW_EPOCHS);
    let late = dispute_tx(&mut test, desk, &late_buyer, &late_delivery);
    expect_reject(&mut test, late, vec![], "dispute window closed");
}

#[test]
fn a_purchase_needs_a_proof_for_its_own_call() {
    let (mut test, desk) = new_desk();
    let first = seal(&mut test, desk, CALL, REVEAL_AT);
    let second = seal(&mut test, desk, OTHER, REVEAL_AT);
    let (account, proof, key) = test.create_funded_account();
    let b = client::secret(b"buyer");
    // A proof made for call #0, presented to buy call #1.
    let pk = client::prove_knows(&client::context(&desk, first, None), &b, b"buy");
    let tx = buy_tx(&mut test, desk, second, account, &key, client::public(&b), pk);
    expect_reject(&mut test, tx, vec![proof.clone()], "invalid buyer key proof");
    // The identity point is never a sale key.
    let tx = buy_tx(&mut test, desk, first, account, &key, [0u8; 32], pk);
    expect_reject(&mut test, tx, vec![proof], "identity point");
}

#[test]
fn a_desk_full_of_sales_refuses_more_and_still_works() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, CALL, REVEAL_AT);
    let (account, proof, key) = test.create_funded_account();
    let b = client::secret(b"bulk buyer");
    let (c, z) = client::prove_knows(&client::context(&desk, seq, None), &b, b"buy");
    // Fill the desk with purchases from one account (the proof is per call, not per sale).
    for _ in 0..MAX_SALES {
        let tx = buy_tx(&mut test, desk, seq, account, &key, client::public(&b), (c, z));
        test.execute_expect_success(tx, vec![proof.clone()]);
    }
    assert_eq!(test.call_method::<u64>(desk, "sold", args![seq], vec![]), MAX_SALES);
    let over = buy_tx(&mut test, desk, seq, account, &key, client::public(&b), (c, z));
    expect_reject(&mut test, over, vec![proof], "has reached");

    // The full state still loads: the last sale delivers, the call opens and settles.
    let last = Buyer { account, proof: test.create_funded_account().1, key, b, seq, sale: MAX_SALES - 1 };
    let delivery = deliver(&mut test, desk, &last, CALL);
    assert_eq!(dispute(&mut test, desk, &last, &delivery), "upheld");
    set_epoch(&mut test, REVEAL_AT);
    reveal(&mut test, desk, seq, CALL);
    set_epoch(&mut test, REVEAL_AT + REVEAL_WINDOW_EPOCHS);
    test.call_method::<()>(desk, "settle", args![seq], vec![]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
}
