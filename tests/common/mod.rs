//! Shared helpers for the integration tests (Linux/macOS: the engine's JIT does not build on Windows).
//!
//! `client` is an independent copy of what the web client computes: commitments, sale keys, proofs
//! and the delivery cipher. Each successful delivery, dispute and reveal checks it against the
//! template, so the two cannot drift apart unnoticed.

#![allow(dead_code)]

use blake2::{digest::consts::U32, Blake2b, Digest};
use tari_template_lib_types::{
    bytes::Bytes,
    constants::TARI_TOKEN,
    crypto::{RistrettoPublicKeyBytes, Scalar32Bytes},
    Amount, ComponentAddress, Hash32, NonFungibleAddress, ResourceAddress,
};
use tari_template_test_tooling::{
    crypto::RistrettoSecretKey,
    engine_types::virtual_substate::{VirtualSubstate, VirtualSubstateId},
    transaction::{args, Transaction},
    TemplateTest,
};

pub const PRICE: u64 = 1_000;
pub const REVEAL_WINDOW_EPOCHS: u64 = 10;
pub const MAX_CALLS: u64 = 1_000;
pub const MAX_SALES: u64 = 3_000;
pub const BLOCK_LEN: usize = 640;
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

/// Sale keys, proofs and the delivery cipher, as the web client computes them.
pub mod client {
    use curve25519_dalek::{
        ristretto::{CompressedRistretto, RistrettoPoint},
        scalar::Scalar,
    };
    use sha2::{Digest, Sha512};
    use tari_template_lib_types::ComponentAddress;

    pub const AUTH: &[u8] = b"tari.ootle.signal_desk.auth.v1";
    pub const DLEQ: &[u8] = b"tari.ootle.signal_desk.dleq.v1";
    pub const KEY: &[u8] = b"tari.ootle.signal_desk.key.v1";
    pub const STREAM: &[u8] = b"tari.ootle.signal_desk.stream.v1";

    fn lp(d: &[u8]) -> [u8; 8] {
        (d.len() as u64).to_le_bytes()
    }

    pub fn sha512(parts: &[&[u8]]) -> [u8; 64] {
        let mut h = Sha512::new();
        for p in parts {
            h.update(p);
        }
        h.finalize().into()
    }

    /// A deterministic secret scalar for a test label (a real client draws 64 random bytes).
    pub fn secret(label: &[u8]) -> Scalar {
        Scalar::from_bytes_mod_order_wide(&sha512(&[b"signal-desk test secret", label]))
    }

    pub fn public(x: &Scalar) -> [u8; 32] {
        RistrettoPoint::mul_base(x).compress().to_bytes()
    }

    fn decode(p: &[u8; 32]) -> RistrettoPoint {
        CompressedRistretto(*p).decompress().expect("a valid point")
    }

    pub fn context(desk: &ComponentAddress, seq: u64, sale: Option<u64>) -> Vec<u8> {
        let mut out = desk.as_bytes().to_vec();
        out.extend_from_slice(&seq.to_le_bytes());
        if let Some(sale) = sale {
            out.extend_from_slice(&sale.to_le_bytes());
        }
        out
    }

    fn challenge(domain: &[u8], context: &[u8], message: &[u8], points: &[&[u8; 32]]) -> Scalar {
        let (dl, cl, ml) = (lp(domain), lp(context), lp(message));
        let mut parts: Vec<&[u8]> = vec![&dl, domain, &cl, context, &ml, message];
        for p in points {
            parts.push(&p[..]);
        }
        Scalar::from_bytes_mod_order_wide(&sha512(&parts))
    }

    /// Compact Schnorr proof `(c, z)` of knowledge of `x`, over `message`, bound to `context`.
    pub fn prove_knows(context: &[u8], x: &Scalar, message: &[u8]) -> ([u8; 32], [u8; 32]) {
        let p = public(x);
        let k = secret(&[x.as_bytes().as_slice(), message, context].concat());
        let a = public(&k);
        let c = challenge(AUTH, context, message, &[&p, &a]);
        (c.to_bytes(), (k + c * x).to_bytes())
    }

