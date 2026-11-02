//! The web client (maquettes/crypto.js) and this crate's test client must compute the same bytes:
//! the test client is checked against the template by every other suite, and these vectors, produced
//! by the web client, are checked against the test client here. Regenerate them with the web client
//! if a domain or a layout ever changes.

mod common;

use common::client;
use curve25519_dalek::{ristretto::CompressedRistretto, scalar::Scalar};
use sha2::Digest;

const DESK_KEY: [u8; 32] = [0xab; 32];
const B: &str = "44f53520926ec81fbd5a387845beb7df85a96a24ece18738bdcfa6a7822a176d";
const R: &str = "bce83f8ba5dd2fa572864c24ba1810f9522bc6004afe95877ac73241cafdab42";
const S: &str = "8e5cade7615988c59c814ad058b432ca0eec606d774c5db045b9c3964601a457";
const KS_HEAD: &str = "8e1d7b6f12fef19bf97e3527ea475d050002da2f4e082ac0ec0822497fca7468";
const KS_TAIL: &str = "fcc70c573308a36310207d473c2ac44ffbd7e350909c9e0d666d98b0df14ab1f";
const BUY_C: &str = "3fcfb832d09ad66a5424a065c1292819727a5695984b76cc2a69c8d2e84a3c0f";
const BUY_Z: &str = "60855581987b41a16984fc028688f7c149f145e63addd5a5c5d40208a79e5b00";
const DLEQ_C: &str = "d43fe823f773e71a7d3a2af368476da12eaa763e89b494f8546584ea38776c03";
const DLEQ_Z: &str = "53b12ceeb1515d6bbfd6b8086a0dc21d15560c207f8d1944e9bcfd6d79c04b02";

fn bytes32(h: &str) -> [u8; 32] {
    let v: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap()).collect();
    v.try_into().unwrap()
}

fn context(seq: u64, sale: Option<u64>) -> Vec<u8> {
    let mut out = DESK_KEY.to_vec();
    out.extend_from_slice(&seq.to_le_bytes());
    if let Some(sale) = sale {
        out.extend_from_slice(&sale.to_le_bytes());
    }
    out
}

fn point(h: &str) -> curve25519_dalek::ristretto::RistrettoPoint {
    CompressedRistretto(bytes32(h)).decompress().expect("canonical point")
}

fn scalar(h: &str) -> Scalar {
    Option::from(Scalar::from_canonical_bytes(bytes32(h))).expect("canonical scalar")
}

/// The template's challenge, rebuilt here from its definition.
fn challenge(domain: &[u8], context: &[u8], message: &[u8], points: &[[u8; 32]]) -> Scalar {
    let mut h = sha2::Sha512::new();
    for part in [&(domain.len() as u64).to_le_bytes()[..], domain, &(context.len() as u64).to_le_bytes(), context, &(message.len() as u64).to_le_bytes(), message] {
        h.update(part);
    }
    for p in points {
        h.update(p);
    }
    Scalar::from_bytes_mod_order_wide(&h.finalize().into())
}

#[test]
fn the_web_client_derives_the_same_points_and_keystream() {
    assert_eq!(client::public(&Scalar::from(7u64)), bytes32(B), "B = 7·G");
    assert_eq!(client::public(&Scalar::from(11u64)), bytes32(R), "R = 11·G");
    assert_eq!(client::shared_from_ephemeral(&Scalar::from(11u64), &bytes32(B)), bytes32(S), "S = r·B");
    let ks = client::keystream(&context(3, Some(7)), &bytes32(B), &bytes32(R), &bytes32(S), 640);
    assert_eq!(ks[..32], bytes32(KS_HEAD));
    assert_eq!(ks[608..], bytes32(KS_TAIL));
}

#[test]
fn the_web_client_purchase_proof_verifies_as_the_template_checks_it() {
    let (c, z) = (scalar(BUY_C), scalar(BUY_Z));
    let a = (curve25519_dalek::ristretto::RistrettoPoint::mul_base(&z) - point(B) * c).compress().to_bytes();
    assert_eq!(challenge(client::AUTH, &context(3, None), b"buy", &[bytes32(B), a]), c);
}

#[test]
fn the_web_client_dispute_proof_verifies_as_the_template_checks_it() {
    let (c, z) = (scalar(DLEQ_C), scalar(DLEQ_Z));
    let a1 = (curve25519_dalek::ristretto::RistrettoPoint::mul_base(&z) - point(B) * c).compress().to_bytes();
    let a2 = (point(R) * z - point(S) * c).compress().to_bytes();
    assert_eq!(challenge(client::DLEQ, &context(3, Some(7)), b"", &[bytes32(B), bytes32(R), bytes32(S), a1, a2]), c);
}
