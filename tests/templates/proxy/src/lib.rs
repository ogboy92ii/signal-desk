// Copyright 2026 Soufian J (OG Boy)
// SPDX-License-Identifier: BSD-3-Clause

//! Test-only: a component that calls a desk on behalf of whoever signs the transaction. If a nested
//! call kept the signer's key badge, any dApp a publisher signs for could seal calls in their name.

use tari_template_lib::prelude::*;
use tari_template_lib::types::Hash32;

#[template]
mod proxy {
    use super::*;

    pub struct DeskProxy;

    impl DeskProxy {
        pub fn new() -> Component<Self> {
            Component::new(DeskProxy)
                .with_owner_rule(OwnerRule::None)
                .with_access_rules(
                    ComponentAccessRules::new()
                        .method("seal_via", rule!(allow_all))
                        .method("withdraw_via", rule!(allow_all))
                        .default(rule!(deny_all)),
                )
                .create()
        }

        pub fn seal_via(&self, desk: ComponentAddress, seq: u64, commitment: Hash32, reveal_at: u64, price: Amount, label: String) -> u64 {
            ComponentManager::get(desk).call("seal", args![seq, commitment, reveal_at, price, label])
        }

        pub fn withdraw_via(&self, desk: ComponentAddress, amount: Amount) {
            ComponentManager::get(desk).invoke("withdraw", args![amount]);
        }
    }
}