    /// `S = b·R` and a DLEQ proof that `log_G(B) = log_R(S)`.
    pub fn prove_shared(context: &[u8], b: &Scalar, ephemeral: &[u8; 32]) -> ([u8; 32], [u8; 32], [u8; 32]) {
        let key = public(b);
        let r = decode(ephemeral);
        let shared = (r * b).compress().to_bytes();
        let k = secret(&[b.as_bytes().as_slice(), ephemeral, context].concat());
        let a1 = public(&k);
        let a2 = (r * k).compress().to_bytes();
        let c = challenge(DLEQ, context, &[], &[&key, ephemeral, &shared, &a1, &a2]);
        (shared, c.to_bytes(), (k + c * b).to_bytes())
    }

    pub fn shared_from_ephemeral(r: &Scalar, buyer_key: &[u8; 32]) -> [u8; 32] {
        (decode(buyer_key) * r).compress().to_bytes()
    }

    pub fn keystream(context: &[u8], key: &[u8; 32], ephemeral: &[u8; 32], shared: &[u8; 32], len: usize) -> Vec<u8> {
        let k = sha512(&[&lp(KEY), KEY, &lp(context), context, key, ephemeral, shared]);
        (0..(len / 64) as u8).flat_map(|i| sha512(&[&lp(STREAM), STREAM, &k, &[i]])).collect()
    }

    /// `len (u16 LE) || payload || len (u8) || nonce || zeros`, `len` bytes in all.
    pub fn block(payload: &[u8], nonce: &[u8], len: usize) -> Vec<u8> {
        let mut b = (payload.len() as u16).to_le_bytes().to_vec();
        b.extend_from_slice(payload);
        b.push(nonce.len() as u8);
        b.extend_from_slice(nonce);
        b.resize(len, 0);
        b
    }

    pub fn xor(a: &[u8], b: &[u8]) -> Vec<u8> {
        a.iter().zip(b).map(|(x, y)| x ^ y).collect()
    }
}

pub fn point(bytes: [u8; 32]) -> RistrettoPublicKeyBytes {
    RistrettoPublicKeyBytes::from_bytes(&bytes).unwrap()
}

pub fn scalar(bytes: [u8; 32]) -> Scalar32Bytes {
    Scalar32Bytes::from_bytes(&bytes).unwrap()
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
        // The engine prefixes custom topics with the template's module name.
        .find(|e| e.topic().ends_with(".call_revealed"))
        .expect("reveal emits call_revealed");
    assert_eq!(event.payload().get_str("seq"), Some(seq.to_string().as_str()));
    event.payload().get_str("payload").expect("the event carries the payload").to_string()
}

/// A buyer: their account (and its signing key), the sale key `b` they registered, and their sale.
pub struct Buyer {
    pub account: ComponentAddress,
    pub proof: NonFungibleAddress,
    pub key: RistrettoSecretKey,
    pub b: curve25519_dalek::scalar::Scalar,
    pub seq: u64,
    pub sale: u64,
}

impl Buyer {
    pub fn sale_key(&self) -> [u8; 32] {
        client::public(&self.b)
    }
}

/// The transaction of a purchase of call `seq` with sale key `b` and proof `(c, z)`.
pub fn buy_tx(test: &mut TemplateTest, desk: ComponentAddress, seq: u64, account: ComponentAddress, key: &RistrettoSecretKey, sale_key: [u8; 32], (c, z): ([u8; 32], [u8; 32])) -> Transaction {
    test.transaction()
        .call_method(account, "withdraw", args![TARI_TOKEN, Amount::from_u64(PRICE)])
        .put_last_instruction_output_on_workspace("payment")
        .call_method(desk, "buy", args![seq, point(sale_key), scalar(c), scalar(z), Workspace("payment")])
        .put_last_instruction_output_on_workspace("out")
        .call_method(account, "deposit", args![Workspace("out.0")])
        .build_and_seal(key)
}

/// A funded buyer buys one sale of call `seq` with a fresh sale key and keeps the badge.
pub fn buy(test: &mut TemplateTest, desk: ComponentAddress, seq: u64) -> Buyer {
    let (account, proof, key) = test.create_funded_account();
    let sale: u64 = test.call_method(desk, "sold", args![seq], vec![]);
    let b = client::secret(&[account.as_bytes().as_slice(), &seq.to_le_bytes()].concat());
    let pk = client::prove_knows(&client::context(&desk, seq, None), &b, b"buy");
    let tx = buy_tx(test, desk, seq, account, &key, client::public(&b), pk);
    test.execute_expect_success(tx, vec![proof.clone()]);
    Buyer { account, proof, key, b, seq, sale }
}

/// What a delivery published: `R` and the ciphertext (from the `call_delivered` event).
pub struct Delivery {
    pub ephemeral: [u8; 32],
    pub ciphertext: Vec<u8>,
}

