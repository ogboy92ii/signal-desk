// Copyright 2026 Soufian J (OG Boy)
// SPDX-License-Identifier: BSD-3-Clause

//! # Signal Forecasts
//!
//! Free forecasts on the Tari Ootle, the launch game of Signal Desk. No money moves.
//!
//! 1. `ask`: the organizer (the key that opened the board) publishes a question, its full text in
//!    the `question_asked` event and its hash in the state, with a closing epoch and a reveal deadline.
//! 2. `seal`: before the close, anyone seals `commitment_of(board, question, their key, answer,
//!    nonce)`. One forecast per key and question; nobody can read it, so nobody can copy it.
//! 3. `reveal`: after the close and before the deadline, the forecast is opened and published in the
//!    `forecast_revealed` event. The commitment binds the forecaster's key: a commitment copied under
//!    another key never opens.
//! 4. `resolve`: after the close, the organizer publishes the outcome (`question_resolved`).
//!
//! Points are counted off chain from these public events, by a script anyone can rerun. The organizer
//! is trusted for one thing only, the outcome, and publishes it where everyone can check it against
//! its source; the forecasts and their timing are the chain's.

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};
use tari_template_lib::prelude::*;
use tari_template_lib::types::Hash32;

const DOMAIN: &[u8] = b"tari.ootle.signal_desk.forecast.v1";
type Blake2b256 = Blake2b<U32>;

/// Longest question text, published in the event (2 KiB per event).
pub const MAX_TEXT_LEN: usize = 512;
/// Longest answer or outcome: a number, a price, a choice.
pub const MAX_ANSWER_LEN: usize = 64;
pub const MIN_NONCE_LEN: usize = 16;
pub const MAX_NONCE_LEN: usize = 64;
/// Furthest close or deadline, counted from the current epoch.
pub const MAX_HORIZON_EPOCHS: u64 = 10_000;
/// The state is decoded on every call within the engine's 2 MiB of WASM memory (see Signal Desk):
/// forecasts are packed records, `FORECAST_LEN` bytes each, and the CI fills a board to both limits.
pub const MAX_QUESTIONS: u64 = 200;
pub const MAX_FORECASTS: u64 = 1_500;
/// `forecaster key (32) || commitment (32) || revealed (1)`.
pub const FORECAST_LEN: usize = 65;

/// The commitment a forecaster seals for `question` of `board`. Every part is length-prefixed.
pub fn commitment_of(board: &str, question: u64, forecaster: &[u8], answer: &str, nonce: &[u8]) -> Hash32 {
    let mut hasher = Blake2b256::new();
    let question = question.to_le_bytes();
    for part in [DOMAIN, board.as_bytes(), question.as_slice(), forecaster, answer.as_bytes(), nonce] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    Hash32::from_array(hasher.finalize().into())
}

/// An answer reads exactly the way it hashes only if it is printable ASCII.
pub fn answer_is_canonical(answer: &str) -> bool {
    !answer.is_empty() && answer.len() <= MAX_ANSWER_LEN && answer.bytes().all(|b| (0x20..=0x7E).contains(&b))
}

/// A question may be in any language, but must not hide text: no control, bidi or zero-width characters.
pub fn text_is_clean(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_TEXT_LEN
        && text.chars().all(|c| {
            !c.is_control()
                && !matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}' | '\u{061C}' | '\u{00AD}')
        })
}

fn text_hash(text: &str) -> Hash32 {
    Hash32::from_array(Blake2b256::digest(text.as_bytes()).into())
}

#[template]
mod signal_forecasts {
    use super::*;

    pub struct SignalForecasts {
        /// Key that opened the board: the only one that asks and resolves.
        organizer: RistrettoPublicKeyBytes,
        opened_at_epoch: u64,
        questions: Vec<Question>,
        forecasts_count: u64,
    }

    impl SignalForecasts {
        pub fn open_board() -> Component<Self> {
            let organizer = CallerContext::transaction_signer_public_key();
            let opened_at_epoch = Consensus::current_epoch();
            emit_event("board_opened", metadata! {
                "organizer" => organizer.to_string(),
                "epoch" => opened_at_epoch.to_string(),
            });
            Component::new(Self { organizer, opened_at_epoch, questions: Vec::new(), forecasts_count: 0 })
                .with_owner_rule(OwnerRule::None)
                .with_access_rules(
                    ComponentAccessRules::new()
                        .method("ask", rule!(public_key(organizer)))
                        .method("resolve", rule!(public_key(organizer)))
                        .method("seal", rule!(allow_all))
                        .method("reveal", rule!(allow_all))
                        .method("whoami", rule!(allow_all))
                        .method("organizer", rule!(allow_all))
                        .method("question_count", rule!(allow_all))
                        .method("forecast_count", rule!(allow_all))
                        .default(rule!(deny_all)),
                )
                .create()
        }

