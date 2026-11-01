# Signal Desk

**Verifiable crypto calls on the Tari Ootle.** A caller opens one desk. Every call they seal gets a
number in the desk's registry and can never be removed. Buyers pay into escrow; the call opens
publicly at expiry and is checked against its commitment; a call nobody opens counts as lost and
refunds its buyers. The caller is paid only for calls that were opened.

Built for the Tari Ootle November 2026 contest (MVP), on top of
[Signal Vault](https://github.com/ogboy92ii/signal-vault) (September contest, 2nd place).

## What the template guarantees

- A call cannot be read on-chain before its reveal epoch.
- A call opens only as committed: `blake2b(domain ‖ publisher ‖ seq ‖ payload ‖ nonce)`,
  length-prefixed. The number binds a commitment to one slot of one desk.
- No cherry-picking: every sealed call has a number; `stats()` returns `(sealed, opened, never opened)`.
- The desk's opening epoch is public, so its age cannot be faked.
- Proceeds of a call become withdrawable only once it is opened; until then they back refunds.
- TARI only, no owner, every method listed in the access rules, `deny_all` by default.

Not guaranteed: the quality of a call, and (in this first stage) the delivery of the payload to the
buyer, which happens off-chain. Encrypted on-chain delivery with a dispute ruled by the template is
the next stage.

## Build and test

```
cargo build --release --locked --target wasm32-unknown-unknown
cargo test --locked          # Linux/macOS: the engine's JIT does not build on Windows
```

CI builds twice and requires identical bytes, audits every dependency (cargo-deny), checks the crates
compiled into the wasm against a reviewed list, scans the binary for personal or secret data, and
signs where the binary comes from (SLSA provenance). `scripts/verify_release.py <commit>` checks all
of it before a binary is published.

## Licence

BSD-3-Clause.
