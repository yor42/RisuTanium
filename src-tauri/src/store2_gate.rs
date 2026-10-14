//! The page-generation gate for the decisive writes of the store2 format: the
//! top-level keys `store2-commit` and `store2-fence`, and the removal of
//! `store2/` keys and the fence.
//!
//! A page that dies can leave a command running in Rust: Tauri never cancels a
//! running command. Such a ghost write would land after a newer page registered,
//! overwrite a newer commit, or name units a newer page's collection deleted. The
//! gate refuses it. `store2_register_page` issues a generation under a process-wide
//! lock; every decisive step checks `gen == current` under that same lock, and the
//! rename and the directory flush of a write happen under the same hold. So a
//! registration waits out a write that is in flight, and a write that was granted
//! has landed completely before the registration returns.
//!
//! The lock guards only the counter. `mirror` repeats the counter and is written
//! only under the lock; a read of it is a cheap early refusal for a chunk that
//! does not decide anything and is never load-bearing.
//!
//! Typed error texts, all definite (the call applied nothing) except as noted:
//! - `stale-generation:` the generation is 0 or not the current one;
//! - `registration-timeout:` registration found a write still holding the lock past
//!   its deadline; no generation was issued and the counter is unchanged;
//! - `gate-key-refused:` the key is not one this command may change;
//! - `not-raw:` and `malformed:` as in `asset_batch`, a body or header problem;
//! - `refused key:` the key fails the creatable or addressable rules.
//!
//! The gated write commands answer `{ "flushed": bool }`: `false` when a directory
//! flush after the rename failed (the write still landed). `store2_remove` answers
//! one `{ key, outcome, error? }` entry per key, `outcome` being `removed` or
//! `failed`; an absent key counts as removed.
//!
//! The ungated commands refuse the gated keys (see `ungated_write_refusal` and
//! `ungated_remove_refusal`), so an accidental call around the gate fails loudly.
//! Not covered: the fs plugin's AppData scope, and Windows name aliases such as a
//! trailing dot or space or an 8.3 short name; store2 code uses none of them.

use crate::app_fs;
use crate::chunked_io::{decode_chunk, resolve_addressable, temp_name_for, MAX_CHUNK_BYTES};
use crate::durable_write::{decode_key_header, is_temp_name, rename_with_retry, resolve_key, FileOps, RealOps, KEY_HEADER};
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

pub const COMMIT_KEY: &str = "store2-commit";
pub const FENCE_KEY: &str = "store2-fence";
const UNIT_PREFIX: &str = "store2/";

/// The IPC header that carries the generation of a gated raw call.
pub const GENERATION_HEADER: &str = "x-risu-gen";

/// How long a registration waits for a write in flight; the command always uses this.
pub const REGISTRATION_DEADLINE: Duration = Duration::from_secs(30);
const REGISTRATION_POLL: Duration = Duration::from_millis(5);

const STALE_PREFIX: &str = "stale-generation:";
const TIMEOUT_PREFIX: &str = "registration-timeout:";
const KEY_PREFIX: &str = "gate-key-refused:";

/// Process-wide managed state: the current generation, 0 until a page registers.
pub struct Store2Gate {
    current: Mutex<u64>,
    mirror: AtomicU64,
}

/// Whether a call that carries `gen` may decide when `current` is the generation.
/// Generation 0 means never registered and is always refused.
fn is_current(gen: u64, current: u64) -> bool {
    gen != 0 && gen == current
}

fn stale_error() -> String {
    format!("{} this page's generation is not the current one; nothing was applied", STALE_PREFIX)
}

fn key_error(why: &str) -> String {
    format!("{} {}", KEY_PREFIX, why)
}

impl Store2Gate {
    pub fn new() -> Store2Gate {
        Store2Gate { current: Mutex::new(0), mirror: AtomicU64::new(0) }
    }

    /// The counter holds no invariant a panic could break, so a poisoned lock is recovered.
    fn lock(&self) -> MutexGuard<'_, u64> {
        self.current.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn advance(&self, mut guard: MutexGuard<'_, u64>) -> u64 {
        *guard += 1;
        self.mirror.store(*guard, Ordering::SeqCst);
        *guard
    }

    /// Issues the next generation. Waits for the lock by polling, up to `deadline`,
    /// so nothing stays queued on the lock after a timeout; a timeout issues
    /// nothing and leaves the counter unchanged.
    pub fn register(&self, deadline: Duration) -> Result<u64, String> {
        let started = Instant::now();
        loop {
            match self.current.try_lock() {
                Ok(guard) => return Ok(self.advance(guard)),
                Err(TryLockError::Poisoned(poisoned)) => return Ok(self.advance(poisoned.into_inner())),
                Err(TryLockError::WouldBlock) => {}
            }
            if started.elapsed() >= deadline {
                return Err(format!(
                    "{} a write that holds the gate did not finish within {} ms",
                    TIMEOUT_PREFIX,
                    deadline.as_millis()
                ));
            }
            std::thread::sleep(REGISTRATION_POLL);
        }
    }

