//! The forecast board: only the organizer asks and resolves, forecasts are sealed before the close and
//! opened after it, one per key, a copied commitment never opens, and a full board still works.
//! Linux/macOS only (the engine's JIT does not build on Windows): run in CI.

use blake2::{digest::consts::U32, Blake2b, Digest};
use tari_template_lib_types::{bytes::Bytes, crypto::RistrettoPublicKeyBytes, ComponentAddress, Hash32, NonFungibleAddress};
use tari_template_test_tooling::{
    byte_type::ToByteType,
    crypto::RistrettoSecretKey,
    engine_types::virtual_substate::{VirtualSubstate, VirtualSubstateId},
    transaction::{args, Transaction},
    TemplateTest,
};

const MAX_QUESTIONS: u64 = 200;
const MAX_FORECASTS: u64 = 1_500;
const NONCE: &[u8] = b"forecast-nonce-0123456789abcdefg";
const Q: &str = "Prix du BTC le 30 novembre à minuit (UTC) ?";

/// The template's `commitment_of`, computed off chain as a client must.
fn commitment_of(board: &str, question: u64, forecaster: &[u8], answer: &str, nonce: &[u8]) -> Hash32 {
    let mut h = Blake2b::<U32>::new();
    let q = question.to_le_bytes();
    for part in [b"tari.ootle.signal_desk.forecast.v1".as_slice(), board.as_bytes(), q.as_slice(), forecaster, answer.as_bytes(), nonce] {
        h.update((part.len() as u64).to_le_bytes());
        h.update(part);
    }
    Hash32::from_array(h.finalize().into())
}

fn set_epoch(test: &mut TemplateTest, epoch: u64) {
    test.set_virtual_substate(VirtualSubstateId::CurrentEpoch, VirtualSubstate::CurrentEpoch(epoch));
}

fn new_board() -> (TemplateTest, ComponentAddress) {
    new_league(true)
}

fn new_league(open: bool) -> (TemplateTest, ComponentAddress) {
    let mut test = TemplateTest::new_cwd(["."]);
    set_epoch(&mut test, 1);
    let board: ComponentAddress = test.call_function("SignalForecasts", "open_board", args![String::new(), "league".to_string(), open], vec![]);
    (test, board)
}

type Keys = Vec<RistrettoPublicKeyBytes>;

fn members_tx(test: &mut TemplateTest, board: ComponentAddress, add: Keys, remove: Keys, block: Keys, unblock: Keys, signer: &RistrettoSecretKey) -> Transaction {
    test.transaction().call_method(board, "update_members", args![add, remove, block, unblock]).build_and_seal(signer)
}

fn ask(test: &mut TemplateTest, board: ComponentAddress, close: u64) -> u64 {
    let id: u64 = test.call_method(board, "question_count", args![], vec![]);
    test.call_method(board, "ask", args![id, Q.to_string(), close, close + 10], vec![])
}

struct Player {
    key: RistrettoSecretKey,
    public: RistrettoPublicKeyBytes,
    proof: NonFungibleAddress,
}

fn player(test: &mut TemplateTest) -> Player {
    let (_, proof, key, public) = test.create_funded_account_with_keypair();
    Player { key, public: public.to_byte_type(), proof }
}

/// A signing key with no account, number `i`.
fn signer(i: u64) -> Player {
    use tari_template_test_tooling::crypto::{PublicKey, RistrettoPublicKey, SecretKey};
    let seed: [u8; 64] = blake2::Blake2b512::digest(format!("signal-forecasts test signer {i}")).into();
    let key = RistrettoSecretKey::from_uniform_bytes(&seed).expect("64 bytes");
    let public = RistrettoPublicKey::from_secret_key(&key).to_byte_type();
    Player { key, public, proof: NonFungibleAddress::from_public_key(public) }
}

fn seal_tx(test: &mut TemplateTest, board: ComponentAddress, question: u64, p: &Player, answer: &str) -> Transaction {
    let c = commitment_of(&board.to_string(), question, p.public.as_bytes(), answer, NONCE);
    test.transaction().call_method(board, "seal", args![question, c]).build_and_seal(&p.key)
}

fn reveal_tx(test: &mut TemplateTest, board: ComponentAddress, question: u64, index: u64, answer: &str, signer: &RistrettoSecretKey) -> Transaction {
    test.transaction()
        .call_method(board, "reveal", args![question, index, answer.to_string(), Bytes::from_vec(NONCE.to_vec())])
        .build_and_seal(signer)
}

