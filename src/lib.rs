// Copyright 2026 Soufian J (OG Boy)
// SPDX-License-Identifier: BSD-3-Clause

//! # Signal Desk
//!
//! Verifiable crypto calls on the Tari Ootle. A caller opens one **desk**. Every call they seal goes
//! into the desk's registry under the next sequence number, and nothing ever removes it.
//!
//! A call is only `commitment_of(publisher, seq, payload, nonce)` while it is for sale: the payload
//! never touches the chain before its reveal epoch. Buyers pay into the desk's escrow and receive a
//! badge for that call. From the reveal epoch, anyone holding the payload and nonce can open it, and
//! the template checks it against the commitment. A call nobody opens within the reveal window
//! counts as lost and every badge holder can burn their badge for a refund.
//!
//! What the registry buys over isolated vaults:
//!
//! * **no cherry-picking**: a caller cannot seal ten calls and show three. Every sealed call has a
//!   number, and [`SignalDesk::stats`] counts the ones never opened;
//! * **an age**: the epoch the desk was opened is recorded, so a fresh desk cannot pose as an old
//!   track record;
//! * **proceeds follow results**: the caller is paid for a call only once it is open; until then the
//!   money backs the refunds.
//!
//! Payment is in TARI only: the engine lets a resource's issuer recall or freeze it in any vault, so a
//! coin the caller issued would let them take the escrow back.

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
use tari_template_lib::prelude::*;
use tari_template_lib::types::Hash32;

/// Domain separator for the commitment hash.
const DOMAIN: &[u8] = b"tari.ootle.signal_desk.commitment.v1";

type Blake2b256 = Blake2b<U32>;

/// Epochs after `reveal_at_epoch` during which a call can still be opened. After that it refunds.
pub const REVEAL_WINDOW_EPOCHS: u64 = 10;
/// Furthest reveal epoch a call may be sealed with, counted from the current epoch.
pub const MAX_REVEAL_HORIZON_EPOCHS: u64 = 10_000;
/// A short nonce would let anyone brute-force a guessable payload from the public commitment.
pub const MIN_NONCE_LEN: usize = 16;
pub const MAX_NONCE_LEN: usize = 64;
pub const MAX_PAYLOAD_LEN: usize = 1024;
/// Bounds the registry, so a desk's state cannot grow without limit.
pub const MAX_CALLS: u64 = 5_000;

/// The commitment a caller seals as call number `seq`, and the value `reveal` checks against.
///
/// Every part is length-prefixed, so bytes cannot be shifted between payload and nonce to open one
/// commitment two ways. The publisher's key binds it to one desk owner, and `seq` binds it to one
/// slot: a commitment copied into another desk, or re-sealed under another number, never opens.
///
/// Compute it off-chain: payload and nonce in a transaction would be public.
pub fn commitment_of(publisher: &[u8], seq: u64, payload: &str, nonce: &[u8]) -> Hash32 {
    let mut hasher = Blake2b256::new();
    let seq = seq.to_le_bytes();
    for part in [DOMAIN, publisher, seq.as_slice(), payload.as_bytes(), nonce] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    Hash32::from_array(hasher.finalize().into())
}

/// Whether a payload reads the way it hashes. Control characters, bidi overrides and zero-width
/// characters let a caller show one call and hold another.
pub fn payload_is_canonical(payload: &str) -> bool {
    !payload.chars().any(|c| {
        c.is_control() ||
            matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}')
    })
}

/// Data carried by a badge: which call of the desk it pays for, and when it was bought.
#[derive(Debug, Clone, minicbor::Encode, minicbor::Decode, minicbor::CborLen)]
pub struct BadgeData {
    #[n(0)]
    pub seq: u64,
    #[n(1)]
    pub commitment: [u8; 32],
    #[n(2)]
    pub bought_at_epoch: u64,
}

#[template]
mod signal_desk {
    use super::*;

