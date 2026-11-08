// Copyright 2026 Soufian J (OG Boy)
// SPDX-License-Identifier: BSD-3-Clause

//! # Signal Desk
//!
//! Verifiable crypto calls on the Tari Ootle. A caller opens one **desk**. Every call they seal goes
//! into the desk's registry under the next sequence number, and nothing ever removes it.
//!
//! A call is only `commitment_of(desk, publisher, seq, payload, nonce)` while it is for sale: the
//! payload never touches the chain in clear before its reveal epoch.
//!
//! 1. `buy`: a buyer pays the price into the desk's escrow, registers a sale key `B` (drawn by their
//!    client for this purchase, with a proof they hold it) and receives a badge for that sale.
//! 2. `deliver`: before the reveal epoch, the caller sends the call to that buyer only: an ephemeral
//!    key `R` with a proof of its secret `r`, and the call encrypted under a keystream derived from
//!    `S = r·B`. Only the buyer can compute `S = b·R`. The ciphertext goes out in an event; the state
//!    keeps its hash.
//! 3. `dispute`: until the end of the reveal window, the buyer may publish `S` with a DLEQ proof that
//!    `S = b·R`. The template decrypts, re-hashes and compares with the sealed commitment:
//!    * match: the dispute is rejected (and the call is public from then on);
//!    * mismatch or unreadable block: **fraud**. The sale becomes refundable and the call carries the
//!      verdict for good in [`SignalDesk::stats`].
//! 4. `reveal`: from the reveal epoch, anyone holding the payload and nonce opens the call; the
//!    template checks it and publishes it in the `call_revealed` event. The caller may store with the
//!    seal a time-locked copy of `payload` and `nonce` (`tlock`, drand quicknet, opaque here): once its
//!    round is published, any client can decrypt it and reveal, so a call opens without its caller. A
//!    copy that does not open the commitment changes nothing: the reveal is refused and the call
//!    refunds like any call never opened.
//! 5. `settle`: once the reveal window of an opened call is over, the price of every delivered sale
//!    that was not a fraud becomes payable to the caller. A sale never delivered is never paid.
//! 6. `refund`: a badge refunds its sale if it was never delivered before the reveal epoch, if it won
//!    a fraud verdict, or if the call was never opened.
//!
//! What the registry buys over isolated vaults:
//!
//! * **no cherry-picking**: a caller cannot seal ten calls and show three. Every sealed call has a
//!   number, and `stats` counts the ones never opened;
//! * **an age**: the epoch the desk was opened is recorded, so a fresh desk cannot pose as an old
//!   track record;
//! * **proceeds follow delivery and results**: the caller is paid for a sale only once it was
//!   delivered, the call is open and the dispute window is over, and always into the payout account
//!   fixed when the desk was opened.
//!
//! "Never opened" means the caller did not reveal the call, not that the trade lost: judging the trade
//! is the scorer's job, from the published payloads and public market data. What the template cannot
//! guarantee: that a call is any good, or that a buyer keeps it to themselves.
//!
//! Payment is in TARI only: the engine lets a resource's issuer recall or freeze it in any vault, so a
//! coin the caller issued would let them take the escrow back.
//!
//! The proofs and the keystream follow Crypt (the October contest's audited template), with their own
//! domains: a proof made for one never verifies in the other.

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
use tari_template_lib::prelude::*;
use tari_template_lib::types::Hash32;

/// Domain separator for the commitment hash.
const DOMAIN: &[u8] = b"tari.ootle.signal_desk.commitment.v2";
// Must stay byte-for-byte identical to the client (maquettes/crypto.js).
const DOMAIN_AUTH: &[u8] = b"tari.ootle.signal_desk.auth.v1";
const DOMAIN_DLEQ: &[u8] = b"tari.ootle.signal_desk.dleq.v1";
const DOMAIN_KEY: &[u8] = b"tari.ootle.signal_desk.key.v1";
const DOMAIN_STREAM: &[u8] = b"tari.ootle.signal_desk.stream.v1";
const MSG_BUY: &[u8] = b"buy";
const MSG_EPHEMERAL: &[u8] = b"ephemeral";

type Blake2b256 = Blake2b<U32>;

/// Epochs after `reveal_at_epoch` during which a call can still be opened, and a delivery disputed.
pub const REVEAL_WINDOW_EPOCHS: u64 = 10;
/// Furthest reveal epoch a call may be sealed with, counted from the current epoch.
pub const MAX_REVEAL_HORIZON_EPOCHS: u64 = 10_000;
/// A short nonce would let anyone brute-force a guessable payload from the public commitment. The
/// client must draw 32 bytes from a CSPRNG; the chain can only refuse obviously short ones.
pub const MIN_NONCE_LEN: usize = 16;
pub const MAX_NONCE_LEN: usize = 64;
/// Published in the reveal event (2 KiB per event), never stored in the component state.
pub const MAX_PAYLOAD_LEN: usize = 1024;
/// Bound of the time-locked copy kept in the state until the reveal: the binary age file of a call
/// with its nonce is 473 bytes for a `v1|…` call, 567 for the longest call the site seals.
pub const MAX_TLOCK_LEN: usize = 640;
/// Size of every delivered block: `len (u16 LE) || payload || len (u8) || nonce || zeros`. Ten SHA-512
/// blocks of keystream; 1 280 hex characters, under the 2 KiB event limit. A call is deliverable only
/// if `payload + nonce` fit in 637 bytes (a `v1|…` call is about 50).
pub const BLOCK_LEN: usize = 640;
/// Bounds the registry. The whole component state is decoded and re-encoded on every call within the
/// engine's 2 MiB of WASM memory (Ootle 0.49), several copies at once: in CI a desk holding 1 000 calls
/// ran out near 890 sales. 500 calls and 1 000 sales keep a wide margin; the CI fills a desk to both
/// limits at once and checks it still sells, delivers, opens and settles. Larger desks would need one
/// component per call.
pub const MAX_CALLS: u64 = 500;
pub const MAX_SALES: u64 = 1_000;

