//! `read_store2_units`: the store2 unit files of one page-side `readUnits` call in one raw reply.
//!
//! Fork-local. The frame format, statuses and budgets are those of `get_assets_batch`
//! (`asset_batch::read_batch_with`); what differs is the key guard and the rules an `ok` frame
//! must meet. The page treats an `ok` frame as the whole, current bytes of the file `read_range`
//! would read for the same key and reads every other key through the per-key path, so this module
//! never decides a missing or failed read, only supplies bytes.

use crate::asset_batch::{read_batch_with, CHUNK_MAX, RESPONSE_MAX, STORE2_READ};
use crate::chunked_io;
use std::path::{Path, PathBuf};

const STORE2_PREFIX: &str = "store2/";

/// The most keys one call holds (the page reads units in calls of at most this many).
pub const STORE2_BATCH_MAX_KEYS: usize = 256;

/// The path of a store2 unit key under `base`, or the reason the key is refused. The key starts
/// with `store2/` and names something under it; beyond that it must pass the very rules
/// `read_range` applies, so no key reaches a file `read_range` would not.
fn store2_path(base: &Path, key: &str) -> Result<PathBuf, String> {
    if !(key.starts_with(STORE2_PREFIX) && key.len() > STORE2_PREFIX.len()) {
        return Err("a store2 batch key starts with store2/".to_string());
    }
    chunked_io::resolve_addressable(base, key)
}

/// The response of one call: one frame per key in key order, `[u8 status][u32 LE len][bytes]`.
/// `chunk_max` is the most one file may hold and `response_max` the most file bytes the whole
/// response holds (see `asset_batch::read_batch_with`). More than `STORE2_BATCH_MAX_KEYS` keys
/// are refused before any key is resolved.
pub fn get_store2_units_with(base: &Path, keys: &[String], chunk_max: u64, response_max: u64) -> Result<Vec<u8>, String> {
    if keys.len() > STORE2_BATCH_MAX_KEYS {
        return Err(format!("refused: a store2 batch holds at most {} keys", STORE2_BATCH_MAX_KEYS));
    }
    let resolve = |key: &str| store2_path(base, key);
    Ok(read_batch_with(keys, &resolve, chunk_max, response_max, &STORE2_READ))
}