    /// One sealed call. Entries are appended to the registry and never removed.
    pub struct Call {
        pub commitment: Hash32,
        pub sealed_at_epoch: u64,
        pub reveal_at_epoch: u64,
        pub price: Amount,
        /// One badge resource per call, mintable and burnable only by the desk.
        pub badges: ResourceManager,
        pub sold: u64,
        pub refunded: u64,
        pub payload: Option<String>,
        pub nonce: Option<Bytes>,
        pub revealed_at_epoch: Option<u64>,
    }

    pub struct SignalDesk {
        /// Key that signed `open_desk`: the only key allowed to seal and withdraw.
        publisher: RistrettoPublicKeyBytes,
        /// Epoch the desk was opened. Public, so a track record's age cannot be faked.
        opened_at_epoch: u64,
        /// The registry. Index = sequence number.
        calls: Vec<Call>,
        /// Escrow for every sale, in TARI.
        earnings: Vault,
        /// Proceeds of opened calls not yet withdrawn. The rest of `earnings` backs refunds.
        withdrawable: Amount,
    }

    impl SignalDesk {
        /// Opens a desk owned by the transaction signer.
        pub fn open_desk() -> Component<Self> {
            let publisher = CallerContext::transaction_signer_public_key();
            let opened_at_epoch = Consensus::current_epoch();
            emit_event("desk_opened", metadata! {
                "publisher" => publisher.to_string(),
                "epoch" => opened_at_epoch.to_string(),
            });
            Component::new(Self {
                publisher,
                opened_at_epoch,
                calls: Vec::new(),
                earnings: Vault::new_empty(TARI_TOKEN),
                withdrawable: Amount::zero(),
            })
            // No owner: an owner passes every method rule and could replace the component's
            // template, rewriting sealed calls after the fact.
            .with_owner_rule(OwnerRule::None)
            .with_access_rules(
                ComponentAccessRules::new()
                    .method("seal", rule!(public_key(publisher)))
                    .method("withdraw", rule!(public_key(publisher)))
                    .method("buy", rule!(allow_all))
                    .method("reveal", rule!(allow_all))
                    .method("refund", rule!(allow_all))
                    .method("publisher", rule!(allow_all))
                    .method("opened_at_epoch", rule!(allow_all))
                    .method("call_count", rule!(allow_all))
                    .method("stats", rule!(allow_all))
                    .method("withdrawable", rule!(allow_all))
                    .method("earnings_balance", rule!(allow_all))
                    .method("commitment", rule!(allow_all))
                    .method("sealed_at_epoch", rule!(allow_all))
                    .method("reveal_at_epoch", rule!(allow_all))
                    .method("price", rule!(allow_all))
                    .method("sold", rule!(allow_all))
                    .method("refunded", rule!(allow_all))
                    .method("payload", rule!(allow_all))
                    .method("nonce", rule!(allow_all))
                    .method("revealed_at_epoch", rule!(allow_all))
                    .method("badge_resource", rule!(allow_all))
                    .default(rule!(deny_all)),
            )
            .create()
        }

        /// Seals a call and returns its sequence number. Publisher only.
        ///
        /// `commitment` must be `commitment_of(publisher key, seq, payload, nonce)` with `seq` the
        /// number this call receives (`call_count()` before sealing).
        pub fn seal(&mut self, commitment: Hash32, reveal_at_epoch: u64, price: Amount) -> u64 {
            let now = Consensus::current_epoch();
            assert!(
                reveal_at_epoch > now,
                "reveal_at_epoch {} must be in the future (current epoch {})",
                reveal_at_epoch,
                now
            );
            assert!(
                reveal_at_epoch - now <= MAX_REVEAL_HORIZON_EPOCHS,
                "reveal_at_epoch {} is more than {} epochs away",
                reveal_at_epoch,
                MAX_REVEAL_HORIZON_EPOCHS
            );
            assert!(price.is_positive(), "price must be positive");
            let seq = self.calls.len() as u64;
            assert!(seq < MAX_CALLS, "this desk has reached {} calls", MAX_CALLS);

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
            });