const _: () = assert!(BLOCK_LEN.is_multiple_of(64) && BLOCK_LEN / 64 <= 256);

/// The commitment a caller seals as call number `seq` of `desk`, and the value `reveal` checks.
///
/// Every part is length-prefixed, so bytes cannot be shifted between parts to open one commitment two
/// ways. The desk address, the publisher's key and `seq` bind it to one slot of one desk: a commitment
/// copied into another desk, or sealed under another number, never opens.
///
/// Compute it off-chain: payload and nonce in a transaction would be public.
pub fn commitment_of(desk: &str, publisher: &[u8], seq: u64, payload: &str, nonce: &[u8]) -> Hash32 {
    let mut hasher = Blake2b256::new();
    let seq = seq.to_le_bytes();
    for part in [DOMAIN, desk.as_bytes(), publisher, seq.as_slice(), payload.as_bytes(), nonce] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    Hash32::from_array(hasher.finalize().into())
}

/// A payload reads exactly the way it hashes only if every character is printable ASCII: no line
/// breaks, no bidi controls, no zero-width or look-alike characters to show one call and hold another.
pub fn payload_is_canonical(payload: &str) -> bool {
    payload.bytes().all(|b| (0x20..=0x7E).contains(&b))
}

pub const MAX_LABEL_LEN: usize = 64;

/// A public label: what a call is about, shown before it opens. One or more `|`-separated
/// non-empty fields of printable ASCII: `BTCUSDT`, `NFL|KC@BUF|2026-11-22T18:25Z`.
pub fn label_is_valid(label: &str) -> bool {
    (2..=MAX_LABEL_LEN).contains(&label.len()) && payload_is_canonical(label) && label.split('|').all(|f| !f.is_empty())
}

/// Whether a `v1` payload is about `label`: it reads `v1|<label>|...`.
pub fn payload_has_label(payload: &str, label: &str) -> bool {
    payload
        .strip_prefix("v1|")
        .and_then(|rest| rest.strip_prefix(label))
        .is_some_and(|rest| rest.starts_with('|'))
}

/// The payload and nonce a delivered block carries, if it is well formed: lengths in range, a
/// canonical payload, zeros after the nonce. Anything else is a fraud at dispute.
pub fn open_block(block: &[u8]) -> Option<(String, Vec<u8>)> {
    if block.len() != BLOCK_LEN {
        return None;
    }
    let plen = u16::from_le_bytes([block[0], block[1]]) as usize;
    let payload = block.get(2..2 + plen)?;
    let nlen = *block.get(2 + plen)? as usize;
    let nonce = block.get(3 + plen..3 + plen + nlen)?;
    let tail = &block[3 + plen + nlen..];
    let payload = core::str::from_utf8(payload).ok()?;
    let ok = plen <= MAX_PAYLOAD_LEN
        && payload_is_canonical(payload)
        && (MIN_NONCE_LEN..=MAX_NONCE_LEN).contains(&nlen)
        && tail.iter().all(|&b| b == 0);
    ok.then(|| (payload.to_string(), nonce.to_vec()))
}

/// Blake2b-256 of a ciphertext: what the state keeps of a delivery.
pub fn ciphertext_hash(ciphertext: &[u8]) -> Hash32 {
    Hash32::from_array(Blake2b256::digest(ciphertext).into())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 0x0f) as usize] as char);
    }
    out
}

fn len_prefix(data: &[u8]) -> [u8; 8] {
    (data.len() as u64).to_le_bytes()
}

fn to_array64(hash: &Hash64) -> [u8; 64] {
    let mut out = [0u8; 64];
    out.copy_from_slice(hash.as_ref());
    out
}

/// The context bound into every proof and keystream: this desk, the call and (after `buy`) the sale.
fn context(desk: &ComponentAddress, seq: u64, sale: Option<u64>) -> Vec<u8> {
    let mut out = desk.as_bytes().to_vec();
    out.extend_from_slice(&seq.to_le_bytes());
    if let Some(sale) = sale {
        out.extend_from_slice(&sale.to_le_bytes());
    }
    out
}

/// Rejects anything that is not the canonical encoding of a non-identity Ristretto point. Every other
/// Ristretto intrinsic panics on non-canonical input, and the identity as a key or nonce would make
/// the shared secret public.
fn assert_valid_point(point: &RistrettoPublicKeyBytes, what: &str) {
    assert!(intrinsics::ristretto_is_canonical(point), "{} is not a canonical Ristretto point", what);
    assert!(!intrinsics::ristretto_is_identity(point), "{} must not be the identity point", what);
}

/// Fiat-Shamir challenge over the domain, the context, an action message and the points.
fn challenge(domain: &[u8], context: &[u8], message: &[u8], points: &[&RistrettoPublicKeyBytes]) -> Scalar32Bytes {
    let dlen = len_prefix(domain);
    let clen = len_prefix(context);
    let mlen = len_prefix(message);
    let mut parts: Vec<&[u8]> = vec![&dlen, domain, &clen, context, &mlen, message];
    parts.extend(points.iter().map(|p| p.as_bytes()));
    intrinsics::scalar_from_uniform_bytes(&to_array64(&intrinsics::hash_sha512_parts(&parts)))
}

