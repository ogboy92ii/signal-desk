//! A publisher signs a transaction for some other component (a dApp, a phishing page), and that
//! component calls their desk. The key rule on `seal` must not pass: the signer's key badge only
//! counts for calls the transaction makes itself, not for calls made by another component.

mod common;

use common::*;
use tari_template_lib_types::{bytes::Bytes, Amount, ComponentAddress};
use tari_template_test_tooling::{transaction::args, TemplateTest};

const A: &str = "v1|ETHUSDT|LONG|3100|3400|2950|2026-11-20T00:00Z";

fn desk_and_proxy() -> (TemplateTest, ComponentAddress, ComponentAddress) {
    let mut test = TemplateTest::new_cwd([".", "tests/templates/proxy"]);
    set_epoch(&mut test, 1);
    let (payout, _, _) = test.create_empty_account();
    let desk: ComponentAddress = test.call_function("SignalDesk", "open_desk", args![payout], vec![]);
    let proxy: ComponentAddress = test.call_function("DeskProxy", "new", args![], vec![]);
    (test, desk, proxy)
}

#[test]
fn a_component_the_publisher_signs_for_cannot_seal_in_their_name() {
    let (mut test, desk, proxy) = desk_and_proxy();
    let key = test.secret_key().clone();
    let commitment = digest(&test, desk, 0, A);

    // Signed by the publisher's own key, but the call to `seal` comes from the proxy.
    let lured = test
        .transaction()
        .call_method(proxy, "seal_via", args![desk, 0u64, commitment, 5u64, Amount::from_u64(PRICE), "ETHUSDT".to_string(), Bytes::from_vec(Vec::new())])
        .build_and_seal(&key);
    test.execute_expect_failure(lured, vec![]);
    assert_eq!(test.call_method::<u64>(desk, "call_count", args![], vec![]), 0, "nothing was sealed");

    // The same seal made by the transaction itself passes: the refusal above comes from the rule.
    assert_eq!(seal(&mut test, desk, A, 5), 0);
}

#[test]
fn a_component_triggering_a_payout_still_pays_the_payout_account() {
    let (mut test, desk, proxy) = desk_and_proxy();
    let seq = seal(&mut test, desk, A, 5);
    let buyer = buy(&mut test, desk, seq);
    deliver(&mut test, desk, &buyer, A);
    set_epoch(&mut test, 5);
    reveal(&mut test, desk, seq, A);
    set_epoch(&mut test, 5 + REVEAL_WINDOW_EPOCHS);
    test.call_method::<()>(desk, "settle", args![seq], vec![]);

    // Calls through the proxy do reach the desk: `withdraw` is open, and the money cannot be diverted.
    let (_, _, stranger) = test.create_funded_account();
    let before = payout_balance(&mut test, desk);
    let tx = test
        .transaction()
        .call_method(proxy, "withdraw_via", args![desk, Amount::from_u64(PRICE)])
        .build_and_seal(&stranger);
    test.execute_expect_success(tx, vec![]);
    assert_eq!(payout_balance(&mut test, desk), before.checked_add(Amount::from_u64(PRICE)).unwrap());
    assert_eq!(test.call_method::<Amount>(desk, "earnings_balance", args![], vec![]), Amount::zero());
}