/// The publisher's delivery of `block` to `buyer`, as a transaction (default key unless `signer`).
pub fn deliver_tx(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer, block: &[u8], signer: Option<&RistrettoSecretKey>) -> (Transaction, Delivery) {
    let ctx = client::context(&desk, buyer.seq, Some(buyer.sale));
    let r = client::secret(&[b"ephemeral".as_slice(), &ctx].concat());
    let ephemeral = client::public(&r);
    let shared = client::shared_from_ephemeral(&r, &buyer.sale_key());
    let ciphertext = client::xor(block, &client::keystream(&ctx, &buyer.sale_key(), &ephemeral, &shared, block.len()));
    let (rc, rz) = client::prove_knows(&ctx, &r, b"ephemeral");
    let key = signer.cloned().unwrap_or_else(|| test.secret_key().clone());
    let tx = test
        .transaction()
        .call_method(desk, "deliver", args![buyer.seq, buyer.sale, point(ephemeral), scalar(rc), scalar(rz), Bytes::from_vec(ciphertext.clone())])
        .build_and_seal(&key);
    (tx, Delivery { ephemeral, ciphertext })
}

/// Delivers `payload` (with the test nonce) to `buyer` and checks the event carries the ciphertext.
pub fn deliver(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer, payload: &str) -> Delivery {
    deliver_block(test, desk, buyer, &client::block(payload.as_bytes(), NONCE, BLOCK_LEN))
}

pub fn deliver_block(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer, block: &[u8]) -> Delivery {
    let (tx, delivery) = deliver_tx(test, desk, buyer, block, None);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result.finalize.events.iter().find(|e| e.topic().ends_with(".call_delivered")).expect("deliver emits call_delivered");
    assert_eq!(event.payload().get_str("ciphertext"), Some(hex(&delivery.ciphertext).as_str()));
    delivery
}

/// What the buyer reads: the delivery decrypted with their sale key.
pub fn open_delivery(desk: ComponentAddress, buyer: &Buyer, delivery: &Delivery) -> Vec<u8> {
    let ctx = client::context(&desk, buyer.seq, Some(buyer.sale));
    let (shared, _, _) = client::prove_shared(&ctx, &buyer.b, &delivery.ephemeral);
    client::xor(&delivery.ciphertext, &client::keystream(&ctx, &buyer.sale_key(), &delivery.ephemeral, &shared, delivery.ciphertext.len()))
}

/// The buyer's dispute of their delivery, signed by their account key.
pub fn dispute_tx(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer, delivery: &Delivery) -> Transaction {
    let ctx = client::context(&desk, buyer.seq, Some(buyer.sale));
    let (shared, c, z) = client::prove_shared(&ctx, &buyer.b, &delivery.ephemeral);
    test.transaction()
        .call_method(desk, "dispute", args![buyer.seq, buyer.sale, point(shared), scalar(c), scalar(z), Bytes::from_vec(delivery.ciphertext.clone())])
        .build_and_seal(&buyer.key)
}

/// Disputes and returns the verdict from the `call_disputed` event.
pub fn dispute(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer, delivery: &Delivery) -> String {
    let tx = dispute_tx(test, desk, buyer, delivery);
    let result = test.execute_expect_success(tx, vec![]);
    let event = result.finalize.events.iter().find(|e| e.topic().ends_with(".call_disputed")).expect("dispute emits call_disputed");
    event.payload().get_str("verdict").expect("a verdict").to_string()
}

pub fn sale_status(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer) -> String {
    test.call_method(desk, "sale_status", args![buyer.seq, buyer.sale], vec![])
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

/// `refund_tx` for a `Buyer`.
pub fn refund_of(test: &mut TemplateTest, desk: ComponentAddress, buyer: &Buyer) -> Transaction {
    let badges: ResourceAddress = test.call_method(desk, "badge_resource", args![buyer.seq], vec![]);
    refund_tx(test, desk, buyer.seq, badges, buyer.account, &buyer.key)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[track_caller]
pub fn expect_reject(test: &mut TemplateTest, tx: Transaction, proofs: Vec<NonFungibleAddress>, needle: &str) {
    let reason = format!("{:?}", test.execute_expect_failure(tx, proofs));
    assert!(
        reason.to_lowercase().contains(&needle.to_lowercase()),
        "rejected for the wrong reason (wanted {needle:?}): {reason}"
    );
}