/// `z·base - c·point`, the nonce commitment a compact Schnorr proof implies.
fn implied_nonce(base: Option<&RistrettoPublicKeyBytes>, point: &RistrettoPublicKeyBytes, c: &Scalar32Bytes, z: &Scalar32Bytes) -> RistrettoPublicKeyBytes {
    let zb = match base {
        Some(base) => intrinsics::ristretto_mul(base, z),
        None => intrinsics::ristretto_mul_base(z),
    };
    intrinsics::ristretto_sub(&zb, &intrinsics::ristretto_mul(point, c))
}

fn assert_canonical_scalars(c: &Scalar32Bytes, z: &Scalar32Bytes) {
    assert!(intrinsics::scalar_is_canonical(c) && intrinsics::scalar_is_canonical(z), "proof scalars must be canonical");
}

/// Schnorr proof of knowledge of `log_G(key)`, over `message`, bound to `context`.
fn assert_knows(context: &[u8], key: &RistrettoPublicKeyBytes, message: &[u8], c: &Scalar32Bytes, z: &Scalar32Bytes, who: &str) {
    assert_canonical_scalars(c, z);
    let a = implied_nonce(None, key, c, z);
    assert!(challenge(DOMAIN_AUTH, context, message, &[key, &a]) == *c, "invalid {} proof", who);
}

/// Chaum-Pedersen proof that `log_G(key) = log_ephemeral(shared)`, bound to `context`.
fn verify_shared(context: &[u8], key: &RistrettoPublicKeyBytes, ephemeral: &RistrettoPublicKeyBytes, shared: &RistrettoPublicKeyBytes, c: &Scalar32Bytes, z: &Scalar32Bytes) -> bool {
    assert_canonical_scalars(c, z);
    let a1 = implied_nonce(None, key, c, z);
    let a2 = implied_nonce(Some(ephemeral), shared, c, z);
    challenge(DOMAIN_DLEQ, context, &[], &[key, ephemeral, shared, &a1, &a2]) == *c
}

fn keystream(context: &[u8], key: &RistrettoPublicKeyBytes, ephemeral: &RistrettoPublicKeyBytes, shared: &RistrettoPublicKeyBytes) -> Vec<u8> {
    let k = intrinsics::hash_sha512_parts(&[
        &len_prefix(DOMAIN_KEY),
        DOMAIN_KEY,
        &len_prefix(context),
        context,
        key.as_bytes(),
        ephemeral.as_bytes(),
        shared.as_bytes(),
    ]);
    let mut stream = Vec::with_capacity(BLOCK_LEN);
    for i in 0..(BLOCK_LEN / 64) as u8 {
        let block = intrinsics::hash_sha512_parts(&[&len_prefix(DOMAIN_STREAM), DOMAIN_STREAM, k.as_ref(), &[i]]);
        stream.extend_from_slice(block.as_ref());
    }
    stream
}

/// Data carried by a badge: which sale of which call of the desk it pays for, and when it was bought.
#[derive(Debug, Clone, minicbor::Encode, minicbor::Decode, minicbor::CborLen)]
pub struct BadgeData {
    #[n(0)]
    pub seq: u64,
    #[n(1)]
    pub commitment: [u8; 32],
    #[n(2)]
    pub bought_at_epoch: u64,
    #[n(3)]
    pub sale: u64,
}

/// The sales of a call are packed records in one byte string, `SALE_LEN` bytes each:
/// `buyer key (32) || ephemeral key R (32) || ciphertext hash (32) || status (1)`, R and the hash all
/// zeros until delivery (the identity point is never a valid R). One allocation per call: as separate
/// structs, the engine's 2 MiB of WASM memory ran out near 1 200 sales while decoding the state.
pub const SALE_LEN: usize = 97;
/// Paid, waiting for delivery.
pub const PAID: u8 = 0;
/// Delivered; may still be disputed until the end of the reveal window.
pub const DELIVERED: u8 = 1;
/// Disputed, and the template found the delivery matched the sealed call.
pub const UPHELD: u8 = 2;
/// Disputed, and the delivery did not match the sealed call (or was unreadable). Refundable.
pub const FRAUD: u8 = 3;
/// The buyer burnt the badge and got the price back.
pub const REFUNDED: u8 = 4;

fn status_name(status: u8) -> &'static str {
    match status {
        PAID => "Paid",
        DELIVERED => "Delivered",
        UPHELD => "Upheld",
        FRAUD => "Fraud",
        REFUNDED => "Refunded",
        _ => "Unknown",
    }
}

fn sale_count(sales: &[u8]) -> u64 {
    (sales.len() / SALE_LEN) as u64
}

/// Index of record `sale` in `sales`, checked.
fn sale_offset(sales: &[u8], sale: u64) -> usize {
    assert!(sale < sale_count(sales), "no sale #{} for this call", sale);
    sale as usize * SALE_LEN
}

fn key_at(sales: &[u8], at: usize) -> RistrettoPublicKeyBytes {
    RistrettoPublicKeyBytes::try_from(&sales[at..at + 32]).expect("32 bytes")
}

fn status_at(sales: &[u8], sale: u64) -> u8 {
    sales[sale_offset(sales, sale) + 96]
}

fn set_status(sales: &mut [u8], sale: u64, status: u8) {
    let at = sale_offset(sales, sale);
    sales[at + 96] = status;
}

#[template]
mod signal_desk {
    use super::*;