            self.calls.push(Call {
                commitment,
                sealed_at_epoch: now,
                reveal_at_epoch,
                price,
                badges: badges.into(),
                sold: 0,
                refunded: 0,
                payload: None,
                nonce: None,
                revealed_at_epoch: None,
            });
            seq
        }

        /// Buys one badge for call `seq`. Returns the badge and the change (`None` on an exact
        /// payment). Selling stops at the reveal epoch.
        pub fn buy(&mut self, seq: u64, mut payment: Bucket) -> (Bucket, Option<Bucket>) {
            let now = Consensus::current_epoch();
            let i = self.index(seq);
            let call = &mut self.calls[i];
            assert!(call.payload.is_none(), "call already revealed; nothing left to sell");
            assert!(now < call.reveal_at_epoch, "sale closed: the reveal epoch has been reached");
            assert!(payment.resource_address() == TARI_TOKEN, "payment must be in TARI");
            // Hidden commitments would be deposited uncounted: pay the price as a revealed amount.
            payment.assert_contains_no_confidential_funds();

            let paid = payment.amount();
            let price = call.price;
            assert!(paid >= price, "paid {} but the price is {}", paid, price);
            let change = (paid > price).then(|| payment.take(paid - price));

            let badge = call.badges.mint_non_fungible(
                NonFungibleId::random(),
                &BadgeData {
                    seq,
                    commitment: call.commitment.into_array(),
                    bought_at_epoch: now,
                },
                &(),
            );
            call.sold += 1;
            self.earnings.deposit(payment);
            (badge, change)
        }

        /// Opens call `seq`. Callable by anyone during the reveal window, so a caller who goes quiet
        /// cannot bury a losing call if a buyer holds the payload and nonce.
        pub fn reveal(&mut self, seq: u64, payload: String, nonce: Bytes) {
            let now = Consensus::current_epoch();
            let i = self.index(seq);
            let publisher = self.publisher;
            let call = &mut self.calls[i];
            assert!(
                now >= call.reveal_at_epoch,
                "too early: reveal opens at epoch {} (current {})",
                call.reveal_at_epoch,
                now
            );
            let refund_from = call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS);
            assert!(now < refund_from, "reveal window closed at epoch {}; the call is refunding", refund_from);
            assert!(call.payload.is_none(), "already revealed");
            assert!(payload.len() <= MAX_PAYLOAD_LEN, "payload longer than {} bytes", MAX_PAYLOAD_LEN);
            assert!(payload_is_canonical(&payload), "payload contains control or bidi characters");
            assert!(
                (MIN_NONCE_LEN..=MAX_NONCE_LEN).contains(&nonce.len()),
                "nonce must be {} to {} bytes",
                MIN_NONCE_LEN,
                MAX_NONCE_LEN
            );
            assert!(
                commitment_of(publisher.as_bytes(), seq, &payload, &nonce) == call.commitment,
                "payload and nonce do not open this commitment"
            );

            let proceeds = call.price.checked_mul(Amount::from_u64(call.sold)).expect("proceeds overflow");
            call.payload = Some(payload);
            call.nonce = Some(nonce);
            call.revealed_at_epoch = Some(now);
            emit_event("call_revealed", metadata! {
                "seq" => seq.to_string(),
                "epoch" => now.to_string(),
                "sold" => call.sold.to_string(),
            });
            self.withdrawable = self.withdrawable.checked_add(proceeds).expect("withdrawable overflows");
        }

        /// Refunds badges of call `seq` once its reveal window has closed without a reveal.
        pub fn refund(&mut self, seq: u64, badges: Bucket) -> Bucket {
            let now = Consensus::current_epoch();
            let i = self.index(seq);
            let call = &mut self.calls[i];
            assert!(call.payload.is_none(), "call revealed; nothing to refund");
            let refund_from = call.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS);
            assert!(now >= refund_from, "refunds open at epoch {} (current {})", refund_from, now);
            assert!(
                badges.resource_address() == call.badges.resource_address(),
                "not a badge of this call"
            );
            let count = badges.amount();
            assert!(count.is_positive(), "no badge to refund");
            let due = call.price.checked_mul(count).expect("refund amount overflows");
            badges.burn();
            call.refunded += count.to_u64_checked().expect("badge count fits in u64");
            self.earnings.withdraw(due)
        }

        /// Withdraws proceeds of opened calls. Publisher only.
        pub fn withdraw(&mut self, amount: Amount) -> Bucket {
            assert!(amount.is_positive(), "amount must be positive");
            assert!(
                amount <= self.withdrawable,
                "only proceeds of opened calls can be withdrawn ({} available)",
                self.withdrawable
            );
            self.withdrawable = self.withdrawable.checked_sub(amount).expect("withdrawable underflows");
            self.earnings.withdraw(amount)
        }

        // ---- desk ---------------------------------------------------------------------------

        pub fn publisher(&self) -> RistrettoPublicKeyBytes {
            self.publisher
        }

        pub fn opened_at_epoch(&self) -> u64 {
            self.opened_at_epoch
        }

        pub fn call_count(&self) -> u64 {
            self.calls.len() as u64
        }

        /// `(sealed, opened, never opened)`: never opened counts calls whose reveal window has
        /// closed without a reveal. These are losses on the caller's record.
        pub fn stats(&self) -> (u64, u64, u64) {
            let now = Consensus::current_epoch();
            let opened = self.calls.iter().filter(|c| c.payload.is_some()).count() as u64;
            let lost = self
                .calls
                .iter()
                .filter(|c| c.payload.is_none() && now >= c.reveal_at_epoch.saturating_add(REVEAL_WINDOW_EPOCHS))
                .count() as u64;
            (self.calls.len() as u64, opened, lost)
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

        pub fn price(&self, seq: u64) -> Amount {
            self.calls[self.index(seq)].price
        }

        pub fn sold(&self, seq: u64) -> u64 {
            self.calls[self.index(seq)].sold
        }

        pub fn refunded(&self, seq: u64) -> u64 {
            self.calls[self.index(seq)].refunded
        }

        pub fn payload(&self, seq: u64) -> Option<String> {
            self.calls[self.index(seq)].payload.clone()
        }

        pub fn nonce(&self, seq: u64) -> Option<Bytes> {
            self.calls[self.index(seq)].nonce.clone()
        }

        pub fn revealed_at_epoch(&self, seq: u64) -> Option<u64> {
            self.calls[self.index(seq)].revealed_at_epoch
        }

        pub fn badge_resource(&self, seq: u64) -> ResourceAddress {
            self.calls[self.index(seq)].badges.resource_address()
        }

        fn index(&self, seq: u64) -> usize {
            assert!(seq < self.calls.len() as u64, "no call #{} in this desk", seq);
            seq as usize
        }
    }
}

