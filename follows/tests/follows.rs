//! A follow list: only its owner changes it, a desk is followed once, unfollowing removes it, every
//! change is an event, a batch applies many changes under one signature, and a full list refuses more
//! without breaking. Linux/macOS only (the engine's JIT does not build on Windows): run in CI.

use tari_template_lib_types::ComponentAddress;
use tari_template_test_tooling::{
    transaction::{args, Transaction},
    TemplateTest,
};

const MAX_FOLLOWS: usize = 500;

fn new_list() -> (TemplateTest, ComponentAddress) {
    let mut test = TemplateTest::new_cwd(["."]);
    let list: ComponentAddress = test.call_function("SignalFollows", "open", args![], vec![]);
    (test, list)
}

/// `n` components to follow. The engine only accepts addresses of components that exist (so a list can
/// never record a desk that is not there); other follow lists serve as targets here.
fn desks(test: &mut TemplateTest, n: usize) -> Vec<ComponentAddress> {
    (0..n).map(|_| test.call_function::<ComponentAddress>("SignalFollows", "open", args![], vec![])).collect()
}

fn following(test: &mut TemplateTest, list: ComponentAddress) -> Vec<ComponentAddress> {
    test.call_method(list, "following", args![], vec![])
}

#[track_caller]
fn expect_reject(test: &mut TemplateTest, tx: Transaction, needle: &str) {
    let reason = format!("{:?}", test.execute_expect_failure(tx, vec![]));
    assert!(reason.to_lowercase().contains(&needle.to_lowercase()), "rejected for the wrong reason (wanted {needle:?}): {reason}");
}