        /// Publishes question number `expected_id`. Organizer only.
        pub fn ask(&mut self, expected_id: u64, text: String, close_epoch: u64, reveal_until_epoch: u64) -> u64 {
            let now = Consensus::current_epoch();
            let id = self.questions.len() as u64;
            assert!(id == expected_id, "next question number is {}, not {}", id, expected_id);
            assert!(id < MAX_QUESTIONS, "this board has reached {} questions", MAX_QUESTIONS);
            assert!(text_is_clean(&text), "question text must be 1 to {} bytes with no hidden characters", MAX_TEXT_LEN);
            assert!(close_epoch > now, "close_epoch must be in the future");
            assert!(reveal_until_epoch > close_epoch, "reveal_until_epoch must come after close_epoch");
            assert!(reveal_until_epoch - now <= MAX_HORIZON_EPOCHS, "deadline more than {} epochs away", MAX_HORIZON_EPOCHS);
            let board = CallerContext::current_component_address();
            emit_event("question_asked", metadata! {
                "board" => board.to_string(),
                "question" => id.to_string(),
                "text" => text.clone(),
                "close_epoch" => close_epoch.to_string(),
                "reveal_until_epoch" => reveal_until_epoch.to_string(),
            });
            self.questions.push(Question {
                text_hash: text_hash(&text),
                asked_at_epoch: now,
                close_epoch,
                reveal_until_epoch,
                forecasts: Bytes::from_vec(Vec::new()),
                outcome: None,
            });
            id
        }

        /// Seals the signer's forecast for `question`. Returns its index. One per key and question.
        pub fn seal(&mut self, question: u64, commitment: Hash32) -> u64 {
            let now = Consensus::current_epoch();
            let key = CallerContext::transaction_signer_public_key();
            let board = CallerContext::current_component_address();
            assert!(self.forecasts_count < MAX_FORECASTS, "this board has reached {} forecasts", MAX_FORECASTS);
            let i = self.index(question);
            let q = &mut self.questions[i];
            assert!(now < q.close_epoch, "forecasts closed at epoch {}", q.close_epoch);
            assert!(
                !q.forecasts.chunks(FORECAST_LEN).any(|f| f[..32] == *key.as_bytes()),
                "this key already sealed a forecast for question #{}",
                question
            );
            let index = (q.forecasts.len() / FORECAST_LEN) as u64;
            let mut all = core::mem::replace(&mut q.forecasts, Bytes::from_vec(Vec::new())).into_vec();
            all.extend_from_slice(key.as_bytes());
            all.extend_from_slice(&commitment.into_array());
            all.push(0);
            q.forecasts = Bytes::from_vec(all);
            self.forecasts_count += 1;
            emit_event("forecast_sealed", metadata! {
                "board" => board.to_string(),
                "question" => question.to_string(),
                "index" => index.to_string(),
                "forecaster" => key.to_string(),
                "commitment" => commitment.to_string(),
            });
            index
        }

        /// Opens forecast `index` of `question` after the close. Anyone holding the answer and nonce may.
        pub fn reveal(&mut self, question: u64, index: u64, answer: String, nonce: Bytes) {
            let now = Consensus::current_epoch();
            let board = CallerContext::current_component_address();
            let i = self.index(question);
            let q = &mut self.questions[i];
            assert!(now >= q.close_epoch, "too early: forecasts open at epoch {}", q.close_epoch);
            assert!(now < q.reveal_until_epoch, "reveal deadline passed at epoch {}", q.reveal_until_epoch);
            assert!(index < (q.forecasts.len() / FORECAST_LEN) as u64, "no forecast #{} for question #{}", index, question);
            let at = index as usize * FORECAST_LEN;
            assert!(q.forecasts[at + 64] == 0, "already revealed");
            assert!(answer_is_canonical(&answer), "answer must be 1 to {} printable ASCII characters", MAX_ANSWER_LEN);
            assert!((MIN_NONCE_LEN..=MAX_NONCE_LEN).contains(&nonce.len()), "nonce must be {} to {} bytes", MIN_NONCE_LEN, MAX_NONCE_LEN);
            let key = RistrettoPublicKeyBytes::try_from(&q.forecasts[at..at + 32]).expect("32 bytes");
            assert!(
                q.forecasts[at + 32..at + 64] == commitment_of(&board.to_string(), question, key.as_bytes(), &answer, &nonce).into_array(),
                "answer and nonce do not open this forecast"
            );
            q.forecasts[at + 64] = 1;
            emit_event("forecast_revealed", metadata! {
                "board" => board.to_string(),
                "question" => question.to_string(),
                "index" => index.to_string(),
                "forecaster" => key.to_string(),
                "answer" => answer,
            });
        }