#[track_caller]
fn expect_reject(test: &mut TemplateTest, tx: Transaction, needle: &str) {
    let reason = format!("{:?}", test.execute_expect_failure(tx, vec![]));
    assert!(reason.to_lowercase().contains(&needle.to_lowercase()), "rejected for the wrong reason (wanted {needle:?}): {reason}");
}

#[test]
fn a_forecast_is_sealed_before_the_close_and_opened_after_it() {
    let (mut test, board) = new_board();
    let q = ask(&mut test, board, 5);
    let alice = player(&mut test);
    let tx = seal_tx(&mut test, board, q, &alice, "98500");
    let result = test.execute_expect_success(tx, vec![alice.proof.clone()]);
    assert!(result.finalize.events.iter().any(|e| e.topic().ends_with(".forecast_sealed")));

    // One forecast per key and question.
    let twice = seal_tx(&mut test, board, q, &alice, "99000");
    expect_reject(&mut test, twice, "already sealed");

    // Not before the close.
    let early = reveal_tx(&mut test, board, q, 0, "98500", &alice.key);
    expect_reject(&mut test, early, "too early");

    set_epoch(&mut test, 5);
    // No sealing after the close.
    let bob = player(&mut test);
    let late = seal_tx(&mut test, board, q, &bob, "97000");
    expect_reject(&mut test, late, "forecasts closed");
    // Only the sealed answer opens it.
    let wrong = reveal_tx(&mut test, board, q, 0, "99000", &alice.key);
    expect_reject(&mut test, wrong, "do not open");
    // Anyone holding the answer and nonce may open it; the event names the forecaster.
    let (_, _, relay) = test.create_funded_account();
    let tx = reveal_tx(&mut test, board, q, 0, "98500", &relay);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result.finalize.events.iter().find(|e| e.topic().ends_with(".forecast_revealed")).expect("forecast_revealed");
    assert_eq!(event.payload().get_str("answer"), Some("98500"));
    assert_eq!(event.payload().get_str("forecaster"), Some(alice.public.to_string().as_str()));
    let again = reveal_tx(&mut test, board, q, 0, "98500", &relay);
    expect_reject(&mut test, again, "already revealed");

    // Too late once the deadline has passed.
    set_epoch(&mut test, 15);
    let none = reveal_tx(&mut test, board, q, 0, "98500", &relay);
    expect_reject(&mut test, none, "deadline passed");
}

#[test]
fn a_commitment_copied_under_another_key_never_opens() {
    let (mut test, board) = new_board();
    let q = ask(&mut test, board, 5);
    let alice = player(&mut test);
    let copier = player(&mut test);
    let tx = seal_tx(&mut test, board, q, &alice, "98500");
    test.execute_expect_success(tx, vec![alice.proof.clone()]);
    // The copier seals Alice's very commitment under their own key.
    let copied = commitment_of(&board.to_string(), q, alice.public.as_bytes(), "98500", NONCE);
    let tx = test.transaction().call_method(board, "seal", args![q, copied]).build_and_seal(&copier.key);
    test.execute_expect_success(tx, vec![copier.proof.clone()]);
    set_epoch(&mut test, 5);
    // Once Alice's answer is public, it still cannot open the copy: the key is bound in.
    let tx = reveal_tx(&mut test, board, q, 0, "98500", &alice.key);
    test.execute_expect_success(tx, vec![]);
    let steal = reveal_tx(&mut test, board, q, 1, "98500", &copier.key);
    expect_reject(&mut test, steal, "do not open");
}

