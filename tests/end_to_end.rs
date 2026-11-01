//! The life of one call on a desk: sealed, sold, opened only at expiry and only as committed, paid
//! out only once open, and closed to sales afterwards.

mod common;

use common::*;
use tari_template_lib_types::{bytes::Bytes, constants::TARI_TOKEN, Amount};
use tari_template_test_tooling::transaction::args;

const PAYLOAD: &str = "v1|BTCUSDT|LONG|62000|65000|60500|2026-11-20T00:00Z";
const WRONG: &str = "v1|BTCUSDT|SHORT|62000|59000|63500|2026-11-20T00:00Z";
const REVEAL_AT: u64 = 5;

#[test]
fn a_call_is_sold_sealed_then_opened_only_as_committed_and_paid_only_once_open() {
    let (mut test, desk) = new_desk();
    let seq = seal(&mut test, desk, PAYLOAD, REVEAL_AT);
    assert_eq!(seq, 0, "the first call of a desk is number 0");
    assert_eq!(test.call_method::<u64>(desk, "opened_at_epoch", args![], vec![]), 1, "the desk records its age");
    assert!(test.call_method::<Option<String>>(desk, "payload", args![seq], vec![]).is_none());

    buy(&mut test, desk, seq);
    assert_eq!(test.call_method::<u64>(desk, "sold", args![seq], vec![]), 1);
    assert_eq!(test.call_method::<Amount>(desk, "earnings_balance", args![], vec![]), Amount::from_u64(PRICE));

    // Proceeds stay locked while the call is sealed: they back the refunds.
    let key = test.secret_key().clone();
    let early_pay = test.transaction().call_method(desk, "withdraw", args![Amount::from_u64(PRICE)]).build_and_seal(&key);
    expect_reject(&mut test, early_pay, vec![], "only proceeds of opened calls");

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

    test.call_method::<()>(desk, "reveal", args![seq, PAYLOAD.to_string(), Bytes::from_vec(NONCE.to_vec())], vec![]);
    assert_eq!(test.call_method::<Option<String>>(desk, "payload", args![seq], vec![]).as_deref(), Some(PAYLOAD));
    assert_eq!(test.call_method::<Option<u64>>(desk, "revealed_at_epoch", args![seq], vec![]), Some(REVEAL_AT));
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::from_u64(PRICE));
    assert_eq!(test.call_method::<(u64, u64, u64)>(desk, "stats", args![], vec![]), (1, 1, 0));

    // The publisher is paid now.
    let (account, account_proof, _) = test.create_empty_account();
    let pay = test
        .transaction()
        .call_method(desk, "withdraw", args![Amount::from_u64(PRICE)])
        .put_last_instruction_output_on_workspace("money")
        .call_method(account, "deposit", args![Workspace("money")])
        .build_and_seal(&key);
    test.execute_expect_success(pay, vec![account_proof]);
    assert_eq!(test.call_method::<Amount>(desk, "withdrawable", args![], vec![]), Amount::zero());

    // And the sale is closed: the payload is public.
    let (late, late_proof, late_key) = test.create_funded_account();
    let too_late = test
        .transaction()
        .call_method(late, "withdraw", args![TARI_TOKEN, Amount::from_u64(PRICE)])
        .put_last_instruction_output_on_workspace("payment")
        .call_method(desk, "buy", args![seq, Workspace("payment")])
        .put_last_instruction_output_on_workspace("out")
        .call_method(late, "deposit", args![Workspace("out.0")])
        .build_and_seal(&late_key);
    expect_reject(&mut test, too_late, vec![late_proof], "already revealed");
}