#[cfg(test)]
mod tests {
    //! The commitment scheme, natively: if two different payloads could open one commitment, the
    //! track-record claim would collapse.

    use super::{commitment_of, payload_is_canonical};

    const KEY: &[u8] = &[7u8; 32];

    #[test]
    fn the_commitment_is_deterministic() {
        assert_eq!(commitment_of(KEY, 0, "BTCUSDT long", b"n"), commitment_of(KEY, 0, "BTCUSDT long", b"n"));
    }

    #[test]
    fn payload_nonce_key_and_number_all_change_the_commitment() {
        let base = commitment_of(KEY, 0, "BTCUSDT long", b"nonce-1");
        assert_ne!(base, commitment_of(KEY, 0, "BTCUSDT short", b"nonce-1"));
        assert_ne!(base, commitment_of(KEY, 0, "BTCUSDT long", b"nonce-2"));
        assert_ne!(base, commitment_of(&[8u8; 32], 0, "BTCUSDT long", b"nonce-1"));
        assert_ne!(base, commitment_of(KEY, 1, "BTCUSDT long", b"nonce-1"), "a commitment must not open under another number");
    }

    #[test]
    fn shifting_bytes_between_parts_does_not_collide() {
        assert_ne!(commitment_of(KEY, 0, "ab", b"c"), commitment_of(KEY, 0, "a", b"bc"));
    }

    #[test]
    fn payloads_that_read_differently_than_they_hash_are_not_canonical() {
        assert!(payload_is_canonical("BTCUSDT long 62000 sl 60500"));
        assert!(!payload_is_canonical("BTC \u{202E}trohs"));
        assert!(!payload_is_canonical("BTC long\nshort"));
    }
}