#[test]
fn only_the_organizer_asks_and_resolves_once_after_the_close() {
    let (mut test, board) = new_board();
    let other = player(&mut test);
    let tx = test.transaction().call_method(board, "ask", args![0u64, Q.to_string(), 5u64, 15u64]).build_and_seal(&other.key);
    test.execute_expect_failure(tx, vec![]);
    let q = ask(&mut test, board, 5);

    let key = test.secret_key().clone();
    let hidden = test.transaction().call_method(board, "ask", args![1u64, "BTC \u{202E}".to_string(), 5u64, 15u64]).build_and_seal(&key);
    expect_reject(&mut test, hidden, "hidden characters");
    let early = test.transaction().call_method(board, "resolve", args![q, "98500".to_string()]).build_and_seal(&key);
    expect_reject(&mut test, early, "too early");

    set_epoch(&mut test, 5);
    let stranger = test.transaction().call_method(board, "resolve", args![q, "1".to_string()]).build_and_seal(&other.key);
    test.execute_expect_failure(stranger, vec![]);
    test.call_method::<()>(board, "resolve", args![q, "98500".to_string()], vec![]);
    let twice = test.transaction().call_method(board, "resolve", args![q, "1".to_string()]).build_and_seal(&key);
    expect_reject(&mut test, twice, "already resolved");
}

#[test]
fn whoami_returns_the_signer_key() {
    let (mut test, board) = new_board();
    let p = player(&mut test);
    let tx = test.transaction().call_method(board, "whoami", args![]).build_and_seal(&p.key);
    test.execute_expect_success(tx, vec![]);
    let returned: RistrettoPublicKeyBytes = test.expect_return(0);
    assert_eq!(returned, p.public);
}

#[test]
fn a_full_board_refuses_more_and_still_works() {
    let (mut test, board) = new_board();
    for _ in 0..MAX_QUESTIONS {
        ask(&mut test, board, 5);
    }
    let key = test.secret_key().clone();
    let over = test.transaction().call_method(board, "ask", args![MAX_QUESTIONS, Q.to_string(), 5u64, 15u64]).build_and_seal(&key);
    expect_reject(&mut test, over, "has reached");

    // Every forecast on the last question, from distinct keys. The tooling's own key supply stops at
    // 255, and sealing needs no account: derive the keys here.
    let last = MAX_QUESTIONS - 1;
    let mut first = None;
    for i in 0..MAX_FORECASTS {
        let p = signer(i);
        let tx = seal_tx(&mut test, board, last, &p, "98500");
        test.execute_expect_success(tx, vec![]);
        first.get_or_insert(p);
    }
    assert_eq!(test.call_method::<u64>(board, "forecast_count", args![last], vec![]), MAX_FORECASTS);
    let extra = signer(MAX_FORECASTS);
    let tx = seal_tx(&mut test, board, 0, &extra, "1");
    expect_reject(&mut test, tx, "has reached");

    set_epoch(&mut test, 5);
    let p = first.expect("a first player");
    let tx = reveal_tx(&mut test, board, last, 0, "98500", &p.key);
    test.execute_expect_success(tx, vec![]);
    test.call_method::<()>(board, "resolve", args![last, "98500".to_string()], vec![]);
}