    pub struct SignalDesk {
        /// Key that signed `open_desk`: the only key allowed to seal and deliver.
        publisher: RistrettoPublicKeyBytes,
        /// Where proceeds always go. Fixed for the life of the desk: a method to change it would rest
        /// on the signer's key, and whoever could call it could redirect the proceeds and then withdraw.
        payout: ComponentAddress,
        /// Epoch the desk was opened. Public, so a track record's age cannot be faked.
        opened_at_epoch: u64,
        /// The registry. Index = sequence number.
        calls: Vec<Call>,
        /// Sales over all calls, bounded by `MAX_SALES`.
        sales_count: u64,
        /// Escrow for every sale, in TARI.
        earnings: Vault,
        /// Proceeds of settled sales not yet paid out. The rest of `earnings` backs refunds.
        withdrawable: Amount,
    }

    impl SignalDesk {
        /// Opens a desk owned by the transaction signer, paying out into `payout` (their account).
        pub fn open_desk(payout: ComponentAddress) -> Component<Self> {
            let publisher = CallerContext::transaction_signer_public_key();
            let opened_at_epoch = Consensus::current_epoch();
            let desk = Component::new(Self {
                publisher,
                payout,
                opened_at_epoch,
                calls: Vec::new(),
                sales_count: 0,
                earnings: Vault::new_empty(TARI_TOKEN),
                withdrawable: Amount::zero(),
            })
            // No owner: an owner passes every method rule and could replace the component's
            // template, rewriting sealed calls after the fact.
            .with_owner_rule(OwnerRule::None)
            .with_access_rules(
                ComponentAccessRules::new()
                    // Never add a `Proof` parameter to `seal` or `deliver`: the key rule holds only
                    // because no caller can hand the publisher's authority to them as an argument.
                    .method("seal", rule!(public_key(publisher)))
                    .method("deliver", rule!(public_key(publisher)))
                    // Open to anyone: each one checks its own conditions, and money only ever moves
                    // to the payout account or out of a badge its holder burnt.
                    .method("buy", rule!(allow_all))
                    .method("dispute", rule!(allow_all))
                    .method("reveal", rule!(allow_all))
                    .method("settle", rule!(allow_all))
                    .method("refund", rule!(allow_all))
                    .method("withdraw", rule!(allow_all))
                    .method("publisher", rule!(allow_all))
                    .method("payout", rule!(allow_all))
                    .method("opened_at_epoch", rule!(allow_all))
                    .method("call_count", rule!(allow_all))
                    .method("stats", rule!(allow_all))
                    .method("withdrawable", rule!(allow_all))
                    .method("earnings_balance", rule!(allow_all))
                    .method("commitment", rule!(allow_all))
                    .method("sealed_at_epoch", rule!(allow_all))
                    .method("reveal_at_epoch", rule!(allow_all))
                    .method("label", rule!(allow_all))
                    .method("price", rule!(allow_all))
                    .method("sold", rule!(allow_all))
                    .method("refunded", rule!(allow_all))
                    .method("revealed_at_epoch", rule!(allow_all))
                    .method("badge_resource", rule!(allow_all))
                    .method("sale_status", rule!(allow_all))
                    .method("tlock", rule!(allow_all))
                    .default(rule!(deny_all)),
            )
            .create();
            // Emitted once the desk exists, with its address: a client finds a caller's desk from this
            // event alone, on any device, without the transaction that opened it.
            emit_event("desk_opened", metadata! {
                "desk" => desk.address().to_string(),
                "publisher" => publisher.to_string(),
                "payout" => payout.to_string(),
                "epoch" => opened_at_epoch.to_string(),
            });
            desk
        }

        /// Seals a call as number `expected_seq` and returns it. Publisher only.
        ///
        /// `commitment` must be `commitment_of(desk, publisher key, expected_seq, payload, nonce)`.
        /// Passing the number makes a race fail loudly: if another seal took that number first, this
        /// one is refused instead of landing under a number its commitment can never open.
        ///
        /// `label` is public from the seal on, so buyers know what the call is about; the reveal only
        /// opens a payload about that same label, so the label cannot lie.
        ///
        /// `tlock` (may be empty) is the time-locked copy of the call that lets anyone reveal it once its
        /// drand round is out. The template cannot read it: it is kept as is and dropped at the reveal.
        pub fn seal(&mut self, expected_seq: u64, commitment: Hash32, reveal_at_epoch: u64, price: Amount, label: String, tlock: Bytes) -> u64 {
            let now = Consensus::current_epoch();
            let seq = self.calls.len() as u64;
            assert!(seq == expected_seq, "next call number is {}, not {}", seq, expected_seq);
            assert!(seq < MAX_CALLS, "this desk has reached {} calls", MAX_CALLS);
            assert!(reveal_at_epoch > now, "reveal_at_epoch {} must be in the future (current epoch {})", reveal_at_epoch, now);
            assert!(
                reveal_at_epoch - now <= MAX_REVEAL_HORIZON_EPOCHS,
                "reveal_at_epoch {} is more than {} epochs away",
                reveal_at_epoch,
                MAX_REVEAL_HORIZON_EPOCHS
            );
            assert!(price.is_positive(), "price must be positive");
            assert!(label_is_valid(&label), "label must be 2 to {} printable characters in non-empty fields", MAX_LABEL_LEN);
            assert!(tlock.len() <= MAX_TLOCK_LEN, "tlock longer than {} bytes", MAX_TLOCK_LEN);

            // Only code running inside this desk may mint or burn the call's badges. No owner, and
            // every rule locked: an owner bypasses mint rules. Badge data is immutable.
            let desk = CallerContext::current_component_address();
            let badges = ResourceBuilder::non_fungible()
                .with_owner_rule(OwnerRule::None)
                .with_token_symbol("SDSK")
                .add_metadata("name", "Signal Desk access badge")
                .mintable(rule!(component(desk)), LOCKED)
                .burnable(rule!(component(desk)), LOCKED)
                .update_non_fungible_data(rule!(deny_all), LOCKED)
                .build();

            emit_event("call_sealed", metadata! {
                "desk" => desk.to_string(),
                "seq" => seq.to_string(),
                "commitment" => commitment.to_string(),
                "reveal_at_epoch" => reveal_at_epoch.to_string(),
                "price" => price.to_string(),
                "label" => label.clone(),
            });

            self.calls.push(Call {
                commitment,
                label,
                sealed_at_epoch: now,
                reveal_at_epoch,
                price,
                badges: badges.into(),
                sales: Bytes::from_vec(Vec::new()),
                refunded: 0,
                frauds: 0,
                settled: false,
                revealed_at_epoch: None,
                tlock,
            });
            seq
        }

