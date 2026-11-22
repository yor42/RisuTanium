//! The one set of keys the page may name in the app's own key commands, on every target.
//!
//! A key is inside when its first segment is a store directory, when it is one of the root file names, or when
//! the whole key is a write temp name (the sweep and abort clear root temps). Everything else is refused before
//! any I/O, so the page reaches no other file under the data directory. Comparison is byte-exact.

use crate::durable_write::is_temp_name;

/// The directories under the data directory that the page's stores use.
pub const STORE_DIRECTORIES: [&str; 9] =
    ["assets", "inlays", "store2", "consent", "modeldata", "database", "blocks", "coldstorage", "remotes"];

/// The store2 files that live directly under the data directory.
pub const ROOT_FILES: [&str; 5] = ["store2-commit", "store2-sweep", "store2-fence", "store2-owner", "store2-gc-age"];

pub const OUTSIDE_MESSAGE: &str = "refused key: outside the app's store";

/// Whether `key` lies inside the set. The empty key is not: callers that mean the base handle it first.
pub fn inside_store_set(key: &str) -> bool {
    let first = key.split('/').next().unwrap_or(key);
    STORE_DIRECTORIES.contains(&first) || ROOT_FILES.contains(&key) || is_temp_name(key)
}

/// The refusal for a key outside the set, or `Ok` when it is inside.
pub fn require_inside(key: &str) -> Result<(), String> {
    if inside_store_set(key) {
        Ok(())
    } else {
        Err(OUTSIDE_MESSAGE.to_string())
    }
}