#[test]
fn only_the_organizer_names_the_league_and_nothing_hidden_gets_in() {
    let (mut test, board) = new_board();
    let key = test.secret_key().clone();
    let other = player(&mut test);
    let stranger = test.transaction().call_method(board, "set_profile", args!["Pirates".to_string(), "sport".to_string(), true]).build_and_seal(&other.key);
    test.execute_expect_failure(stranger, vec![]);
    let hidden = test.transaction().call_method(board, "set_profile", args!["BTC \u{202E}".to_string(), "sport".to_string(), true]).build_and_seal(&key);
    expect_reject(&mut test, hidden, "hidden characters");
    let path = test.transaction().call_method(board, "set_profile", args!["Chads".to_string(), "../x.webp".to_string(), true]).build_and_seal(&key);
    expect_reject(&mut test, path, "lowercase letters");
    let tx = test.transaction().call_method(board, "set_profile", args!["Les Chads du BTC".to_string(), "sport".to_string(), true]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result.finalize.events.iter().find(|e| e.topic().ends_with(".profile_updated")).expect("profile_updated");
    assert_eq!(event.payload().get_str("name"), Some("Les Chads du BTC"));
}

#[test]
fn the_organizer_uploads_a_picture_and_only_image_files_are_accepted() {
    let (mut test, board) = new_board();
    let key = test.secret_key().clone();
    let other = player(&mut test);
    let mut webp = b"RIFF\0\0\0\0WEBPVP8 ".to_vec();
    webp.resize(20_000, 7);
    let foreign = test.transaction().call_method(board, "set_picture", args![Bytes::from_vec(webp.clone())]).build_and_seal(&other.key);
    test.execute_expect_failure(foreign, vec![]);
    let svg = test.transaction().call_method(board, "set_picture", args![Bytes::from_vec(b"<svg onload=alert(1)></svg>".to_vec())]).build_and_seal(&key);
    expect_reject(&mut test, svg, "webp, png or jpeg");
    let mut huge = webp.clone();
    huge.resize(24_577, 7);
    let big = test.transaction().call_method(board, "set_picture", args![Bytes::from_vec(huge)]).build_and_seal(&key);
    expect_reject(&mut test, big, "at most");
    let tx = test.transaction().call_method(board, "set_picture", args![Bytes::from_vec(webp)]).build_and_seal(&key);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result.finalize.events.iter().find(|e| e.topic().ends_with(".picture_updated")).expect("picture_updated");
    assert_eq!(event.payload().get_str("size"), Some("20000"));
    // The board still works with a picture in its state.
    let q = ask(&mut test, board, 5);
    let alice = player(&mut test);
    let tx = seal_tx(&mut test, board, q, &alice, "1");
    test.execute_expect_success(tx, vec![alice.proof.clone()]);
}

#[test]
fn a_closed_league_lets_only_its_members_and_organizer_seal() {
    let (mut test, board) = new_league(false);
    let key = test.secret_key().clone();
    let q = ask(&mut test, board, 5);
    let alice = player(&mut test);
    let bob = player(&mut test);
    let tx = seal_tx(&mut test, board, q, &alice, "98500");
    expect_reject(&mut test, tx, "only its members");
    // The organizer seals in their own closed league.
    let organizer = Player { public: test.to_public_key_bytes(), proof: NonFungibleAddress::from_public_key(test.to_public_key_bytes()), key: key.clone() };
    let tx = seal_tx(&mut test, board, q, &organizer, "98000");
    test.execute_expect_success(tx, vec![]);
    // A stranger cannot add themself.
    let tx = members_tx(&mut test, board, vec![bob.public], vec![], vec![], vec![], &bob.key);
    test.execute_expect_failure(tx, vec![]);
    let tx = members_tx(&mut test, board, vec![alice.public], vec![], vec![], vec![], &key);
    test.execute_expect_success(tx, vec![]);
    assert!(test.call_method::<bool>(board, "can_seal", args![alice.public], vec![]));
    assert!(!test.call_method::<bool>(board, "can_seal", args![bob.public], vec![]));
    let tx = seal_tx(&mut test, board, q, &alice, "98500");
    test.execute_expect_success(tx, vec![alice.proof.clone()]);
    // Removed: no new forecast, but the sealed one stays and still opens.
    let tx = members_tx(&mut test, board, vec![], vec![alice.public], vec![], vec![], &key);
    test.execute_expect_success(tx, vec![]);
    let q2 = ask(&mut test, board, 5);
    let tx = seal_tx(&mut test, board, q2, &alice, "1");
    expect_reject(&mut test, tx, "only its members");
    set_epoch(&mut test, 5);
    let tx = reveal_tx(&mut test, board, q, 1, "98500", &alice.key);
    test.execute_expect_success(tx, vec![]);
}

#[test]
fn a_blocked_key_never_seals_and_the_organizer_cannot_block_themself() {
    let (mut test, board) = new_board();
    let key = test.secret_key().clone();
    let q = ask(&mut test, board, 5);
    let mallory = player(&mut test);
    let tx = members_tx(&mut test, board, vec![], vec![], vec![mallory.public], vec![], &key);
    test.execute_expect_success(tx, vec![]);
    let tx = seal_tx(&mut test, board, q, &mallory, "1");
    expect_reject(&mut test, tx, "blocked");
    let me = test.to_public_key_bytes();
    let tx = members_tx(&mut test, board, vec![], vec![], vec![me], vec![], &key);
    expect_reject(&mut test, tx, "cannot block themself");
    let tx = members_tx(&mut test, board, vec![], vec![], vec![], vec![mallory.public], &key);
    test.execute_expect_success(tx, vec![]);
    let tx = seal_tx(&mut test, board, q, &mallory, "1");
    test.execute_expect_success(tx, vec![mallory.proof.clone()]);
    // At most 50 changes per call.
    let many: Keys = (0..51).map(|i| signer(10_000 + i).public).collect();
    let tx = members_tx(&mut test, board, many, vec![], vec![], vec![], &key);
    expect_reject(&mut test, tx, "changes per call");
}