#[test]
fn the_owner_follows_and_unfollows_and_every_change_is_an_event() {
    let (mut test, list) = new_list();
    let d = desks(&mut test, 3);
    let key = test.secret_key().clone();

    let tx = test.transaction().call_method(list, "follow", args![d[0]]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    assert!(result.finalize.events.iter().any(|e| e.topic().ends_with(".followed")));
    test.call_method::<()>(list, "follow", args![d[1]], vec![]);
    assert_eq!(following(&mut test, list), vec![d[0], d[1]]);
    assert!(test.call_method::<bool>(list, "is_following", args![d[1]], vec![]));

    // A desk is followed once.
    let twice = test.transaction().call_method(list, "follow", args![d[0]]).build_and_seal(&key);
    expect_reject(&mut test, twice, "already following");

    let tx = test.transaction().call_method(list, "unfollow", args![d[0]]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    assert!(result.finalize.events.iter().any(|e| e.topic().ends_with(".unfollowed")));
    assert_eq!(following(&mut test, list), vec![d[1]]);
    assert!(!test.call_method::<bool>(list, "is_following", args![d[0]], vec![]));

    let absent = test.transaction().call_method(list, "unfollow", args![d[2]]).build_and_seal(&key);
    expect_reject(&mut test, absent, "not following");
}

#[test]
fn nobody_else_changes_a_list_but_anyone_reads_it() {
    let (mut test, list) = new_list();
    let d = desks(&mut test, 1);
    let (_, _, other) = test.create_funded_account();
    let follow = test.transaction().call_method(list, "follow", args![d[0]]).build_and_seal(&other);
    test.execute_expect_failure(follow, vec![]);
    test.call_method::<()>(list, "follow", args![d[0]], vec![]);
    let unfollow = test.transaction().call_method(list, "unfollow", args![d[0]]).build_and_seal(&other);
    test.execute_expect_failure(unfollow, vec![]);
    // Reading is public.
    let read = test.transaction().call_method(list, "following", args![]).build_and_seal(&other);
    test.execute_expect_success(read, vec![]);
    assert_eq!(following(&mut test, list), vec![d[0]]);
}

#[test]
fn a_batch_applies_many_changes_under_one_signature() {
    let (mut test, list) = new_list();
    let d = desks(&mut test, 7);
    let key = test.secret_key().clone();
    test.call_method::<()>(list, "follow", args![d[0]], vec![]);
    test.call_method::<()>(list, "follow", args![d[1]], vec![]);

    // One transaction: unfollow d0, follow d2 and d3; one event per change.
    let tx = test.transaction().call_method(list, "apply", args![vec![d[2], d[3]], vec![d[0]]]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    let topics: Vec<String> = result.finalize.events.iter().map(|e| e.topic().to_string()).collect();
    assert_eq!(topics.iter().filter(|t| t.ends_with(".followed")).count(), 2);
    assert_eq!(topics.iter().filter(|t| t.ends_with(".unfollowed")).count(), 1);
    assert_eq!(following(&mut test, list), vec![d[1], d[2], d[3]]);

    // All or nothing: one bad change rejects the whole batch.
    let bad = test.transaction().call_method(list, "apply", args![vec![d[4]], vec![d[5]]]).build_and_seal(&key);
    expect_reject(&mut test, bad, "not following");
    assert!(!test.call_method::<bool>(list, "is_following", args![d[4]], vec![]));

    // Owner only.
    let (_, _, other) = test.create_funded_account();
    let foreign = test.transaction().call_method(list, "apply", args![vec![d[6]], Vec::<ComponentAddress>::new()]).build_and_seal(&other);
    test.execute_expect_failure(foreign, vec![]);
}

#[test]
fn a_batch_is_bounded() {
    let (mut test, list) = new_list();
    let d = desks(&mut test, 51);
    let key = test.secret_key().clone();
    let over = test.transaction().call_method(list, "apply", args![d.clone(), Vec::<ComponentAddress>::new()]).build_and_seal(&key);
    expect_reject(&mut test, over, "at most");
    // Fifty pass.
    let ok = test.transaction().call_method(list, "apply", args![d[..50].to_vec(), Vec::<ComponentAddress>::new()]).build_and_seal(&key);
    test.execute_expect_success(ok, vec![]);
    assert_eq!(following(&mut test, list).len(), 50);
}

#[test]
fn a_full_list_refuses_more_and_still_works() {
    let (mut test, list) = new_list();
    let d = desks(&mut test, MAX_FOLLOWS + 1);
    let key = test.secret_key().clone();
    // Filled in ten batches of fifty.
    for chunk in d[..MAX_FOLLOWS].chunks(50) {
        let tx = test.transaction().call_method(list, "apply", args![chunk.to_vec(), Vec::<ComponentAddress>::new()]).build_and_seal(&key);
        test.execute_expect_success(tx, vec![]);
    }
    let over = test.transaction().call_method(list, "follow", args![d[MAX_FOLLOWS]]).build_and_seal(&key);
    expect_reject(&mut test, over, "already follows");
    // Still readable and still editable.
    assert_eq!(following(&mut test, list).len(), MAX_FOLLOWS);
    test.call_method::<()>(list, "unfollow", args![d[0]], vec![]);
    test.call_method::<()>(list, "follow", args![d[MAX_FOLLOWS]], vec![]);
    assert!(test.call_method::<bool>(list, "is_following", args![d[MAX_FOLLOWS]], vec![]));
}

#[test]
fn the_follows_opened_event_names_the_list_and_its_owner() {
    let mut test = TemplateTest::new_cwd(["."]);
    let key = test.secret_key().clone();
    let tpl = test.get_template_address("SignalFollows");
    let tx = test.transaction().call_function(tpl, "open", args![]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result.finalize.events.iter().find(|e| e.topic().ends_with(".follows_opened")).expect("open emits follows_opened");
    let list: ComponentAddress = event.payload().get_str("list").expect("the event names the list").parse().expect("a component address");
    let owner = event.payload().get_str("owner").expect("owner").to_string();
    assert_eq!(test.call_method::<tari_template_lib_types::crypto::RistrettoPublicKeyBytes>(list, "owner", args![], vec![]).to_string(), owner);
}