    /// A refusal without the lock, for a step that decides nothing.
    fn check_early(&self, gen: u64) -> Result<(), String> {
        if is_current(gen, self.mirror.load(Ordering::SeqCst)) {
            Ok(())
        } else {
            Err(stale_error())
        }
    }
}

fn is_gated_key(key: &str) -> bool {
    key.eq_ignore_ascii_case(COMMIT_KEY) || key.eq_ignore_ascii_case(FENCE_KEY)
}

fn has_unit_prefix(key: &str) -> bool {
    key.len() >= UNIT_PREFIX.len() && key.is_char_boundary(UNIT_PREFIX.len()) && key[..UNIT_PREFIX.len()].eq_ignore_ascii_case(UNIT_PREFIX)
}

/// Why an ungated write may not target `key` (the destination, `final_key` when
/// there is one), or `None`. Names compare without case: a case-insensitive file
/// system maps `Store2-Commit` to the gated file.
pub fn ungated_write_refusal(key: &str) -> Option<&'static str> {
    if is_gated_key(key) {
        Some("refused key: this key is written only through the store2 gate")
    } else {
        None
    }
}

/// Why `app_fs_remove` may not remove `key`, or `None`. A temp file under
/// `store2/` stays removable so the temp sweep can clear it.
pub fn ungated_remove_refusal(key: &str) -> Option<&'static str> {
    let last = key.rsplit('/').next().unwrap_or(key);
    if is_gated_key(key) || (has_unit_prefix(key) && !is_temp_name(last)) {
        Some("refused key: this key is removed only through the store2 gate")
    } else {
        None
    }
}

/// The key of a gated top-level write: only the commit key and the fence.
fn require_top_key(key: &str) -> Result<(), String> {
    if key == COMMIT_KEY || key == FENCE_KEY {
        Ok(())
    } else {
        Err(key_error("only store2-commit and store2-fence are written through the gate"))
    }
}

/// The key of a gated removal: a `store2/` key or the fence, never the commit key.
fn require_remove_key(key: &str) -> Result<(), String> {
    if key == FENCE_KEY || (key.starts_with(UNIT_PREFIX) && key.len() > UNIT_PREFIX.len()) {
        Ok(())
    } else {
        Err(key_error("only store2/ keys and store2-fence are removed through the gate"))
    }
}

/// The generation of a gated raw call.
pub fn generation_from_headers(headers: &tauri::http::HeaderMap) -> Result<u64, String> {
    let text = headers
        .get(GENERATION_HEADER)
        .ok_or_else(|| format!("malformed: missing header {}", GENERATION_HEADER))?
        .to_str()
        .map_err(|_| format!("malformed: header {} is not text", GENERATION_HEADER))?;
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("malformed: header {} is a decimal number", GENERATION_HEADER));
    }
    text.parse::<u64>()
        .map_err(|_| format!("malformed: header {} is too large", GENERATION_HEADER))
}

/// The key and generation of a gated raw single write.
pub fn top_write_headers(headers: &tauri::http::HeaderMap) -> Result<(u64, String), String> {
    let raw_key = headers
        .get(KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "malformed: missing key header".to_string())?;
    let key = decode_key_header(raw_key).map_err(|e| format!("malformed: {}", e))?;
    Ok((generation_from_headers(headers)?, key))
}

/// The decisive step: under the gate lock, refuse a stale generation, then flush
/// the temp, rename it over `destination` and flush the directory, all under the
/// same hold. A refusal or failure removes `temp`, which the caller created.
fn publish_or_discard<O: FileOps>(
    ops: &O,
    gate: &Store2Gate,
    gen: u64,
    temp: &Path,
    destination: &Path,
    directory: &Path,
) -> Result<bool, String> {
    let guard = gate.lock();
    let outcome = if !is_current(gen, *guard) {
        Err(stale_error())
    } else if let Err(error) = ops.sync_file(temp) {
        Err(format!("failed to flush {}: {}", temp.display(), error))
    } else if let Err(error) = rename_with_retry(ops, temp, destination) {
        Err(format!("failed to rename {} to {}: {}", temp.display(), destination.display(), error))
    } else {
        Ok(())
    };
    if let Err(message) = outcome {
        let _ = ops.remove(temp);
        return Err(message);
    }
    let mut flushed = true;
    if let Err(error) = ops.sync_dir(directory) {
        eprintln!("directory flush after rename failed for {}: {}", directory.display(), error);
        flushed = false;
    }
    Ok(flushed)
}

