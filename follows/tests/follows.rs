//! A follow list: only its owner changes it, a desk is followed once, unfollowing removes it, every
//! change is an event, and a full list refuses more without breaking. Linux/macOS only (the engine's
//! JIT does not build on Windows): run in CI.

use tari_template_lib_types::{ComponentAddress, ObjectKey};
use tari_template_test_tooling::{
    transaction::{args, Transaction},
    TemplateTest,
};

const MAX_FOLLOWS: u64 = 500;

/// A desk address for the tests (the list does not read the desk, it only records it).
fn desk(i: u64) -> ComponentAddress {
    let mut b = [0u8; ObjectKey::LENGTH];
    b[..8].copy_from_slice(&i.to_le_bytes());
    b[31] = 0x5d;
    ComponentAddress::new(ObjectKey::from_array(b))
}

fn new_list() -> (TemplateTest, ComponentAddress) {
    let mut test = TemplateTest::new_cwd(["."]);
    let list: ComponentAddress = test.call_function("SignalFollows", "open", args![], vec![]);
    (test, list)
}

#[track_caller]
fn expect_reject(test: &mut TemplateTest, tx: Transaction, needle: &str) {
    let reason = format!("{:?}", test.execute_expect_failure(tx, vec![]));
    assert!(reason.to_lowercase().contains(&needle.to_lowercase()), "rejected for the wrong reason (wanted {needle:?}): {reason}");
}

#[test]
fn the_owner_follows_and_unfollows_and_every_change_is_an_event() {
    let (mut test, list) = new_list();
    let key = test.secret_key().clone();

    let tx = test.transaction().call_method(list, "follow", args![desk(1)]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    assert!(result.finalize.events.iter().any(|e| e.topic().ends_with(".followed")));
    test.call_method::<()>(list, "follow", args![desk(2)], vec![]);
    assert_eq!(test.call_method::<Vec<ComponentAddress>>(list, "following", args![], vec![]), vec![desk(1), desk(2)]);
    assert!(test.call_method::<bool>(list, "is_following", args![desk(2)], vec![]));

    // A desk is followed once.
    let twice = test.transaction().call_method(list, "follow", args![desk(1)]).build_and_seal(&key);
    expect_reject(&mut test, twice, "already following");

    let tx = test.transaction().call_method(list, "unfollow", args![desk(1)]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    assert!(result.finalize.events.iter().any(|e| e.topic().ends_with(".unfollowed")));
    assert_eq!(test.call_method::<Vec<ComponentAddress>>(list, "following", args![], vec![]), vec![desk(2)]);
    assert!(!test.call_method::<bool>(list, "is_following", args![desk(1)], vec![]));

    let absent = test.transaction().call_method(list, "unfollow", args![desk(9)]).build_and_seal(&key);
    expect_reject(&mut test, absent, "not following");
}

#[test]
fn nobody_else_changes_a_list_but_anyone_reads_it() {
    let (mut test, list) = new_list();
    let (_, _, other) = test.create_funded_account();
    let follow = test.transaction().call_method(list, "follow", args![desk(1)]).build_and_seal(&other);
    test.execute_expect_failure(follow, vec![]);
    test.call_method::<()>(list, "follow", args![desk(1)], vec![]);
    let unfollow = test.transaction().call_method(list, "unfollow", args![desk(1)]).build_and_seal(&other);
    test.execute_expect_failure(unfollow, vec![]);
    // Reading is public.
    let read = test.transaction().call_method(list, "following", args![]).build_and_seal(&other);
    test.execute_expect_success(read, vec![]);
    assert_eq!(test.call_method::<Vec<ComponentAddress>>(list, "following", args![], vec![]), vec![desk(1)]);
}

#[test]
fn a_full_list_refuses_more_and_still_works() {
    let (mut test, list) = new_list();
    for i in 0..MAX_FOLLOWS {
        test.call_method::<()>(list, "follow", args![desk(i)], vec![]);
    }
    let key = test.secret_key().clone();
    let over = test.transaction().call_method(list, "follow", args![desk(MAX_FOLLOWS)]).build_and_seal(&key);
    expect_reject(&mut test, over, "already follows");
    // Still readable and still editable.
    assert_eq!(test.call_method::<Vec<ComponentAddress>>(list, "following", args![], vec![]).len() as u64, MAX_FOLLOWS);
    test.call_method::<()>(list, "unfollow", args![desk(0)], vec![]);
    test.call_method::<()>(list, "follow", args![desk(MAX_FOLLOWS)], vec![]);
    assert!(test.call_method::<bool>(list, "is_following", args![desk(MAX_FOLLOWS)], vec![]));
}
