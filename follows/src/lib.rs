// Copyright 2026 Soufian J (OG Boy)
// SPDX-License-Identifier: BSD-3-Clause

//! # Signal Follows
//!
//! Who follows which Signal Desk caller, on the Tari Ootle. No money moves.
//!
//! Each person opens **one list of their own** (`open`). Only the key that opened it may change it
//! (`follow`, `unfollow`); anyone may read it (`following`, `is_following`). There is no shared registry:
//! a list stays small whatever the number of users, so the engine's memory limit is never in play.
//!
//! Every change is published as an event (`followed`, `unfollowed`), so a caller's follower count is the
//! public sum of those events, recomputed by anyone from the indexer.

use tari_template_lib::prelude::*;

/// Most desks one list may follow.
pub const MAX_FOLLOWS: usize = 500;

#[template]
mod signal_follows {
    use super::*;

    pub struct SignalFollows {
        /// Key that opened the list: the only one that changes it.
        owner: RistrettoPublicKeyBytes,
        desks: Vec<ComponentAddress>,
    }

    impl SignalFollows {
        pub fn open() -> Component<Self> {
            let owner = CallerContext::transaction_signer_public_key();
            emit_event("follows_opened", metadata! {
                "owner" => owner.to_string(),
            });
            Component::new(Self { owner, desks: Vec::new() })
                .with_owner_rule(OwnerRule::None)
                .with_access_rules(
                    ComponentAccessRules::new()
                        .method("follow", rule!(public_key(owner)))
                        .method("unfollow", rule!(public_key(owner)))
                        .method("following", rule!(allow_all))
                        .method("is_following", rule!(allow_all))
                        .method("owner", rule!(allow_all))
                        .default(rule!(deny_all)),
                )
                .create()
        }

        /// Follows `desk`. Owner only.
        pub fn follow(&mut self, desk: ComponentAddress) {
            assert!(!self.desks.contains(&desk), "already following {}", desk);
            assert!(self.desks.len() < MAX_FOLLOWS, "this list already follows {} desks", MAX_FOLLOWS);
            self.desks.push(desk);
            emit_event("followed", metadata! {
                "list" => CallerContext::current_component_address().to_string(),
                "owner" => self.owner.to_string(),
                "desk" => desk.to_string(),
            });
        }

        /// Stops following `desk`. Owner only.
        pub fn unfollow(&mut self, desk: ComponentAddress) {
            let i = self.desks.iter().position(|d| *d == desk);
            assert!(i.is_some(), "not following {}", desk);
            self.desks.remove(i.unwrap_or_default());
            emit_event("unfollowed", metadata! {
                "list" => CallerContext::current_component_address().to_string(),
                "owner" => self.owner.to_string(),
                "desk" => desk.to_string(),
            });
        }

        /// The desks followed, oldest first.
        pub fn following(&self) -> Vec<ComponentAddress> {
            self.desks.clone()
        }

        pub fn is_following(&self, desk: ComponentAddress) -> bool {
            self.desks.contains(&desk)
        }

        pub fn owner(&self) -> RistrettoPublicKeyBytes {
            self.owner
        }
    }
}
