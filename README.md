# Signal Desk

**Calls nobody can fake, sealed on the Tari Ootle.**

Live app (testnet esmeralda, Sapient wallet): **https://signal-desk-ootle.vercel.app**

A caller opens one desk. Every call they seal gets a number in the desk's registry and can never be
removed or edited. Buyers pay in TARI and receive the call encrypted for them alone. At the deadline
the call becomes readable by everyone and is checked against the market, so a hit rate on Signal Desk
is a record, not a claim.

Built for the Tari Ootle November 2026 contest (MVP), on top of two earlier entries by the same
author: [Signal Vault](https://github.com/ogboy92ii/signal-vault) (September, one sealed signal) and
Crypt (October, private delivery with an on-chain dispute).

## What you can do in the app

- **Seal a call** before the market moves. Only a commitment and a public label (the pair, the game,
  the subject) go on chain; the content stays secret until the deadline.
- **Sell it.** A buyer pays the exact price into the desk, the caller delivers the call encrypted to
  the buyer's key, and the buyer can dispute a delivery that does not match the commitment. A sale
  that was never delivered, a fraud, or a call that was never opened is refunded by the template.
- **Open without anyone's help.** Each call carries a time-locked copy of itself (drand quicknet,
  [tlock](https://github.com/drand/tlock-js)). Once the drand round is out, any browser can read
  the copy and verify it against the commitment: no transaction, no server and no bot is needed for
  a call to become public. Writing the opening on chain (`reveal`, open to anyone) is only needed to
  settle sales.
- **Four kinds of calls**, each with its own way to a result:
  - *Crypto*: side, entry, target, stop, deadline. Result computed from public Binance candles.
  - *Sport* (NFL, NBA, Champions League, Premier League, UFC): winner, spread or total. Result read
    from public ESPN scores; the game must exist on ESPN when the call is sealed.
  - *Finance / Politics*: a closed question with an official source named up front (SEC, Fed, ECB,
    CFTC, or a country's official result). The source is public from the seal on. The result is
    settled by the site operator from that publication and listed in `maquettes/verdicts.json`.
  - *Open topic*: a public subject and a secret text. It proves the text was written beforehand;
    its result is not verified, it is never ranked, and it sells for 10 TARI at most.
- **Forecast leagues** (free): anyone opens a league and asks questions (yes/no, number, price,
  multiple choice, range, up/down). Answers are sealed before the close and time-locked like calls;
  the ranking is computed from the chain. Leagues can be open or closed, with members the organizer
  adds, removes or blocks, enforced by the template.
- **Follow callers** with a list stored on chain, readable from any device.
- **A leaderboard** built only from sealed calls: a call that was never opened counts as lost.
- 9 languages (English by default), mobile and desktop.

## On chain (testnet esmeralda)

| Template | Address |
|---|---|
| Desk (`src/`) | `template_a88bcb569681310009d9e33672d03c8299857211ad0ff5648752bce4bcdbc325` |
| Forecasts, leagues (`forecasts/`) | `template_0035855954f95e2d51d486c75a712de004d16404d34c955e26795368c0c44f4f` |
| Follows (`follows/`) | `template_4640483eff1282756f2b80ebec75cb60b45160666035154d085bddeff517efc2` |

The app reads the chain through the public Ootle indexer and talks to the Sapient wallet extension.
It has no backend and stores nothing about its users.

## What the desk template guarantees

- A call cannot be read on chain before its reveal epoch.
- A call opens only as committed: `blake2b(domain ‖ desk ‖ publisher ‖ seq ‖ payload ‖ nonce)`,
  length-prefixed. The desk address, the publisher's key and the number bind a commitment to one
  slot of one desk, so a copied commitment never opens.
- `seal` takes the number it expects, so two racing seals cannot land a call under the wrong number.
- The opened call is published in the `call_revealed` event; payloads are printable ASCII only (no
  bidi or invisible characters showing one call while hashing another), and a payload must start
  with the public label it was sealed under.
- Delivery is on chain and encrypted per buyer; a dispute is ruled by the template from the
  delivered block and the commitment.
- No cherry-picking: every sealed call has a number; `stats()` returns `(sealed, opened, never opened)`.
- The desk's opening epoch is public, so its age cannot be faked.
- Proceeds of a call become withdrawable only once it is opened and its dispute window has passed;
  until then they back refunds. They are always paid into the payout account fixed at `open_desk`.
- TARI only, no owner, every method listed in the access rules, `deny_all` by default.

Not guaranteed: the quality of a call.

## Known limits

- **Deadlines up to about 4 days.** The template counts in epochs and drand counts in seconds; the
  time lock has to land inside the template's 10-epoch opening window, which bounds how far ahead a
  call can be sealed. A longer, horizon-dependent window is the next template change.
- **Getting paid needs one transaction.** Reading a call needs none, but the caller (or anyone) has
  to write the opening on chain within the window for the sales to settle; otherwise buyers are
  refunded.
- **Finance / Politics results are settled by the site operator**, from the official source named in
  the call. This is the Kalshi model, not a decentralised oracle.
- **Demo desks.** The desks marked ✓ were sealed by bots the project ran (`robot/`) to fill the
  testnet app at launch, following public rules written in their bio. The bots are stopped: their
  calls stay on chain and open by themselves, and the app no longer offers them for sale.
- Testnet only for now: testnet TARI have no value.

## Repository layout

| Path | What it is |
|---|---|
| `src/`, `tests/` | Desk template and its tests (8 unit, 25 engine tests) |
| `forecasts/` | Leagues template (5 unit, 11 engine tests) |
| `follows/` | Follow-list template (6 engine tests) |
| `maquettes/` | The web app: static HTML, CSS and JavaScript, no build step, no framework |
| `robot/` | The demo bots behind the ✓ desks (no longer run) and the tool that lists calls awaiting a verdict |
| `scripts/` | Release checks (binary scan, reviewed dependencies) |

## Run the app locally

```
cd maquettes
python -m http.server 8791 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8791/site-signal-desk.html`. The Sapient extension does not inject
itself on `file://` pages, hence the local server. After editing an inline script, a page or the
translations: `python csp.py` (recomputes the Content-Security-Policy) and `node build_i18n.cjs`.

## Build and test the templates

```
cargo build --release --locked --target wasm32-unknown-unknown
cargo test --locked          # Linux/macOS: the engine's JIT does not build on Windows
```

CI builds twice and requires identical bytes, audits every dependency (cargo-deny), checks the crates
compiled into the wasm against a reviewed list, scans the binary for personal or secret data, and
signs where the binary comes from (SLSA provenance). `scripts/verify_release.py <commit>` checks all
of it before a binary is published.

## Security of the web app

Strict Content-Security-Policy (`default-src 'none'`, no inline style, inline scripts allowed by hash
only), no third-party script at runtime (libraries are vendored and pinned), every value read from
the chain is verified against its commitment before it is shown, and user-written text is filtered
on input and masked on display when it breaks the site rules.

## Licence and third-party material

Code: BSD-3-Clause.

Not covered by that licence: team logos in `maquettes/img/equipes/` are trademarks of their
respective owners and are shown only to identify the games; coin icons in `maquettes/img/sujets/`
come from [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) (CC0) and flags
from [flag-icons](https://github.com/lipis/flag-icons) (MIT).