        /// Buys one sale of call `seq` for `buyer_key` (`(c, z)`: a proof by that key over `"buy"`,
        /// bound to this desk and call). Returns the badge and the change (`None` on an exact payment).
        /// Selling stops at the reveal epoch.
        pub fn buy(&mut self, seq: u64, buyer_key: RistrettoPublicKeyBytes, c: Scalar32Bytes, z: Scalar32Bytes, mut payment: Bucket) -> (Bucket, Option<Bucket>) {
            let now = Consensus::current_epoch();
            let desk = CallerContext::current_component_address();
            let i = self.index(seq);
            assert!(self.sales_count < MAX_SALES, "this desk has reached {} sales", MAX_SALES);
            assert_valid_point(&buyer_key, "buyer key");
            assert_knows(&context(&desk, seq, None), &buyer_key, MSG_BUY, &c, &z, "buyer key");
            let call = &mut self.calls[i];
            assert!(call.revealed_at_epoch.is_none(), "call already revealed; nothing left to sell");
            assert!(now < call.reveal_at_epoch, "sale closed: the reveal epoch has been reached");
            assert!(payment.resource_address() == TARI_TOKEN, "payment must be in TARI");
            // Hidden commitments would be deposited uncounted: pay the price as a revealed amount.
            payment.assert_contains_no_confidential_funds();

            let paid = payment.amount();
            let price = call.price;
            assert!(paid >= price, "paid {} but the price is {}", paid, price);
            let change = (paid > price).then(|| payment.take(paid - price));

            let sale = sale_count(&call.sales);
            let badge = call.badges.mint_non_fungible(
                NonFungibleId::random(),
                &BadgeData { seq, commitment: call.commitment.into_array(), bought_at_epoch: now, sale },
                &(),
            );
            let mut sales = core::mem::replace(&mut call.sales, Bytes::from_vec(Vec::new())).into_vec();
            sales.extend_from_slice(buyer_key.as_bytes());
            sales.extend_from_slice(&[0u8; 64]);
            sales.push(PAID);
            call.sales = Bytes::from_vec(sales);
            self.sales_count += 1;
            self.earnings.deposit(payment);
            emit_event("call_bought", metadata! {
                "desk" => desk.to_string(),
                "seq" => seq.to_string(),
                "sale" => sale.to_string(),
                "buyer_key" => buyer_key.to_string(),
            });
            (badge, change)
        }

        /// Delivers call `seq` to the buyer of `sale`, before the reveal epoch. Publisher only.
        /// `(rc, rz)` proves knowledge of `r` for `ephemeral = r·G`, bound to this sale: a delivery
        /// cannot reuse another sale's `R` and turn a dispute into a decryption of that other sale.
        pub fn deliver(&mut self, seq: u64, sale: u64, ephemeral: RistrettoPublicKeyBytes, rc: Scalar32Bytes, rz: Scalar32Bytes, ciphertext: Bytes) {
            let now = Consensus::current_epoch();
            let desk = CallerContext::current_component_address();
            let i = self.index(seq);
            let call = &mut self.calls[i];
            assert!(call.revealed_at_epoch.is_none() && now < call.reveal_at_epoch, "too late to deliver: the reveal epoch has been reached");
            assert!(status_at(&call.sales, sale) == PAID, "sale #{} is not awaiting delivery", sale);
            assert_valid_point(&ephemeral, "ephemeral key");
            assert!(ciphertext.len() == BLOCK_LEN, "ciphertext must be exactly {} bytes", BLOCK_LEN);
            assert_knows(&context(&desk, seq, Some(sale)), &ephemeral, MSG_EPHEMERAL, &rc, &rz, "ephemeral key");

            let at = sale_offset(&call.sales, sale);
            call.sales[at + 32..at + 64].copy_from_slice(ephemeral.as_bytes());
            call.sales[at + 64..at + 96].copy_from_slice(&ciphertext_hash(&ciphertext).into_array());
            call.sales[at + 96] = DELIVERED;
            emit_event("call_delivered", metadata! {
                "desk" => desk.to_string(),
                "seq" => seq.to_string(),
                "sale" => sale.to_string(),
                "ephemeral" => hex(ephemeral.as_bytes()),
                "ciphertext" => hex(&ciphertext),
            });
        }