/// One gated write of a whole top-level key. The temp is written before the lock
/// is taken; the generation check and the publish are under it.
pub fn write_top_with<O: FileOps>(
    ops: &O,
    gate: &Store2Gate,
    base: &Path,
    gen: u64,
    key: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    require_top_key(key)?;
    let target = resolve_key(base, key)?;
    gate.check_early(gen)?;
    let directory = target
        .parent()
        .ok_or_else(|| "the target has no parent directory".to_string())?;
    ops.create_dir_all(directory)
        .map_err(|e| format!("failed to create {}: {}", directory.display(), e))?;
    let temp = directory.join(ops.temp_name());
    if let Err(error) = ops.create_synced(&temp, bytes) {
        // An existing temp is not this call's file and is left alone.
        if error.kind() != io::ErrorKind::AlreadyExists {
            let _ = ops.remove(&temp);
        }
        return Err(format!("failed to write {}: {}", temp.display(), error));
    }
    publish_or_discard(ops, gate, gen, &temp, &target, directory)
}

pub fn write_top(gate: &Store2Gate, base: &Path, gen: u64, key: &str, bytes: &[u8]) -> Result<bool, String> {
    write_top_with(&RealOps, gate, base, gen, key, bytes)
}

/// One chunk of a gated top-level write; the chunk protocol of `write_chunk_final_with`
/// without a final key. Chunk 0 and a non-final chunk check the generation
/// early, and chunk 0 does so before it creates the temp. Only the last chunk
/// decides. A temp that chunk 0 found in place is never removed: chunk 0 fails on
/// it before anything of this call exists.
pub fn write_top_chunk_with<O: FileOps>(
    ops: &O,
    gate: &Store2Gate,
    base: &Path,
    gen: u64,
    key: &str,
    id: &str,
    offset: u64,
    bytes: &[u8],
    last: bool,
) -> Result<bool, String> {
    require_top_key(key)?;
    let target = resolve_key(base, key)?;
    let temp_name = temp_name_for(id)?;
    let directory = target
        .parent()
        .ok_or_else(|| "the target has no parent directory".to_string())?;
    let temp = directory.join(&temp_name);
    if offset == 0 || !last {
        if let Err(refusal) = gate.check_early(gen) {
            // A later chunk's temp is this write's own.
            if offset > 0 {
                let _ = ops.remove(&temp);
            }
            return Err(refusal);
        }
    }
    if offset == 0 {
        ops.create_dir_all(directory)
            .map_err(|e| format!("failed to create {}: {}", directory.display(), e))?;
        ops.create_empty(&temp)
            .map_err(|e| format!("failed to create {}: {}", temp.display(), e))?;
    }
    if let Err(error) = ops.append(&temp, offset, bytes) {
        let _ = ops.remove(&temp);
        return Err(format!("failed to write {}: {}", temp.display(), error));
    }
    if !last {
        return Ok(true);
    }
    publish_or_discard(ops, gate, gen, &temp, &target, directory)
}

/// A base64 chunk, decoded and applied (the `store2_write_top_chunk` command).
pub fn write_top_chunk(
    gate: &Store2Gate,
    base: &Path,
    gen: u64,
    key: &str,
    id: &str,
    offset: u64,
    data: &str,
    last: bool,
) -> Result<bool, String> {
    require_top_key(key)?;
    let bytes = decode_chunk(data)?;
    write_top_chunk_bytes(gate, base, gen, key, id, offset, &bytes, last)
}

/// A raw chunk applied on the real file system (the `store2_write_top_chunk_raw` command).
pub fn write_top_chunk_bytes(
    gate: &Store2Gate,
    base: &Path,
    gen: u64,
    key: &str,
    id: &str,
    offset: u64,
    bytes: &[u8],
    last: bool,
) -> Result<bool, String> {
    if bytes.len() > MAX_CHUNK_BYTES {
        return Err("the chunk is larger than a chunk may be".to_string());
    }
    write_top_chunk_with(&RealOps, gate, base, gen, key, id, offset, bytes, last)
}