        /// Publishes the outcome of `question` after its close. Organizer only, once.
        pub fn resolve(&mut self, question: u64, outcome: String) {
            let now = Consensus::current_epoch();
            let board = CallerContext::current_component_address();
            let i = self.index(question);
            let q = &mut self.questions[i];
            assert!(now >= q.close_epoch, "too early: the question closes at epoch {}", q.close_epoch);
            assert!(q.outcome.is_none(), "already resolved");
            assert!(answer_is_canonical(&outcome), "outcome must be 1 to {} printable ASCII characters", MAX_ANSWER_LEN);
            q.outcome = Some(outcome.clone());
            emit_event("question_resolved", metadata! {
                "board" => board.to_string(),
                "question" => question.to_string(),
                "outcome" => outcome,
            });
        }

        /// The transaction signer's key: what a client binds into its commitment (call it in a dry run).
        pub fn whoami(&self) -> RistrettoPublicKeyBytes {
            CallerContext::transaction_signer_public_key()
        }

        pub fn organizer(&self) -> RistrettoPublicKeyBytes {
            self.organizer
        }

        pub fn question_count(&self) -> u64 {
            self.questions.len() as u64
        }

        pub fn forecast_count(&self, question: u64) -> u64 {
            (self.questions[self.index(question)].forecasts.len() / FORECAST_LEN) as u64
        }

        fn index(&self, question: u64) -> usize {
            assert!(question < self.questions.len() as u64, "no question #{} on this board", question);
            question as usize
        }
    }

    /// One question. Its text lives in the `question_asked` event; the state keeps its hash.
    pub struct Question {
        pub text_hash: Hash32,
        pub asked_at_epoch: u64,
        pub close_epoch: u64,
        pub reveal_until_epoch: u64,
        /// Packed forecast records, `FORECAST_LEN` bytes each.
        pub forecasts: Bytes,
        pub outcome: Option<String>,
    }
}

#[cfg(test)]
mod tests {
    use super::{answer_is_canonical, commitment_of, text_is_clean};

    #[test]
    fn every_bound_part_changes_the_commitment() {
        let base = commitment_of("component_aa", 0, &[1u8; 32], "120", b"n-1");
        assert_ne!(base, commitment_of("component_bb", 0, &[1u8; 32], "120", b"n-1"));
        assert_ne!(base, commitment_of("component_aa", 1, &[1u8; 32], "120", b"n-1"));
        assert_ne!(base, commitment_of("component_aa", 0, &[2u8; 32], "120", b"n-1"), "another forecaster");
        assert_ne!(base, commitment_of("component_aa", 0, &[1u8; 32], "121", b"n-1"));
        assert_ne!(base, commitment_of("component_aa", 0, &[1u8; 32], "120", b"n-2"));
        assert_ne!(commitment_of("component_aa", 0, &[1u8; 32], "12", b"0n"), commitment_of("component_aa", 0, &[1u8; 32], "120", b"n"));
    }

    /// Fixed vector shared with the web client (maquettes/chain.js `forecastCommitment`).
    #[test]
    fn the_commitment_matches_the_web_client() {
        let board = format!("component_{}", "aa".repeat(32));
        let c = commitment_of(&board, 3, &[7u8; 32], "98500", &[9u8; 32]).into_array();
        let hex: String = c.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "805d1472ffe31b0ac0003c9d40fd12fe17cec3bdce1a59f34d2dfa3bd7442d94");
    }

    #[test]
    fn answers_are_short_printable_ascii_and_texts_hide_nothing() {
        assert!(answer_is_canonical("98500.25") && answer_is_canonical("Oui"));
        assert!(!answer_is_canonical("") && !answer_is_canonical("é") && !answer_is_canonical(&"9".repeat(65)));
        assert!(text_is_clean("Prix du BTC le 30 novembre à minuit (UTC) ?"));
        for bad in ["", "a\nb", "BTC \u{202E}", "a\u{200B}b", "a\u{FEFF}"] {
            assert!(!text_is_clean(bad), "{bad:?} must be refused");
        }
    }
}