        /// Disputes the delivery of `sale`: publishes `shared = b·R` with a DLEQ proof (only the holder
        /// of the buyer key can make it) and the ciphertext from the delivery event. The template
        /// decrypts and judges. Allowed until the end of the reveal window. Anyone may submit it; the
        /// verdict only changes the sale's status, and money only leaves through the badge.
        pub fn dispute(&mut self, seq: u64, sale: u64, shared: RistrettoPublicKeyBytes, c: Scalar32Bytes, z: Scalar32Bytes, ciphertext: Bytes) {
            let now = Consensus::current_epoch();
            let desk = CallerContext::current_component_address();
            let publisher = self.publisher;
            let i = self.index(seq);
            let call = &mut self.calls[i];
            assert!(now < call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS), "dispute window closed");
            assert!(status_at(&call.sales, sale) == DELIVERED, "sale #{} has no delivery to dispute", sale);
            let at = sale_offset(&call.sales, sale);
            let buyer_key = key_at(&call.sales, at);
            let ephemeral = key_at(&call.sales, at + 32);
            assert!(call.sales[at + 64..at + 96] == ciphertext_hash(&ciphertext).into_array(), "not the ciphertext of this delivery");
            assert_valid_point(&shared, "shared point");
            let ctx = context(&desk, seq, Some(sale));
            assert!(verify_shared(&ctx, &buyer_key, &ephemeral, &shared, &c, &z), "invalid proof that the shared point is the buyer's");

            let stream = keystream(&ctx, &buyer_key, &ephemeral, &shared);
            let block: Vec<u8> = ciphertext.iter().zip(stream.iter()).map(|(c, k)| c ^ k).collect();
            // The caller wins only by delivering exactly the sealed call, in a form the client reads.
            let honest = open_block(&block)
                .map(|(payload, nonce)| commitment_of(&desk.to_string(), publisher.as_bytes(), seq, &payload, &nonce) == call.commitment)
                .unwrap_or(false);
            if honest {
                set_status(&mut call.sales, sale, UPHELD);
            } else {
                set_status(&mut call.sales, sale, FRAUD);
                call.frauds += 1;
            }
            emit_event("call_disputed", metadata! {
                "desk" => desk.to_string(),
                "seq" => seq.to_string(),
                "sale" => sale.to_string(),
                "verdict" => (if honest { "upheld" } else { "fraud" }).to_string(),
                "shared" => hex(shared.as_bytes()),
            });
        }

        /// Opens call `seq` and publishes it in the `call_revealed` event. Callable by anyone during
        /// the reveal window, so a caller who goes quiet cannot bury a losing call if a buyer holds
        /// the payload and nonce.
        pub fn reveal(&mut self, seq: u64, payload: String, nonce: Bytes) {
            let now = Consensus::current_epoch();
            let i = self.index(seq);
            let publisher = self.publisher;
            let desk = CallerContext::current_component_address().to_string();
            let call = &mut self.calls[i];
            assert!(now >= call.reveal_at_epoch, "too early: reveal opens at epoch {} (current {})", call.reveal_at_epoch, now);
            let refund_from = call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS);
            assert!(now < refund_from, "reveal window closed at epoch {}; the call is refunding", refund_from);
            assert!(call.revealed_at_epoch.is_none(), "already revealed");
            assert!(payload.len() <= MAX_PAYLOAD_LEN, "payload longer than {} bytes", MAX_PAYLOAD_LEN);
            assert!(payload_is_canonical(&payload), "payload must be printable ASCII");
            assert!((MIN_NONCE_LEN..=MAX_NONCE_LEN).contains(&nonce.len()), "nonce must be {} to {} bytes", MIN_NONCE_LEN, MAX_NONCE_LEN);
            assert!(
                commitment_of(&desk, publisher.as_bytes(), seq, &payload, &nonce) == call.commitment,
                "payload and nonce do not open this commitment"
            );
            assert!(payload_has_label(&payload, &call.label), "payload is not about the public label {}", call.label);

