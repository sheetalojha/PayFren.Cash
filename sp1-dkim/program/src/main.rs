#![no_main]

use cfdkim::{verify_email_with_public_key, DkimPublicKey};
use mailparse::parse_mail;
use sha2::{Digest, Sha256};
use sp1_zkvm::io::{commit, commit_slice, read, read_vec};
use alloy_sol_types::SolType;
use fibonacci_lib::PublicValuesStruct;
use regex::Regex;

sp1_zkvm::entrypoint!(main);

pub fn main() {
    let from_domain = read::<String>();
    let raw_email = read_vec();
    let public_key_type = read::<String>();
    let public_key_vec = read_vec();

    let email = parse_mail(&raw_email).unwrap();
    let public_key = DkimPublicKey::from_vec_with_type(&public_key_vec, &public_key_type);

    let mut hasher = Sha256::new();
    hasher.update(public_key_vec);
    let public_key_hash = hasher.finalize();

    let mut hasher = Sha256::new();
    hasher.update(from_domain.as_bytes());
    let from_domain_hash = hasher.finalize();

    commit_slice(&from_domain_hash);
    commit_slice(&public_key_hash);


    let result = verify_email_with_public_key(&from_domain, &email, &public_key).unwrap();
    let is_verified = result.summary() == "pass";

    if is_verified{
        commit(&true);
    }
    else{
        commit(&false);
    }
    
    // Extract information using regex
    let email_body = String::from_utf8_lossy(&raw_email);
    // Updated regex pattern to remove look-ahead
    let re = Regex::new(r"Paid to\s*:\s*(.+?)\s*.*?₹\s*(\d+(?:\.\d{2})?).*?Debited from\s*:\s*([A-Z0-9]+)").unwrap();

    if let Some(captures) = re.captures(&email_body) {
        commit(&captures.get(1).map_or("", |m| m.as_str()).to_string());
        commit(&captures.get(2).map_or("", |m| m.as_str()).to_string());
        commit(&captures.get(3).map_or("", |m| m.as_str()).to_string());
    }

    // Commit the public values
    
}