/// Removes `keys` under one hold of the gate lock. Every key's kind is checked
/// before the lock, and one key of a refused kind refuses the call before anything
/// is removed; a stale generation is refused under the lock before the first
/// removal. A key that fails the addressable rules is reported `failed` while the
/// others are still removed. The result holds one entry per key in input order.
pub fn remove_with(gate: &Store2Gate, base: &Path, gen: u64, keys: &[String]) -> Result<Value, String> {
    for key in keys {
        require_remove_key(key)?;
    }
    let guard = gate.lock();
    if !is_current(gen, *guard) {
        return Err(stale_error());
    }
    let report: Vec<Value> = keys
        .iter()
        .map(|key| match app_fs::remove_key(base, key) {
            Ok(()) => json!({ "key": key, "outcome": "removed" }),
            Err(message) => {
                let absent = resolve_addressable(base, key)
                    .map(|path| matches!(fs::symlink_metadata(path), Err(e) if e.kind() == io::ErrorKind::NotFound))
                    .unwrap_or(false);
                if absent {
                    json!({ "key": key, "outcome": "removed" })
                } else {
                    json!({ "key": key, "outcome": "failed", "error": message })
                }
            }
        })
        .collect();
    drop(guard);
    Ok(Value::Array(report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicUsize;
    use std::sync::{mpsc, Arc};

    const ID: &str = "0123456789abcdef";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu-store2gate-test-{}-{}", name, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    type Hook = Box<dyn Fn(&str) + Send + Sync>;

    /// The real file system that records each step and runs a hook at it. The
    /// hook of `create_synced`, `append`, `sync_file` and `sync_dir` runs after
    /// the step's own work for the first two and before it for the others, so
    /// a hook at `create_synced` sees the temp already written.
    struct Hooked {
        steps: Mutex<Vec<&'static str>>,
        hook: Hook,
    }

    impl Hooked {
        fn new(hook: impl Fn(&str) + Send + Sync + 'static) -> Hooked {
            Hooked { steps: Mutex::new(Vec::new()), hook: Box::new(hook) }
        }

        fn plain() -> Hooked {
            Hooked::new(|_| {})
        }

        fn note(&self, step: &'static str) {
            self.steps.lock().unwrap().push(step);
        }

        fn steps(&self) -> Vec<&'static str> {
            self.steps.lock().unwrap().clone()
        }
    }

    impl FileOps for Hooked {
        fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
            self.note("create_synced");
            RealOps.create_synced(temp, bytes)?;
            (self.hook)("create_synced");
            Ok(())
        }
        fn create_empty(&self, temp: &Path) -> io::Result<()> {
            self.note("create_empty");
            RealOps.create_empty(temp)
        }
        fn append(&self, temp: &Path, offset: u64, bytes: &[u8]) -> io::Result<()> {
            self.note("append");
            RealOps.append(temp, offset, bytes)?;
            (self.hook)("append");
            Ok(())
        }
        fn sync_file(&self, path: &Path) -> io::Result<()> {
            self.note("sync_file");
            (self.hook)("sync_file");
            RealOps.sync_file(path)
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.note("rename");
            (self.hook)("rename");
            RealOps.rename(from, to)
        }
        fn sync_dir(&self, dir: &Path) -> io::Result<()> {
            self.note("sync_dir");
            (self.hook)("sync_dir");
            let result = RealOps.sync_dir(dir);
            self.note("sync_dir_done");
            result
        }
        fn remove(&self, path: &Path) -> io::Result<()> {
            self.note("remove");
            RealOps.remove(path)
        }
        fn sleep_ms(&self, _ms: u64) {}
        fn temp_name(&self) -> String {
            RealOps.temp_name()
        }
    }

    fn registered_twice(gate: &Store2Gate) -> (u64, u64) {
        let first = gate.register(Duration::from_secs(5)).unwrap();
        let second = gate.register(Duration::from_secs(5)).unwrap();
        (first, second)
    }

    fn assert_stale(result: Result<bool, String>) {
        let error = result.unwrap_err();
        assert!(error.starts_with(STALE_PREFIX), "{}", error);
    }

    #[test]
    fn registration_counts_up_from_one() {
        let gate = Store2Gate::new();
        assert_eq!(gate.register(Duration::from_secs(1)).unwrap(), 1);
        assert_eq!(gate.register(Duration::from_secs(1)).unwrap(), 2);
    }

    #[test]
    fn a_current_generation_writes_the_key_and_leaves_no_temp() {
        let base = scratch("write");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let ops = Hooked::plain();

        let flushed = write_top_with(&ops, &gate, &base, gen, COMMIT_KEY, b"commit bytes").unwrap();

        assert!(flushed);
        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"commit bytes");
        assert_eq!(names_in(&base), vec![COMMIT_KEY]);
        assert_eq!(ops.steps(), vec!["create_synced", "sync_file", "rename", "sync_dir", "sync_dir_done"]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_stale_single_write_is_refused_and_the_base_directory_is_untouched() {
        let base = scratch("stale-single");
        let gate = Store2Gate::new();
        let (old, _) = registered_twice(&gate);

        assert_stale(write_top_with(&Hooked::plain(), &gate, &base, old, FENCE_KEY, b"ghost"));

        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_stale_single_write_keeps_the_existing_commit() {
        let base = scratch("stale-keeps");
        let gate = Store2Gate::new();
        let (old, new) = registered_twice(&gate);
        write_top_with(&Hooked::plain(), &gate, &base, new, COMMIT_KEY, b"newer").unwrap();

        assert_stale(write_top_with(&Hooked::plain(), &gate, &base, old, COMMIT_KEY, b"ghost"));

        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"newer");
        assert_eq!(names_in(&base), vec![COMMIT_KEY]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn generation_zero_is_refused_by_every_gated_command() {
        let base = scratch("zero");
        fs::create_dir_all(base.join("store2")).unwrap();
        fs::write(base.join("store2").join("u1"), b"unit").unwrap();
        let gate = Store2Gate::new();

        assert_stale(write_top_with(&Hooked::plain(), &gate, &base, 0, COMMIT_KEY, b"x"));
        assert_stale(write_top_chunk_with(&Hooked::plain(), &gate, &base, 0, COMMIT_KEY, ID, 0, b"x", true));
        assert!(remove_with(&gate, &base, 0, &["store2/u1".to_string()]).unwrap_err().starts_with(STALE_PREFIX));

        assert_eq!(names_in(&base), vec!["store2"]);
        assert_eq!(fs::read(base.join("store2").join("u1")).unwrap(), b"unit");
        // Registered, generation 0 is still refused.
        gate.register(Duration::from_secs(1)).unwrap();
        assert_stale(write_top_with(&Hooked::plain(), &gate, &base, 0, COMMIT_KEY, b"x"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_generation_ahead_of_the_current_one_is_refused() {
        let base = scratch("ahead");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();

        assert_stale(write_top_with(&Hooked::plain(), &gate, &base, gen + 1, COMMIT_KEY, b"x"));
        assert_stale(write_top_chunk_with(&Hooked::plain(), &gate, &base, gen + 1, COMMIT_KEY, ID, 0, b"x", true));
        assert!(remove_with(&gate, &base, gen + 1, &[FENCE_KEY.to_string()]).unwrap_err().starts_with(STALE_PREFIX));
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn chunks_of_a_current_generation_assemble_the_key() {
        let base = scratch("chunks");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let ops = Hooked::plain();

        assert!(write_top_chunk_with(&ops, &gate, &base, gen, FENCE_KEY, ID, 0, b"ab", false).unwrap());
        assert!(write_top_chunk_with(&ops, &gate, &base, gen, FENCE_KEY, ID, 2, b"cd", true).unwrap());

        assert_eq!(fs::read(base.join(FENCE_KEY)).unwrap(), b"abcd");
        assert_eq!(names_in(&base), vec![FENCE_KEY]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_base64_chunk_command_decodes_and_applies() {
        let base = scratch("base64");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();

        write_top_chunk(&gate, &base, gen, COMMIT_KEY, ID, 0, "aGk=", true).unwrap();

        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"hi");
        assert!(write_top_chunk(&gate, &base, gen, COMMIT_KEY, ID, 0, "!!!", true).is_err());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_refused_final_chunk_removes_its_temp_and_keeps_the_target() {
        let base = scratch("refused-final");
        let gate = Store2Gate::new();
        let old = gate.register(Duration::from_secs(1)).unwrap();
        let ops = Hooked::plain();
        // Chunk 0 lands before the page's generation goes stale.
        write_top_chunk_with(&ops, &gate, &base, old, COMMIT_KEY, ID, 0, b"gh", false).unwrap();
        assert_eq!(names_in(&base), vec!["risu-write-0123456789abcdef.tmp"]);
        let new = gate.register(Duration::from_secs(1)).unwrap();
        write_top_with(&Hooked::plain(), &gate, &base, new, COMMIT_KEY, b"newer").unwrap();

        assert_stale(write_top_chunk_with(&ops, &gate, &base, old, COMMIT_KEY, ID, 2, b"ost", true));

        assert_eq!(names_in(&base), vec![COMMIT_KEY]);
        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"newer");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_stale_non_final_chunk_is_refused_early_and_removes_its_temp() {
        let base = scratch("refused-middle");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let ops = Hooked::plain();
        write_top_chunk_with(&ops, &gate, &base, gen, COMMIT_KEY, ID, 0, b"ab", false).unwrap();
        gate.register(Duration::from_secs(1)).unwrap();

        assert_stale(write_top_chunk_with(&ops, &gate, &base, gen, COMMIT_KEY, ID, 2, b"cd", false));

        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_stale_chunk_zero_is_refused_before_it_creates_a_temp_and_leaves_a_temp_in_place() {
        let base = scratch("chunk-zero");
        let gate = Store2Gate::new();
        let (old, _) = registered_twice(&gate);
        let temp = base.join("risu-write-0123456789abcdef.tmp");
        fs::write(&temp, b"found in place").unwrap();
        let ops = Hooked::plain();

        // Chunk 0 that is also the last chunk, and a chunk 0 that is not.
        assert_stale(write_top_chunk_with(&ops, &gate, &base, old, COMMIT_KEY, ID, 0, b"x", true));
        assert_stale(write_top_chunk_with(&ops, &gate, &base, old, COMMIT_KEY, ID, 0, b"x", false));

        assert!(ops.steps().is_empty());
        assert_eq!(fs::read(&temp).unwrap(), b"found in place");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_current_chunk_zero_fails_on_a_temp_in_place_and_leaves_it() {
        let base = scratch("chunk-zero-occupied");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let temp = base.join("risu-write-0123456789abcdef.tmp");
        fs::write(&temp, b"found in place").unwrap();

        assert!(write_top_chunk_with(&Hooked::plain(), &gate, &base, gen, COMMIT_KEY, ID, 0, b"x", true).is_err());

        assert_eq!(fs::read(&temp).unwrap(), b"found in place");
        assert!(!base.join(COMMIT_KEY).exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_generation_bumped_after_the_temp_is_written_is_still_refused_in_a_single_write() {
        let base = scratch("barrier-single");
        let gate = Arc::new(Store2Gate::new());
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let bumper = Arc::clone(&gate);
        let ops = Hooked::new(move |step| {
            if step == "create_synced" {
                bumper.register(Duration::from_secs(5)).unwrap();
            }
        });

        assert_stale(write_top_with(&ops, &gate, &base, gen, COMMIT_KEY, b"ghost"));

        assert!(names_in(&base).is_empty());
        assert!(!ops.steps().contains(&"rename"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_generation_bumped_after_the_last_chunk_is_appended_is_still_refused() {
        let base = scratch("barrier-chunk");
        let gate = Arc::new(Store2Gate::new());
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let bumper = Arc::clone(&gate);
        let appends = AtomicUsize::new(0);
        let ops = Hooked::new(move |step| {
            if step == "append" && appends.fetch_add(1, Ordering::SeqCst) == 1 {
                bumper.register(Duration::from_secs(5)).unwrap();
            }
        });
        write_top_chunk_with(&ops, &gate, &base, gen, COMMIT_KEY, ID, 0, b"ab", false).unwrap();

        assert_stale(write_top_chunk_with(&ops, &gate, &base, gen, COMMIT_KEY, ID, 2, b"cd", true));

        assert!(names_in(&base).is_empty());
        assert!(!ops.steps().contains(&"rename"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_lock_is_held_through_the_flush_the_rename_and_the_directory_flush() {
        let base = scratch("held");
        let gate = Arc::new(Store2Gate::new());
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let probe = Arc::clone(&gate);
        let probes: Arc<Mutex<Vec<(String, bool)>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&probes);
        let ops = Hooked::new(move |step| {
            if matches!(step, "sync_file" | "rename" | "sync_dir") {
                let refused = probe.register(Duration::from_millis(30)).is_err();
                seen.lock().unwrap().push((step.to_string(), refused));
            }
        });

        write_top_with(&ops, &gate, &base, gen, COMMIT_KEY, b"bytes").unwrap();

        let probes = probes.lock().unwrap().clone();
        assert_eq!(
            probes,
            vec![("sync_file".to_string(), true), ("rename".to_string(), true), ("sync_dir".to_string(), true)]
        );
        // No probe issued a generation.
        assert_eq!(gate.register(Duration::from_secs(1)).unwrap(), gen + 1);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_registration_waits_until_the_target_holds_the_bytes_and_the_directory_flush_ran() {
        let base = scratch("waits");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let (reached_tx, reached_rx) = mpsc::channel::<()>();
        let (go_tx, go_rx) = mpsc::channel::<()>();
        let reached_tx = Mutex::new(reached_tx);
        let go_rx = Mutex::new(go_rx);
        let ops = Hooked::new(move |step| {
            if step == "sync_dir" {
                reached_tx.lock().unwrap().send(()).unwrap();
                go_rx.lock().unwrap().recv().unwrap();
            }
        });
        let target = base.join(COMMIT_KEY);

        std::thread::scope(|scope| {
            let writer = scope.spawn(|| write_top_with(&ops, &gate, &base, gen, COMMIT_KEY, b"landed"));
            reached_rx.recv().unwrap();
            let registrar = scope.spawn(|| {
                let issued = gate.register(Duration::from_secs(30));
                let flushed = ops.steps().contains(&"sync_dir_done");
                (issued, flushed, fs::read(&target).ok())
            });
            std::thread::sleep(Duration::from_millis(150));
            // The writer is released before any assertion, so a failure cannot leave it blocked.
            let returned_early = registrar.is_finished();
            go_tx.send(()).unwrap();
            assert!(writer.join().unwrap().unwrap());
            let (issued, flushed, bytes) = registrar.join().unwrap();
            assert!(!returned_early, "registration returned while a write held the gate");
            assert_eq!(issued.unwrap(), gen + 1);
            assert!(flushed, "registration returned before the directory flush ran");
            assert_eq!(bytes.unwrap(), b"landed");
        });
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_registration_times_out_while_the_lock_is_held_and_issues_nothing() {
        let gate = Store2Gate::new();
        let first = gate.register(Duration::from_secs(1)).unwrap();
        let held = gate.lock();

        let error = gate.register(Duration::from_millis(40)).unwrap_err();

        assert!(error.starts_with(TIMEOUT_PREFIX), "{}", error);
        assert_eq!(*held, first);
        assert_eq!(gate.mirror.load(Ordering::SeqCst), first);
        drop(held);
        assert_eq!(gate.register(Duration::from_secs(1)).unwrap(), first + 1);
    }

    #[test]
    fn a_poisoned_gate_recovers() {
        let gate = Arc::new(Store2Gate::new());
        let first = gate.register(Duration::from_secs(1)).unwrap();
        let poisoner = Arc::clone(&gate);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.current.lock().unwrap();
            panic!("poison the gate");
        })
        .join();
        assert!(gate.current.is_poisoned());

        let second = gate.register(Duration::from_secs(1)).unwrap();
        assert_eq!(second, first + 1);
        let base = scratch("poisoned");
        write_top_with(&Hooked::plain(), &gate, &base, second, COMMIT_KEY, b"after poison").unwrap();
        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"after poison");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn only_the_commit_key_and_the_fence_are_written_through_the_gate() {
        let base = scratch("top-keys");
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        for key in ["store2/u1", "blocks/head", "store2-commit2", "Store2-Commit", "assets/a", "../store2-commit"] {
            let ops = Hooked::plain();
            let single = write_top_with(&ops, &gate, &base, gen, key, b"x").unwrap_err();
            assert!(single.starts_with(KEY_PREFIX), "{}: {}", key, single);
            let chunk = write_top_chunk_with(&ops, &gate, &base, gen, key, ID, 0, b"x", true).unwrap_err();
            assert!(chunk.starts_with(KEY_PREFIX), "{}: {}", key, chunk);
            assert!(ops.steps().is_empty());
        }
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    fn unit_tree(base: &Path) {
        fs::create_dir_all(base.join("store2")).unwrap();
        fs::write(base.join("store2").join("u1"), b"1").unwrap();
        fs::write(base.join("store2").join("u2"), b"2").unwrap();
        fs::write(base.join(FENCE_KEY), b"fence").unwrap();
        fs::write(base.join(COMMIT_KEY), b"commit").unwrap();
    }

    #[test]
    fn a_current_removal_removes_the_keys_and_reports_each() {
        let base = scratch("remove");
        unit_tree(&base);
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let keys: Vec<String> = ["store2/u1", "store2/missing", FENCE_KEY].iter().map(|k| k.to_string()).collect();

        let report = remove_with(&gate, &base, gen, &keys).unwrap();

        assert_eq!(
            report,
            json!([
                { "key": "store2/u1", "outcome": "removed" },
                { "key": "store2/missing", "outcome": "removed" },
                { "key": FENCE_KEY, "outcome": "removed" },
            ])
        );
        assert!(!base.join("store2").join("u1").exists());
        assert!(base.join("store2").join("u2").exists());
        assert!(!base.join(FENCE_KEY).exists());
        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"commit");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_removal_that_fails_for_one_key_reports_it_and_continues() {
        let base = scratch("remove-failed");
        unit_tree(&base);
        fs::create_dir_all(base.join("store2").join("dir")).unwrap();
        fs::write(base.join("store2").join("dir").join("inner"), b"x").unwrap();
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        let keys: Vec<String> = ["store2/dir", "store2/u2"].iter().map(|k| k.to_string()).collect();

        let report = remove_with(&gate, &base, gen, &keys).unwrap();

        let entries = report.as_array().unwrap();
        assert_eq!(entries[0]["key"], "store2/dir");
        assert_eq!(entries[0]["outcome"], "failed");
        assert!(entries[0]["error"].is_string());
        assert_eq!(entries[1], json!({ "key": "store2/u2", "outcome": "removed" }));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_stale_removal_removes_nothing() {
        let base = scratch("remove-stale");
        unit_tree(&base);
        let gate = Store2Gate::new();
        let (old, _) = registered_twice(&gate);
        let keys: Vec<String> = ["store2/u1", "store2/u2", FENCE_KEY].iter().map(|k| k.to_string()).collect();

        let error = remove_with(&gate, &base, old, &keys).unwrap_err();

        assert!(error.starts_with(STALE_PREFIX), "{}", error);
        assert!(base.join("store2").join("u1").exists());
        assert!(base.join("store2").join("u2").exists());
        assert!(base.join(FENCE_KEY).exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_removal_refuses_the_commit_key_and_other_keys_before_removing_anything() {
        let base = scratch("remove-refused");
        unit_tree(&base);
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();
        for refused in [COMMIT_KEY, "blocks/head", "store2", "store2/", "assets/a", "Store2-Fence"] {
            let keys = vec!["store2/u1".to_string(), refused.to_string()];
            let error = remove_with(&gate, &base, gen, &keys).unwrap_err();
            assert!(error.starts_with(KEY_PREFIX), "{}: {}", refused, error);
        }
        assert!(base.join("store2").join("u1").exists());
        assert_eq!(fs::read(base.join(COMMIT_KEY)).unwrap(), b"commit");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_traversal_key_under_the_unit_prefix_is_refused_by_the_key_rules() {
        let outer = scratch("remove-traversal");
        let base = outer.join("base");
        fs::create_dir_all(&base).unwrap();
        fs::write(outer.join("outside"), b"keep").unwrap();
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(1)).unwrap();

        let report = remove_with(&gate, &base, gen, &["store2/../../outside".to_string()]).unwrap();

        assert_eq!(report[0]["outcome"], "failed");
        assert_eq!(fs::read(outer.join("outside")).unwrap(), b"keep");
        fs::remove_dir_all(&outer).unwrap();
    }

    #[test]
    fn the_ungated_guards_name_the_gated_keys_without_regard_to_case() {
        for key in [COMMIT_KEY, FENCE_KEY, "Store2-Commit", "STORE2-FENCE"] {
            assert!(ungated_write_refusal(key).is_some(), "{}", key);
            assert!(ungated_remove_refusal(key).is_some(), "{}", key);
        }
        for key in ["store2/u1", "store2/sub/u1", "Store2/u1", "STORE2/risu-write-0123456789abcde.tmp"] {
            assert!(ungated_remove_refusal(key).is_some(), "{}", key);
        }
        assert!(ungated_write_refusal("store2/u1").is_none());
        assert!(ungated_write_refusal("store2-commits").is_none());
        for key in ["store2/risu-write-0123456789abcdef.tmp", "store2/sub/risu-write-0123456789abcdef.tmp", "blocks/head", "store2x/u1", "store2"] {
            assert!(ungated_remove_refusal(key).is_none(), "{}", key);
        }
    }

    #[test]
    fn the_ungated_write_commands_refuse_the_gated_keys_on_every_chunk() {
        let base = scratch("bypass-write");
        for key in [COMMIT_KEY, FENCE_KEY] {
            assert!(crate::durable_write::write_key_durable(&base, key, b"x").unwrap_err().starts_with("refused key:"));
            for (offset, last) in [(0u64, false), (0, true), (2, false), (2, true)] {
                // As the destination itself.
                let refused = crate::chunked_io::write_chunk_key(&base, key, ID, offset, "eA==", last, true, None);
                assert!(refused.unwrap_err().starts_with("refused key:"), "{} {}", key, offset);
                // As the final key of a write under another key.
                let refused = crate::chunked_io::write_chunk_key(&base, "blocks/x", ID, offset, "eA==", last, true, Some(key));
                assert!(refused.unwrap_err().starts_with("refused key:"), "{} {}", key, offset);
                let headers = crate::asset_batch::RawChunkHeaders {
                    key: key.to_string(),
                    id: ID.to_string(),
                    offset,
                    last,
                    durable: true,
                    final_key: None,
                };
                assert!(matches!(
                    crate::asset_batch::write_chunk_raw_with(&RealOps, &base, &headers, b"x"),
                    crate::asset_batch::Outcome::Invalid(_)
                ));
                let headers = crate::asset_batch::RawChunkHeaders {
                    key: "blocks/x".to_string(),
                    final_key: Some(key.to_string()),
                    ..headers
                };
                assert!(matches!(
                    crate::asset_batch::write_chunk_raw_with(&RealOps, &base, &headers, b"x"),
                    crate::asset_batch::Outcome::Invalid(_)
                ));
            }
        }
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_ungated_remove_command_refuses_the_gated_keys_but_not_a_swept_temp() {
        let base = scratch("bypass-remove");
        unit_tree(&base);
        let temp = "store2/risu-write-0123456789abcdef.tmp";
        fs::write(base.join("store2").join("risu-write-0123456789abcdef.tmp"), b"t").unwrap();

        for key in [COMMIT_KEY, FENCE_KEY, "store2/u1"] {
            assert!(app_fs::remove_key_guarded(&base, key).unwrap_err().starts_with("refused key:"), "{}", key);
        }
        assert!(base.join(COMMIT_KEY).exists() && base.join(FENCE_KEY).exists());
        assert!(base.join("store2").join("u1").exists());
        app_fs::remove_key_guarded(&base, temp).unwrap();
        assert!(!base.join("store2").join("risu-write-0123456789abcdef.tmp").exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_generation_header_is_a_decimal_number() {
        let mut headers = tauri::http::HeaderMap::new();
        assert!(generation_from_headers(&headers).unwrap_err().starts_with("malformed:"));
        for bad in ["", "-1", "1.5", "0x1", "99999999999999999999999"] {
            headers.insert(GENERATION_HEADER, tauri::http::HeaderValue::from_str(bad).unwrap());
            assert!(generation_from_headers(&headers).unwrap_err().starts_with("malformed:"), "{:?}", bad);
        }
        headers.insert(GENERATION_HEADER, tauri::http::HeaderValue::from_static("7"));
        assert_eq!(generation_from_headers(&headers).unwrap(), 7);
        headers.insert(KEY_HEADER, tauri::http::HeaderValue::from_static("store2-commit"));
        assert_eq!(top_write_headers(&headers).unwrap(), (7, "store2-commit".to_string()));
    }
}