            call.revealed_at_epoch = Some(now);
            // The payload is public from here on: the time-locked copy only costs state.
            call.tlock = Bytes::from_vec(Vec::new());
            emit_event("call_revealed", metadata! {
                "desk" => desk,
                "seq" => seq.to_string(),
                "epoch" => now.to_string(),
                "sold" => sale_count(&call.sales).to_string(),
                "payload" => payload,
                "nonce" => hex(&nonce),
            });
        }

        /// Once the reveal window of an opened call is over (no dispute can come any more), makes the
        /// price of every delivered sale that was not a fraud payable. Anyone may trigger it, once.
        pub fn settle(&mut self, seq: u64) {
            let now = Consensus::current_epoch();
            let i = self.index(seq);
            let call = &mut self.calls[i];
            assert!(call.revealed_at_epoch.is_some(), "call never opened: its sales refund");
            assert!(now >= call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS), "disputes are open until epoch {}", call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS));
            assert!(!call.settled, "already settled");
            let earned = call.sales.chunks(SALE_LEN).filter(|s| matches!(s[96], DELIVERED | UPHELD)).count() as u64;
            let proceeds = call.price.checked_mul(Amount::from_u64(earned)).expect("proceeds overflow");
            call.settled = true;
            self.withdrawable = self.withdrawable.checked_add(proceeds).expect("withdrawable overflows");
        }

        /// Refunds the sales of call `seq` whose badges are in `badges`: a sale never delivered once the
        /// reveal epoch is reached, a sale judged a fraud, or any sale of a call never opened once its
        /// reveal window has closed.
        pub fn refund(&mut self, seq: u64, badges: Bucket) -> Bucket {
            let now = Consensus::current_epoch();
            let i = self.index(seq);
            let call = &mut self.calls[i];
            assert!(badges.resource_address() == call.badges.resource_address(), "not a badge of this call");
            let nfts = badges.get_non_fungibles();
            assert!(!nfts.is_empty(), "no badge to refund");
            let never_opened = call.revealed_at_epoch.is_none() && now >= call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS);
            for nft in &nfts {
                let data: BadgeData = nft.get_data();
                assert!(data.seq == seq, "badge of another call");
                let due = match status_at(&call.sales, data.sale) {
                    FRAUD => true,
                    PAID => now >= call.reveal_at_epoch,
                    DELIVERED | UPHELD => never_opened,
                    _ => false,
                };
                assert!(due, "sale #{} has nothing to refund", data.sale);
                set_status(&mut call.sales, data.sale, REFUNDED);
            }
            let count = nfts.len() as u64;
            let due = call.price.checked_mul(Amount::from_u64(count)).expect("refund amount overflows");
            badges.burn();
            call.refunded += count;
            self.earnings.withdraw(due)
        }

        /// Pays `amount` of the settled proceeds into the payout account. Anyone may trigger it: the
        /// money can only go to the publisher's payout account.
        pub fn withdraw(&mut self, amount: Amount) {
            assert!(amount.is_positive(), "amount must be positive");
            assert!(amount <= self.withdrawable, "only settled proceeds can be withdrawn ({} available)", self.withdrawable);
            // State first, then the outside call.
            self.withdrawable = self.withdrawable.checked_sub(amount).expect("withdrawable underflows");
            let bucket = self.earnings.withdraw(amount);
            ComponentManager::get(self.payout).invoke("deposit", args![bucket]);
        }

        // ---- desk ---------------------------------------------------------------------------

        pub fn publisher(&self) -> RistrettoPublicKeyBytes {
            self.publisher
        }

        pub fn payout(&self) -> ComponentAddress {
            self.payout
        }

        pub fn opened_at_epoch(&self) -> u64 {
            self.opened_at_epoch
        }

        pub fn call_count(&self) -> u64 {
            self.calls.len() as u64
        }

        /// `(sealed, opened, never opened, judged fraudulent)`. Never opened counts calls whose reveal
        /// window closed without a reveal; fraudulent counts calls with at least one fraud verdict.
        pub fn stats(&self) -> (u64, u64, u64, u64) {
            let now = Consensus::current_epoch();
            let opened = self.calls.iter().filter(|c| c.revealed_at_epoch.is_some()).count() as u64;
            let lost = self
                .calls
                .iter()
                .filter(|c| c.revealed_at_epoch.is_none() && now >= c.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS))
                .count() as u64;
            let frauds = self.calls.iter().filter(|c| c.frauds > 0).count() as u64;
            (self.calls.len() as u64, opened, lost, frauds)
        }

        pub fn withdrawable(&self) -> Amount {
            self.withdrawable
        }

        pub fn earnings_balance(&self) -> Amount {
            self.earnings.balance()
        }

        // ---- one call -------------------------------------------------------------------------

        pub fn commitment(&self, seq: u64) -> Hash32 {
            self.calls[self.index(seq)].commitment
        }

        pub fn sealed_at_epoch(&self, seq: u64) -> u64 {
            self.calls[self.index(seq)].sealed_at_epoch
        }

        pub fn reveal_at_epoch(&self, seq: u64) -> u64 {
            self.calls[self.index(seq)].reveal_at_epoch
        }

        /// What call `seq` is about, public from the seal on.
        pub fn label(&self, seq: u64) -> String {
            self.calls[self.index(seq)].label.clone()
        }

        pub fn price(&self, seq: u64) -> Amount {
            self.calls[self.index(seq)].price
        }

        pub fn sold(&self, seq: u64) -> u64 {
            sale_count(&self.calls[self.index(seq)].sales)
        }

        pub fn refunded(&self, seq: u64) -> u64 {
            self.calls[self.index(seq)].refunded
        }

        pub fn revealed_at_epoch(&self, seq: u64) -> Option<u64> {
            self.calls[self.index(seq)].revealed_at_epoch
        }

        pub fn badge_resource(&self, seq: u64) -> ResourceAddress {
            self.calls[self.index(seq)].badges.resource_address()
        }

        /// `"Paid"`, `"Delivered"`, `"Upheld"`, `"Fraud"` or `"Refunded"`.
        pub fn sale_status(&self, seq: u64, sale: u64) -> String {
            status_name(status_at(&self.calls[self.index(seq)].sales, sale)).to_string()
        }

        /// Time-locked copy of call `seq` (empty once revealed, or if none was sealed).
        pub fn tlock(&self, seq: u64) -> Bytes {
            self.calls[self.index(seq)].tlock.clone()
        }

        fn index(&self, seq: u64) -> usize {
            assert!(seq < self.calls.len() as u64, "no call #{} in this desk", seq);
            seq as usize
        }

    }

    /// One sealed call. Entries are appended to the registry and never removed. Declared after the
    /// component: the `#[template]` macro takes the first struct of the module as the component.
    pub struct Call {
        pub commitment: Hash32,
        /// Public label checked at the reveal (see `seal`).
        pub label: String,
        pub sealed_at_epoch: u64,
        pub reveal_at_epoch: u64,
        pub price: Amount,
        /// One badge resource per call, mintable and burnable only by the desk.
        pub badges: ResourceManager,
        /// Packed sale records, `SALE_LEN` bytes each (see `SALE_LEN`).
        pub sales: Bytes,
        pub refunded: u64,
        pub frauds: u64,
        pub settled: bool,
        pub revealed_at_epoch: Option<u64>,
        /// Time-locked copy of payload and nonce (see `seal`), emptied at the reveal.
        pub tlock: Bytes,
    }
}

