//! The life of one call on a desk: sealed, sold, delivered to its buyer only, opened publicly only at
//! expiry and only as committed, paid out only once settled and only into the payout account, and
//! closed to sales afterwards.

mod common;

use common::*;
use tari_template_lib_types::{bytes::Bytes, Amount, Hash32};
use tari_template_test_tooling::transaction::args;

const PAYLOAD: &str = "v1|BTCUSDT|LONG|62000|65000|60500|2026-11-20T00:00Z";
const WRONG: &str = "v1|BTCUSDT|SHORT|62000|59000|63500|2026-11-20T00:00Z";
const REVEAL_AT: u64 = 5;

#[test]
fn a_call_is_sold_delivered_opened_only_as_committed_and_paid_only_once_settled() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, PAYLOAD, REVEAL_AT);
    assert_eq!(seq, 0, "the first call of a desk is number 0");
    assert_eq!(test.call_method::<u64>(desk, "opened_at_epoch", args![], vec![]), 1, "the desk records its age");

    let buyer = buy(&mut test, desk, seq);
    assert_eq!(buyer.sale, 0);
    assert_eq!(test.call_method::<u64>(desk, "sold", args![seq], vec![]), 1);
    assert_eq!(test.call_method::<Amount>(desk, "earnings_balance", args![], vec![]), Amount::from_u64(PRICE));
    assert_eq!(sale_status(&mut test, desk, &buyer), "Paid");

    // Delivered before the reveal: the buyer, and only the buyer, reads the call as sealed.
    let delivery = deliver(&mut test, desk, &buyer, PAYLOAD);
    assert_eq!(sale_status(&mut test, desk, &buyer), "Delivered");
    let block = open_delivery(desk, &buyer, &delivery);
    let payload_len = u16::from_le_bytes([block[0], block[1]]) as usize;
    assert_eq!(&block[2..2 + payload_len], PAYLOAD.as_bytes(), "the buyer decrypts the call");
    let publisher = test.to_public_key_bytes();
    let nonce_len = block[2 + payload_len] as usize;
    let nonce = &block[3 + payload_len..3 + payload_len + nonce_len];
    assert_eq!(
        commitment_of(&desk.to_string(), publisher.as_bytes(), seq, PAYLOAD, nonce),
        test.call_method::<Hash32>(desk, "commitment", args![seq], vec![]),
        "and can check it against the sealed commitment before the reveal"
    );

    // Proceeds stay locked: nothing is settled.
    let key = test.secret_key().clone();
    let early_pay = test.transaction().call_method(desk, "withdraw", args![Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, early_pay, vec![], "only settled proceeds");

    // Not before the reveal epoch.
    let early = test
        .transaction()
        .call_method(desk, "reveal", args![seq, PAYLOAD.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key);
    expect_reject(&mut test, early, vec![], "too early");

    set_epoch(&mut test, REVEAL_AT);

    // Not as a different call.
    let wrong = test
        .transaction()
        .call_method(desk, "reveal", args![seq, WRONG.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key);
    expect_reject(&mut test, wrong, vec![], "do not open this commitment");

    assert_eq!(reveal(&mut test, desk, seq, PAYLOAD), PAYLOAD, "the event publishes the call as committed");
    assert_eq!(test.call_method::<Option<u64>>(desk, "revealed_at_epoch", args![seq], vec![]), Some(REVEAL_AT));
    assert_eq!(test.call_method::<(u64, u64, u64, u64)>(desk, "stats", args![], vec![]), (1, 1, 0, 0));

    // Opened once only.
    let again = test
        .transaction()
        .call_method(desk, "reveal", args![seq, PAYLOAD.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(&key);
    expect_reject(&mut test, again, vec![], "already revealed");

    // Settled only once no dispute can come.
    let early_settle = test.transaction().call_method(desk, "settle", args![seq]).build_and_seal(&key);
    expect_reject(&mut test, early_settle, vec![], "disputes are open");
    set_epoch(&mut test, REVEAL_AT + REVEAL_WINDOW_EPOCHS);
    test.call_method::<()>(desk, "settle", args![seq], vec![]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
    let twice = test.transaction().call_method(desk, "settle", args![seq]).build_and_seal(&key);
    expect_reject(&mut test, twice, vec![], "already settled");

    // The publisher is paid now, into the payout account fixed at opening.
    let before = payout_balance(&mut test, desk);
    test.call_method::<()>(desk, "withdraw", args![Amount::from_u64(PRICE)], vec![]);
    assert_eq!(payout_balance(&mut test, desk), before.checked_add(Amount::from_u64(PRICE)).unwrap());
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::zero());

    // A delivered sale of an opened call never refunds.
    let tx = refund_of(&mut test, desk, &buyer);
    expect_reject(&mut test, tx, vec![buyer.proof.clone()], "nothing to refund");

    // And the sale is closed: the payload is public.
    let (late, late_proof, late_key) = test.create_funded_account();
    let b = client::secret(b"late");
    let pk = client::prove_knows(&client::context(&desk, seq, None), &b, b"buy");
    let too_late = buy_tx(&mut test, desk, seq, late, &late_key, client::public(&b), pk);
    expect_reject(&mut test, too_late, vec![late_proof], "already revealed");
}