pub fn get_store2_units(base: &Path, keys: &[String]) -> Result<Vec<u8>, String> {
    get_store2_units_with(base, keys, CHUNK_MAX, RESPONSE_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose, Engine as _};
    use serde_json::Value;
    use std::fs;

    const OK: u8 = 0;
    const MISSING: u8 = 1;
    const INVALID: u8 = 2;
    const ERROR: u8 = 3;
    const LARGE: u8 = 4;
    const DEFERRED: u8 = 5;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu-store2-batch-{}-{}", name, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn status_name(status: u8) -> &'static str {
        match status {
            OK => "ok",
            MISSING => "missing",
            INVALID => "invalid",
            ERROR => "error",
            LARGE => "large",
            DEFERRED => "deferred",
            _ => "unknown",
        }
    }

    fn cases() -> Value {
        serde_json::from_str(include_str!("../../src/ts/storage/tests/store2UnitBatchCases.json")).unwrap()
    }

    fn strings(keys: &[&str]) -> Vec<String> {
        keys.iter().map(|k| k.to_string()).collect()
    }

    fn frames_of(out: &[u8]) -> Vec<(u8, Vec<u8>)> {
        let mut frames = Vec::new();
        let mut at = 0;
        while at < out.len() {
            let status = out[at];
            let len = u32::from_le_bytes(out[at + 1..at + 5].try_into().unwrap()) as usize;
            frames.push((status, out[at + 5..at + 5 + len].to_vec()));
            at += 5 + len;
        }
        assert_eq!(at, out.len(), "exact consumption");
        frames
    }

    /// Writes `bytes` at the path `key` resolves to under `base`, creating the directories.
    fn plant(base: &Path, key: &str, bytes: &[u8]) {
        let mut path = base.to_path_buf();
        for segment in key.split('/') {
            path.push(segment);
        }
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn real_unit() -> Vec<u8> {
        let table = cases();
        let unit = general_purpose::STANDARD.decode(table["realUnit"]["base64"].as_str().unwrap()).unwrap();
        assert_eq!(unit.len() as u64, table["realUnit"]["length"].as_u64().unwrap());
        assert_eq!(&unit[..4], b"RSAL");
        unit
    }

    fn run(base: &Path, keys: &[&str]) -> Vec<(u8, Vec<u8>)> {
        frames_of(&get_store2_units(base, &strings(keys)).unwrap())
    }

    /// The files no store2 key may reach: beside the store2 directory and inside it at other keys.
    fn plant_decoys(base: &Path) {
        plant(base, "secret", b"DECOY-secret");
        plant(base, "assets/a", b"DECOY-asset");
        plant(base, "store2-commit", b"DECOY-commit");
        plant(base, "store2-fence", b"DECOY-fence");
        plant(base, "store2/a/b", b"DECOY-nested");
    }

    const DECOYS: [&[u8]; 5] = [b"DECOY-secret", b"DECOY-asset", b"DECOY-commit", b"DECOY-fence", b"DECOY-nested"];

    // ----- R4.1 frames -----------------------------------------------------------------

    #[test]
    fn frames_come_back_in_key_order_with_the_bytes_and_status_of_each_file() {
        let base = scratch("frames");
        let unit = real_unit();
        plant(&base, "store2/u-first", &unit);
        plant(&base, "store2/u-second", b"second bytes");
        plant(&base, "store2/u-empty", b"");
        fs::create_dir_all(base.join("store2").join("u-dir")).unwrap();
        let frames = run(
            &base,
            &["store2/u-second", "store2/u-first", "store2/u-absent", "store2/u-empty", "store2/u-dir", "store2/u-second"],
        );
        assert_eq!(frames.len(), 6);
        assert_eq!(frames[0], (OK, b"second bytes".to_vec()));
        assert_eq!(frames[1], (OK, unit));
        assert_eq!(frames[2], (MISSING, vec![]));
        assert_eq!(frames[3], (OK, vec![]), "an empty file is an ok frame with no bytes");
        assert_eq!(frames[4].0, ERROR, "a directory at the key is an error, not a value");
        assert!(!frames[4].1.is_empty());
        assert_eq!(frames[5], (OK, b"second bytes".to_vec()), "the same key twice answers twice");
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- R4.2 guard rows -------------------------------------------------------------

    #[test]
    fn the_guard_rows_of_the_shared_table_hold_on_this_host() {
        let table = cases();
        let column = if cfg!(windows) { "windows" } else { "posix" };
        let base = scratch("guard");
        plant_decoys(&base);
        let rows = table["keys"].as_array().unwrap();
        assert!(rows.len() >= 20);
        let mut keys = Vec::new();
        for row in rows {
            let key = row["key"].as_str().unwrap().to_string();
            if row[column].as_str().unwrap() == "ok" {
                plant(&base, &key, format!("unit {}", key).as_bytes());
            }
            keys.push(key);
        }
        let frames = frames_of(&get_store2_units(&base, &keys).unwrap());
        assert_eq!(frames.len(), keys.len());
        for (row, (status, bytes)) in rows.iter().zip(frames) {
            let key = row["key"].as_str().unwrap();
            assert_eq!(status_name(status), row[column].as_str().unwrap(), "{:?} ({})", key, row["why"]);
            if status == OK {
                assert_eq!(bytes, format!("unit {}", key).into_bytes(), "{:?}", key);
            } else {
                assert!(DECOYS.iter().all(|decoy| bytes != *decoy), "{:?} returned a decoy", key);
            }
        }
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- R4.3 limits -----------------------------------------------------------------

    #[test]
    fn a_large_file_answers_large_without_bytes_and_does_not_defer_later_keys() {
        let base = scratch("large");
        plant(&base, "store2/u-big", &[7u8; 11]);
        plant(&base, "store2/u-small", b"abc");
        let out = get_store2_units_with(&base, &strings(&["store2/u-big", "store2/u-small"]), 10, 10).unwrap();
        assert_eq!(frames_of(&out), vec![(LARGE, vec![]), (OK, b"abc".to_vec())]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_budget_is_spent_to_the_byte_and_then_every_later_key_is_deferred() {
        let base = scratch("budget-byte");
        plant(&base, "store2/u-a", &[1u8; 6]);
        plant(&base, "store2/u-b", &[2u8; 4]);
        plant(&base, "store2/u-c", &[3u8; 1]);
        plant(&base, "store2/u-d", &[4u8; 1]);
        let keys = strings(&["store2/u-a", "store2/u-b", "store2/u-c", "store2/u-absent", "store2/../x", "store2/u-d"]);
        let frames = frames_of(&get_store2_units_with(&base, &keys, 10, 10).unwrap());
        assert_eq!(frames[0], (OK, vec![1u8; 6]));
        assert_eq!(frames[1], (OK, vec![2u8; 4]), "exactly the budget fits");
        for frame in &frames[2..] {
            assert_eq!(*frame, (DEFERRED, vec![]), "whatever the key's own state");
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_first_file_is_bound_by_the_file_limit_alone() {
        let base = scratch("budget-first");
        plant(&base, "store2/u-a", &[1u8; 8]);
        let out = get_store2_units_with(&base, &strings(&["store2/u-a"]), 10, 5).unwrap();
        assert_eq!(frames_of(&out), vec![(OK, vec![1u8; 8])]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_real_limits_are_four_mebibytes_each() {
        assert_eq!(CHUNK_MAX, 4 * 1024 * 1024);
        assert_eq!(RESPONSE_MAX, 4 * 1024 * 1024);
        let base = scratch("real-limits");
        plant(&base, "store2/u-fits", &vec![1u8; CHUNK_MAX as usize]);
        plant(&base, "store2/u-over", &vec![2u8; CHUNK_MAX as usize + 1]);
        let frames = run(&base, &["store2/u-over", "store2/u-fits"]);
        assert_eq!(frames[0], (LARGE, vec![]));
        assert_eq!(frames[1].0, OK);
        assert_eq!(frames[1].1.len() as u64, CHUNK_MAX);
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- R4.3b budget parity table ---------------------------------------------------

    #[test]
    fn the_budget_cases_of_the_shared_table_give_its_statuses() {
        let table = cases();
        let rows = table["budget"].as_array().unwrap();
        assert!(rows.len() >= 10);
        for row in rows {
            let name = row["name"].as_str().unwrap();
            let base = scratch(&format!("budget-table-{}", name));
            let sizes = row["sizes"].as_array().unwrap();
            let mut keys = Vec::new();
            for (index, size) in sizes.iter().enumerate() {
                let key = format!("store2/u-{}", index);
                if let Some(size) = size.as_u64() {
                    plant(&base, &key, &vec![index as u8 + 1; size as usize]);
                }
                keys.push(key);
            }
            let out = get_store2_units_with(&base, &keys, row["chunkMax"].as_u64().unwrap(), row["responseMax"].as_u64().unwrap()).unwrap();
            let got: Vec<&str> = frames_of(&out).iter().map(|(status, _)| status_name(*status)).collect();
            let want: Vec<&str> = row["statuses"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
            assert_eq!(got, want, "budget case {}", name);
            fs::remove_dir_all(&base).unwrap();
        }
    }

    // ----- R4.5 key cap ----------------------------------------------------------------

    #[test]
    fn more_than_the_key_cap_is_refused_before_any_key_is_read() {
        let base = scratch("cap");
        plant(&base, "store2/u-0", b"x");
        let mut keys: Vec<String> = vec!["store2/u-0".to_string()];
        keys.extend((1..256).map(|i| format!("store2/u-missing-{}", i)));
        assert_eq!(keys.len(), 256);
        let out = get_store2_units(&base, &keys).unwrap();
        assert_eq!(frames_of(&out).len(), 256);
        keys.push("store2/u-one-more".to_string());
        let error = get_store2_units(&base, &keys).unwrap_err();
        assert!(error.starts_with("refused:"), "{}", error);
        assert!(get_store2_units(&base, &[]).unwrap().is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- R4.6 read reach -------------------------------------------------------------

    #[test]
    fn no_key_of_the_table_or_the_generated_set_reaches_a_file_outside_store2() {
        let base = scratch("reach");
        plant_decoys(&base);
        let mut keys: Vec<String> = cases()["keys"].as_array().unwrap().iter().map(|r| r["key"].as_str().unwrap().to_string()).collect();
        keys.extend(generated_keys());
        for chunk in keys.chunks(STORE2_BATCH_MAX_KEYS) {
            let frames = frames_of(&get_store2_units(&base, chunk).unwrap());
            for ((_, bytes), key) in frames.iter().zip(chunk) {
                // store2/a/b is a decoy only for keys that do not resolve to it; a key that resolves to it is the same file read_range reads.
                let resolves_to_nested = store2_path(&base, key).map_or(false, |path| path == base.join("store2").join("a").join("b"));
                for decoy in DECOYS {
                    if decoy == b"DECOY-nested" && resolves_to_nested {
                        continue;
                    }
                    assert!(bytes.as_slice() != decoy, "{:?} reached a decoy", key);
                }
            }
        }
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- R4.8 regular files only -----------------------------------------------------

    #[cfg(unix)]
    #[test]
    fn a_device_at_a_unit_key_is_an_error_never_an_empty_ok() {
        let base = scratch("device");
        fs::create_dir_all(base.join("store2")).unwrap();
        std::os::unix::fs::symlink("/dev/null", base.join("store2").join("u-dev")).unwrap();
        let frames = run(&base, &["store2/u-dev"]);
        assert_eq!(frames[0].0, ERROR);
        assert!(String::from_utf8_lossy(&frames[0].1).contains("is not a file"));
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- R4.9 same refusal set and path as read_range --------------------------------

    /// Keys built around each separator-like piece at the start, middle and end of a name under store2/.
    fn generated_keys() -> Vec<String> {
        let mut keys = Vec::new();
        for piece in ["/", "\\", ":", "\0", ".", "..", " ", ""] {
            keys.push(format!("store2/{}a", piece));
            keys.push(format!("store2/a{}b", piece));
            keys.push(format!("store2/a{}", piece));
            keys.push(format!("store2/{}", piece));
            keys.push(format!("store2/{}/a", piece));
            keys.push(format!("store2/a/{}/b", piece));
            keys.push(format!("store2/a/{}", piece));
        }
        keys
    }

    #[test]
    fn the_store2_guard_refuses_what_read_range_refuses_and_resolves_the_same_path() {
        let base = scratch("same-rules");
        let mut keys: Vec<String> = cases()["keys"].as_array().unwrap().iter().map(|r| r["key"].as_str().unwrap().to_string()).collect();
        keys.extend(generated_keys());
        let mut accepted = 0;
        for key in &keys {
            let wanted = key.starts_with("store2/") && key.len() > "store2/".len() && chunked_io::resolve_addressable(&base, key).is_ok();
            let got = store2_path(&base, key);
            assert_eq!(got.is_ok(), wanted, "{:?}", key);
            if let Ok(path) = got {
                accepted += 1;
                assert_eq!(path, chunked_io::resolve_addressable(&base, key).unwrap(), "{:?}", key);
            }
        }
        assert!(accepted >= 10, "the generated set accepts some keys");
        assert!(accepted < keys.len(), "and refuses some");
    }
}