#[cfg(test)]
mod tests {
    //! The commitment scheme and the delivered block, natively: if two different payloads could open
    //! one commitment, or a block could read two ways, the track-record claim would collapse.

    use super::{commitment_of, hex, label_is_valid, open_block, payload_has_label, payload_is_canonical, BLOCK_LEN};

    const KEY: &[u8] = &[7u8; 32];
    const DESK: &str = "component_aa";

    fn block(payload: &[u8], nonce: &[u8]) -> Vec<u8> {
        let mut b = (payload.len() as u16).to_le_bytes().to_vec();
        b.extend_from_slice(payload);
        b.push(nonce.len() as u8);
        b.extend_from_slice(nonce);
        b.resize(BLOCK_LEN, 0);
        b
    }

    #[test]
    fn the_commitment_is_deterministic() {
        assert_eq!(commitment_of(DESK, KEY, 0, "BTCUSDT long", b"n"), commitment_of(DESK, KEY, 0, "BTCUSDT long", b"n"));
    }

    /// Fixed vector shared with the web client (maquettes/chain.js `commitmentOf`): if either side
    /// changes the scheme, this test or the client's own check fails.
    #[test]
    fn the_commitment_matches_the_web_client() {
        let c = commitment_of(DESK, KEY, 3, "v1|BTCUSDT|LONG|62000|65000|60500|2026-11-20T00:00Z", &[9u8; 32]);
        assert_eq!(hex(&c.into_array()), "f0e46bdaecd2b4b0a4615f5aaf8dc3c41a6c4ec570bc939d665170e5badd65cb");
    }

    #[test]
    fn every_bound_part_changes_the_commitment() {
        let base = commitment_of(DESK, KEY, 0, "BTCUSDT long", b"nonce-1");
        assert_ne!(base, commitment_of(DESK, KEY, 0, "BTCUSDT short", b"nonce-1"));
        assert_ne!(base, commitment_of(DESK, KEY, 0, "BTCUSDT long", b"nonce-2"));
        assert_ne!(base, commitment_of(DESK, &[8u8; 32], 0, "BTCUSDT long", b"nonce-1"));
        assert_ne!(base, commitment_of(DESK, KEY, 1, "BTCUSDT long", b"nonce-1"), "another number");
        assert_ne!(base, commitment_of("component_bb", KEY, 0, "BTCUSDT long", b"nonce-1"), "another desk");
    }

    #[test]
    fn shifting_bytes_between_parts_does_not_collide() {
        assert_ne!(commitment_of(DESK, KEY, 0, "ab", b"c"), commitment_of(DESK, KEY, 0, "a", b"bc"));
    }

    #[test]
    fn only_printable_ascii_is_canonical() {
        assert!(payload_is_canonical("v1|BTCUSDT|LONG|62000|65000|60500|2026-11-20T00:00Z"));
        for bad in ["BTC \u{202E}trohs", "BTC long\nshort", "BTC long\u{2028}short", "BTC\u{061C}", "BTC\u{00AD}", "BTC\u{FE0F}", "BTC\u{200B}", "é"] {
            assert!(!payload_is_canonical(bad), "{bad:?} must be refused");
        }
    }

    #[test]
    fn a_well_formed_block_opens_and_nothing_else_does() {
        let nonce = [5u8; 32];
        assert_eq!(open_block(&block(b"v1|BTCUSDT|LONG", &nonce)), Some(("v1|BTCUSDT|LONG".to_string(), nonce.to_vec())));
        let mut trailing = block(b"v1|BTCUSDT|LONG", &nonce);
        trailing[BLOCK_LEN - 1] = 1;
        assert_eq!(open_block(&trailing), None, "bytes after the nonce");
        assert_eq!(open_block(&block(b"v1|BTC\nLONG", &nonce)), None, "non-canonical payload");
        assert_eq!(open_block(&block(b"v1", &[5u8; 8])), None, "short nonce");
        let mut long = vec![0u8; BLOCK_LEN];
        long[0..2].copy_from_slice(&(BLOCK_LEN as u16).to_le_bytes());
        assert_eq!(open_block(&long), None, "length past the block");
        assert_eq!(open_block(&block(b"x", &nonce)[..BLOCK_LEN - 1]), None, "short block");
    }

    #[test]
    fn the_public_label_must_prefix_the_payload() {
        assert!(payload_has_label("v1|BTCUSDT|LONG|62000", "BTCUSDT"));
        assert!(payload_has_label("v1|NFL|KC@BUF|2026-11-22T18:25Z|WIN|KC", "NFL|KC@BUF|2026-11-22T18:25Z"));
        assert!(!payload_has_label("v1|BTCUSDTX|LONG", "BTCUSDT"), "a label stops at a field boundary");
        assert!(!payload_has_label("v1|BTCUSDT", "BTCUSDT"), "nothing after the label");
        assert!(!payload_has_label("v2|BTCUSDT|LONG", "BTCUSDT"), "unknown version");
        assert!(label_is_valid("BTCUSDT") && label_is_valid("NBA|LAL@BOS|2026-11-23T00:30Z"));
        assert!(!label_is_valid("B") && !label_is_valid("NFL||X") && !label_is_valid("NFL|") && !label_is_valid("BTC\nUSDT"));
        assert!(!label_is_valid(&"A".repeat(65)));
    }

    #[test]
    fn hex_encodes_bytes() {
        assert_eq!(hex(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
    }
}
