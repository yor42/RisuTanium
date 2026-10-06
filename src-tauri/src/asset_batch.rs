//! Batched asset I/O under `<app data>/assets/` for the desktop .bin restore
//! and export. Keys are store keys (`assets/<name>`), never paths: the base is
//! always the app data directory.
//!
//! Writes: every file goes to a new temp file in its target's directory, is
//! flushed (`sync_all`), and is renamed over the target, so a reader sees the
//! old file, no file, or the complete new one. After the renames the directory
//! of every renamed file and the parent of every directory this call created
//! are flushed (best effort, as in `durable_write`). A call that fails before
//! any write (a body that is not raw, a malformed body) writes nothing.
//!
//! Rules: a written key must start with `assets/`, pass the creatable rules of
//! `durable_write::key_violation`, and pass the lexical guard. A read key must
//! start with `assets/`, pass the addressable rules (`addressable_violation`,
//! the mirror of `tauriAddressableViolation` in
//! `src/ts/storage/store/keyRules.ts`), and pass the same lexical guard.
//!
//! Error text may hold absolute paths; it is for the console, not for the UI.

use crate::durable_write::{is_temp_name, rename_with_retry, resolve_key, FileOps, RealOps};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

const ASSET_PREFIX: &str = "assets/";
const ASSET_DIR: &str = "assets";

/// Worker threads a batch write may use.
const MAX_WORKERS: usize = 4;

const STATUS_OK: u8 = 0;
const STATUS_MISSING: u8 = 1;
const STATUS_INVALID: u8 = 2;
const STATUS_ERROR: u8 = 3;

/// What one frame of a write call came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Ok,
    Invalid(String),
    Error(String),
}

impl Outcome {
    fn to_json(&self) -> Value {
        match self {
            Outcome::Ok => json!({ "k": "ok" }),
            Outcome::Invalid(reason) => json!({ "k": "invalid", "reason": reason }),
            Outcome::Error(message) => json!({ "k": "error", "message": message }),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The bytes of a raw request body. Any other body (the postMessage fallback
/// sends JSON) is refused with a `not-raw:` error before any disk access.
pub fn raw_body(body: &tauri::ipc::InvokeBody) -> Result<&[u8], String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        _ => Err("not-raw: the request body is not raw bytes".to_string()),
    }
}

// ---------------------------------------------------------------------------
// Key rules
// ---------------------------------------------------------------------------

/// Why `key` may not be read, or `None` when it may. Mirrors
/// `tauriAddressableViolation` in `src/ts/storage/store/keyRules.ts` (without
/// its `prefix` mode): not empty, no NUL, not absolute, no drive prefix, and on
/// Windows no `:`; no empty, `.` or `..` segment, where on Windows a segment
/// ends at `\` as well as `/`.
pub fn addressable_violation(key: &str, windows: bool) -> Option<&'static str> {
    if key.is_empty() {
        return Some("a key is a non-empty string");
    }
    if key.contains('\0') {
        return Some("a key holds no NUL");
    }
    let bytes = key.as_bytes();
    if key.starts_with('/')
        || key.starts_with('\\')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
    {
        return Some("a key is relative to the app data directory");
    }
    if windows && key.contains(':') {
        return Some("a key holds no : on Windows");
    }
    for segment in key.split(|c| c == '/' || (windows && c == '\\')) {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Some("a key has no empty, . or .. segment");
        }
    }
    None
}

fn is_dot_or_space_only(segment: &str) -> bool {
    segment.chars().all(|c| c == '.' || c == ' ')
}

/// The path of an asset key under `base`, after the lexical guard: the key
/// starts with `assets/`, no segment is made only of dots and spaces, and the
/// joined path holds no `..` and stays under `<base>/assets`. The caller has
/// applied the creatable or the addressable rules first.
fn guarded_asset_path(base: &Path, key: &str, windows: bool) -> Result<PathBuf, String> {
    if !key.starts_with(ASSET_PREFIX) {
        return Err("a key starts with assets/".to_string());
    }
    let mut path = base.to_path_buf();
    for segment in key.split(|c| c == '/' || (windows && c == '\\')) {
        if is_dot_or_space_only(segment) {
            return Err("a key has no segment made only of dots and spaces".to_string());
        }
        path.push(segment);
    }
    let root = base.join(ASSET_DIR);
    let escapes = path.components().any(|c| matches!(c, Component::ParentDir));
    if escapes || !path.starts_with(&root) || path == root {
        return Err("a key stays under the assets directory".to_string());
    }
    Ok(path)
}

/// The target of a write, or the reason the key is refused.
fn prepare_put(base: &Path, key: &str) -> Result<PathBuf, String> {
    if !key.starts_with(ASSET_PREFIX) {
        return Err("a key starts with assets/".to_string());
    }
    let resolved = resolve_key(base, key)?;
    let guarded = guarded_asset_path(base, key, false)?;
    debug_assert_eq!(resolved, guarded);
    Ok(guarded)
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

struct Frame {
    key: String,
    start: usize,
    end: usize,
}

fn malformed(why: &str) -> String {
    format!("malformed: {}", why)
}

fn read_u32(body: &[u8], at: usize) -> Option<u32> {
    let bytes = body.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// Parses the whole body with exact consumption: a truncated frame, a key that
/// is not UTF-8 or bytes left over after the last frame make the call fail.
fn parse_frames(body: &[u8]) -> Result<Vec<Frame>, String> {
    let mut frames = Vec::new();
    let mut at = 0usize;
    while at < body.len() {
        let key_len = read_u32(body, at).ok_or_else(|| malformed("truncated key length"))? as usize;
        at += 4;
        let key_end = at
            .checked_add(key_len)
            .filter(|end| *end <= body.len())
            .ok_or_else(|| malformed("truncated key"))?;
        let key = std::str::from_utf8(&body[at..key_end])
            .map_err(|_| malformed("a key is not valid UTF-8"))?
            .to_string();
        at = key_end;
        let data_len = read_u32(body, at).ok_or_else(|| malformed("truncated data length"))? as usize;
        at += 4;
        let data_end = at
            .checked_add(data_len)
            .filter(|end| *end <= body.len())
            .ok_or_else(|| malformed("truncated data"))?;
        frames.push(Frame { key, start: at, end: data_end });
        at = data_end;
    }
    Ok(frames)
}

/// Directories this call has seen or created. A directory is recorded as
/// created only by the call that made it, so the parent flush covers exactly
/// the new directory entries.
struct DirState {
    inner: Mutex<DirInner>,
}

struct DirInner {
    known: HashSet<PathBuf>,
    created: Vec<PathBuf>,
}

impl DirState {
    fn new() -> Self {
        DirState { inner: Mutex::new(DirInner { known: HashSet::new(), created: Vec::new() }) }
    }

    fn ensure<O: FileOps>(&self, ops: &O, dir: &Path) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        if inner.known.contains(dir) {
            return Ok(());
        }
        let mut missing: Vec<PathBuf> = Vec::new();
        for ancestor in dir.ancestors() {
            if ancestor.as_os_str().is_empty() || inner.known.contains(ancestor) || ancestor.exists() {
                break;
            }
            missing.push(ancestor.to_path_buf());
        }
        if !missing.is_empty() {
            ops.create_dir_all(dir)
                .map_err(|e| format!("failed to create {}: {}", dir.display(), e))?;
        }
        missing.reverse();
        for created in missing {
            inner.known.insert(created.clone());
            inner.created.push(created);
        }
        inner.known.insert(dir.to_path_buf());
        Ok(())
    }
}

/// Writes one file: temp in the target's directory, flush, rename. Returns the
/// target's directory on success. On failure the target is untouched and the
/// call's own temp is removed.
fn write_one<O: FileOps>(ops: &O, dirs: &DirState, target: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let directory = target
        .parent()
        .ok_or_else(|| "the target has no parent directory".to_string())?;
    dirs.ensure(ops, directory)?;
    let temp = directory.join(ops.temp_name());
    if let Err(error) = ops.create_synced(&temp, bytes) {
        // An existing temp is not this call's file and is left alone.
        if error.kind() != io::ErrorKind::AlreadyExists {
            let _ = ops.remove(&temp);
        }
        return Err(format!("failed to write {}: {}", temp.display(), error));
    }
    if let Err(error) = rename_with_retry(ops, &temp, target) {
        let _ = ops.remove(&temp);
        return Err(format!("failed to rename {} to {}: {}", temp.display(), target.display(), error));
    }
    Ok(directory.to_path_buf())
}

struct Entry<'a> {
    key: String,
    data: &'a [u8],
}

/// The key a write is routed by. Keys that differ only in letter case, as the
/// upper-case then lower-case round trip sees it (`ſ` and `s`, `ς` and `σ`,
/// `µ` and `μ` meet), share a route. Unicode normalization is not applied here.
fn route_key(key: &str) -> String {
    key.to_uppercase().to_lowercase()
}

/// Writes `entries` and returns one outcome per entry in input order. Entries
/// with the same route (`route_key`) are written one after another by one
/// worker in input order, so the last of them is what stays on disk. Aliases
/// that `route_key` does not merge are written on separate workers in no
/// defined order.
fn write_entries<O: FileOps + Sync>(ops: &O, base: &Path, entries: &[Entry<'_>], max_workers: usize) -> Vec<Outcome> {
    let mut outcomes: Vec<Option<Outcome>> = vec![None; entries.len()];
    let mut targets: Vec<Option<PathBuf>> = vec![None; entries.len()];
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut group_of: HashMap<String, usize> = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        match prepare_put(base, &entry.key) {
            Err(reason) => outcomes[index] = Some(Outcome::Invalid(reason)),
            Ok(target) => {
                targets[index] = Some(target);
                let group = *group_of.entry(route_key(&entry.key)).or_insert_with(|| {
                    groups.push(Vec::new());
                    groups.len() - 1
                });
                groups[group].push(index);
            }
        }
    }

    let dirs = DirState::new();
    let touched: Mutex<BTreeSet<PathBuf>> = Mutex::new(BTreeSet::new());
    let results: Mutex<Vec<Option<Outcome>>> = Mutex::new(outcomes);
    let next = AtomicUsize::new(0);
    let workers = max_workers.max(1).min(groups.len()).max(1);
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let group = next.fetch_add(1, Ordering::SeqCst);
                if group >= groups.len() {
                    break;
                }
                for &index in &groups[group] {
                    let target = targets[index].as_ref().expect("a grouped entry has a target");
                    let outcome = match write_one(ops, &dirs, target, entries[index].data) {
                        Ok(directory) => {
                            lock(&touched).insert(directory);
                            Outcome::Ok
                        }
                        Err(message) => {
                            eprintln!("asset write failed for {}: {}", entries[index].key, message);
                            Outcome::Error(message)
                        }
                    };
                    lock(&results)[index] = Some(outcome);
                }
            });
        }
    });

    // The renames are done. Flush each directory that received one, then the
    // parent of each directory this call created; both are best effort.
    let mut flushed: BTreeSet<PathBuf> = BTreeSet::new();
    for directory in lock(&touched).iter() {
        if flushed.insert(directory.clone()) {
            if let Err(error) = ops.sync_dir(directory) {
                eprintln!("directory flush after rename failed for {}: {}", directory.display(), error);
            }
        }
    }
    for created in lock(&dirs.inner).created.iter() {
        if let Some(parent) = created.parent() {
            if flushed.insert(parent.to_path_buf()) {
                if let Err(error) = ops.sync_dir(parent) {
                    eprintln!("directory flush for a new directory failed for {}: {}", parent.display(), error);
                }
            }
        }
    }

    results
        .into_inner()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .into_iter()
        .map(|outcome| outcome.unwrap_or_else(|| Outcome::Error("the entry was not processed".to_string())))
        .collect()
}

/// The outcomes of a batch body, or a `malformed:` error with nothing written.
pub fn put_batch_with<O: FileOps + Sync>(
    ops: &O,
    base: &Path,
    body: &[u8],
    max_workers: usize,
) -> Result<Vec<Outcome>, String> {
    let frames = parse_frames(body)?;
    let entries: Vec<Entry<'_>> = frames
        .into_iter()
        .map(|frame| Entry { key: frame.key, data: &body[frame.start..frame.end] })
        .collect();
    Ok(write_entries(ops, base, &entries, max_workers))
}

/// The outcome of one write.
pub fn put_single_with<O: FileOps + Sync>(ops: &O, base: &Path, key: &str, data: &[u8]) -> Outcome {
    let entries = [Entry { key: key.to_string(), data }];
    write_entries(ops, base, &entries, 1)
        .into_iter()
        .next()
        .unwrap_or_else(|| Outcome::Error("the entry was not processed".to_string()))
}

pub fn put_assets_batch(base: &Path, body: &[u8]) -> Result<Value, String> {
    let outcomes = put_batch_with(&RealOps, base, body, MAX_WORKERS)?;
    Ok(Value::Array(outcomes.iter().map(Outcome::to_json).collect()))
}

pub fn put_asset_single(base: &Path, key: &str, data: &[u8]) -> Value {
    put_single_with(&RealOps, base, key, data).to_json()
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/// A frame length as the u32 the format holds; a longer value is refused, not truncated.
fn frame_length(len: u64) -> Result<u32, String> {
    u32::try_from(len).map_err(|_| format!("the file is {} bytes, more than a frame can hold", len))
}

fn push_frame(out: &mut Vec<u8>, status: u8, bytes: &[u8]) {
    out.push(status);
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

/// Appends an ok frame holding the file's bytes to `out`, reading straight into
/// it. `Ok(false)` means the file is absent and `out` is unchanged. On `Err`
/// `out` is cut back to its length on entry. The size limit is checked against
/// the file's metadata before any byte is read, and again against what was read.
fn read_frame_into(out: &mut Vec<u8>, path: &Path, max_len: u64) -> Result<bool, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("failed to open {}: {}", path.display(), error)),
    };
    let metadata = file
        .metadata()
        .map_err(|e| format!("failed to stat {}: {}", path.display(), e))?;
    if metadata.len() > max_len {
        return Err(match frame_length(metadata.len()) {
            Err(message) => message,
            Ok(_) => format!("the file is {} bytes, over the limit of {}", metadata.len(), max_len),
        });
    }
    let start = out.len();
    out.push(STATUS_OK);
    out.extend_from_slice(&[0u8; 4]);
    out.reserve(metadata.len() as usize);
    let read = file.take(max_len.saturating_add(1)).read_to_end(out);
    let length = out.len() - start - 5;
    let outcome = match read {
        Err(error) => Err(format!("failed to read {}: {}", path.display(), error)),
        Ok(_) => match frame_length(length as u64) {
            Ok(frame) if length as u64 <= max_len => {
                out[start + 1..start + 5].copy_from_slice(&frame.to_le_bytes());
                Ok(true)
            }
            _ => Err(format!("the file grew to over {} bytes while it was read", max_len)),
        },
    };
    if outcome.is_err() {
        out.truncate(start);
    }
    outcome
}

/// The response of a read call: one frame per key in key order,
/// `[u8 status][u32 LE len][bytes]`. `max_len` is the largest file a frame may
/// hold; the command passes `u32::MAX`.
pub fn get_batch_with(base: &Path, keys: &[String], windows: bool, max_len: u64) -> Vec<u8> {
    let max_len = max_len.min(u64::from(u32::MAX));
    let mut out = Vec::new();
    for key in keys {
        if let Some(reason) = addressable_violation(key, windows) {
            push_frame(&mut out, STATUS_INVALID, reason.as_bytes());
            continue;
        }
        let path = match guarded_asset_path(base, key, windows) {
            Ok(path) => path,
            Err(reason) => {
                push_frame(&mut out, STATUS_INVALID, reason.as_bytes());
                continue;
            }
        };
        match read_frame_into(&mut out, &path, max_len) {
            Ok(true) => {}
            Ok(false) => push_frame(&mut out, STATUS_MISSING, &[]),
            Err(message) => {
                eprintln!("asset read failed for {}: {}", key, message);
                push_frame(&mut out, STATUS_ERROR, message.as_bytes());
            }
        }
    }
    out
}

pub fn get_assets_batch(base: &Path, keys: &[String]) -> Vec<u8> {
    get_batch_with(base, keys, cfg!(windows), u64::from(u32::MAX))
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/// Appends the keys under `directory` in the order `std::fs::read_dir` gives,
/// descending into a subdirectory at its own position. A name that is not UTF-8
/// is skipped; a temp-file name is hidden at every depth; a symbolic link is
/// listed only while it resolves and is never entered.
fn collect(directory: &Path, key_prefix: &str, out: &mut Vec<(String, u64)>) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("failed to read directory {}: {}", directory.display(), error)),
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let Ok(name) = entry.file_name().into_string() else { continue };
        let file_type = entry.file_type();
        let key = format!("{}/{}", key_prefix, name);
        let (is_file, is_dir, is_symlink) = match &file_type {
            Ok(kind) => (kind.is_file(), kind.is_dir(), kind.is_symlink()),
            Err(_) => (false, false, false),
        };
        if is_dir {
            collect(&entry.path(), &key, out)?;
        } else if is_temp_name(&name) {
            continue;
        } else if is_file {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((key, size));
        } else if is_symlink {
            if let Ok(metadata) = fs::metadata(entry.path()) {
                out.push((key, metadata.len()));
            }
        }
    }
    Ok(())
}

pub fn list_assets_sized(base: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut out = Vec::new();
    collect(&base.join(ASSET_DIR), ASSET_DIR, &mut out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu-asset-batch-{}-{}", name, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn frame(key: &str, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(key.len() as u32).to_le_bytes());
        out.extend_from_slice(key.as_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(data);
        out
    }

    fn body(entries: &[(&str, &[u8])]) -> Vec<u8> {
        entries.iter().flat_map(|(key, data)| frame(key, data)).collect()
    }

    /// Every file under `dir`, relative with `/`, sorted.
    fn tree(dir: &Path) -> Vec<String> {
        fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
            let Ok(entries) = fs::read_dir(dir) else { return };
            for entry in entries {
                let entry = entry.unwrap();
                let name = entry.file_name().to_string_lossy().into_owned();
                let rel = if prefix.is_empty() { name } else { format!("{}/{}", prefix, name) };
                if entry.file_type().unwrap().is_dir() {
                    out.push(format!("{}/", rel));
                    walk(&entry.path(), &rel, out);
                } else {
                    out.push(rel);
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, "", &mut out);
        out.sort();
        out
    }

    fn temps_in(dir: &Path) -> Vec<String> {
        tree(dir).into_iter().filter(|p| is_temp_name(p.rsplit('/').next().unwrap())).collect()
    }

    /// The real file system with optional faults, a record of steps and an
    /// optional delay that scrambles the order in which workers finish.
    #[derive(Default)]
    struct Probe {
        /// `create_synced` fails when the payload equals this; a cut temp is left behind.
        fail_write_payload: Option<Vec<u8>>,
        /// `create_synced` fails after the whole payload was written (the flush failed).
        fail_sync_payload: Option<Vec<u8>>,
        /// `rename` fails when the target's file name equals this.
        fail_rename_name: Option<String>,
        scramble: bool,
        created: Mutex<HashSet<PathBuf>>,
        dir_flushes: Mutex<Vec<PathBuf>>,
        removes: Mutex<Vec<PathBuf>>,
        create_dirs: Mutex<Vec<PathBuf>>,
    }

    impl FileOps for Probe {
        fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
            if self.scramble {
                let first = bytes.first().copied().unwrap_or(0) as u64;
                std::thread::sleep(Duration::from_millis(40u64.saturating_sub(first)));
            }
            if self.fail_write_payload.as_deref() == Some(bytes) {
                fs::write(temp, &bytes[..bytes.len() / 2])?;
                return Err(io::Error::new(io::ErrorKind::Other, "disk full"));
            }
            if self.fail_sync_payload.as_deref() == Some(bytes) {
                fs::write(temp, bytes)?;
                return Err(io::Error::new(io::ErrorKind::Other, "sync failed"));
            }
            RealOps.create_synced(temp, bytes)?;
            lock(&self.created).insert(temp.to_path_buf());
            Ok(())
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            // A rename of a temp that was not written and flushed first is a defect.
            assert!(lock(&self.created).contains(from), "renamed a temp that was never written and flushed");
            if self.fail_rename_name.as_deref() == to.file_name().and_then(|n| n.to_str()) {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "rename blocked"));
            }
            RealOps.rename(from, to)
        }
        fn sync_dir(&self, dir: &Path) -> io::Result<()> {
            lock(&self.dir_flushes).push(dir.to_path_buf());
            RealOps.sync_dir(dir)
        }
        fn remove(&self, path: &Path) -> io::Result<()> {
            lock(&self.removes).push(path.to_path_buf());
            RealOps.remove(path)
        }
        fn sleep_ms(&self, _ms: u64) {}
        fn temp_name(&self) -> String {
            RealOps.temp_name()
        }
        fn create_dir_all(&self, dir: &Path) -> io::Result<()> {
            lock(&self.create_dirs).push(dir.to_path_buf());
            fs::create_dir_all(dir)
        }
    }

    fn put(base: &Path, entries: &[(&str, &[u8])]) -> Vec<Outcome> {
        put_batch_with(&Probe::default(), base, &body(entries), MAX_WORKERS).unwrap()
    }

    // ----- parsing and call errors ------------------------------------------------

    #[test]
    fn a_well_formed_body_writes_every_file_and_answers_in_input_order() {
        let base = scratch("basic");
        let results = put(&base, &[("assets/a", b"one"), ("assets/d/e/b", b"two"), ("assets/c", b"")]);
        assert_eq!(results, vec![Outcome::Ok, Outcome::Ok, Outcome::Ok]);
        assert_eq!(fs::read(base.join("assets").join("a")).unwrap(), b"one");
        assert_eq!(fs::read(base.join("assets").join("d").join("e").join("b")).unwrap(), b"two");
        assert_eq!(fs::read(base.join("assets").join("c")).unwrap(), b"");
        assert!(temps_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn an_empty_body_is_an_empty_result() {
        let base = scratch("empty");
        assert_eq!(put_batch_with(&Probe::default(), &base, &[], MAX_WORKERS).unwrap(), vec![]);
        assert!(tree(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_malformed_body_is_a_call_error_and_nothing_is_written() {
        let base = scratch("malformed");
        let good = frame("assets/a", b"abc");
        let mut cases: Vec<Vec<u8>> = Vec::new();
        // Trailing bytes too short for a frame.
        cases.push([good.clone(), vec![1, 0]].concat());
        // Key length beyond the body.
        cases.push([good.clone(), 99u32.to_le_bytes().to_vec(), b"x".to_vec()].concat());
        // Data length beyond the body.
        let mut cut = frame("assets/b", b"abcdef");
        cut.truncate(cut.len() - 2);
        cases.push([good.clone(), cut].concat());
        // Missing data length.
        let mut no_len = good.clone();
        no_len.extend_from_slice(&4u32.to_le_bytes());
        no_len.extend_from_slice(b"abcd");
        cases.push(no_len);
        // Key that is not UTF-8.
        let mut bad_utf8 = Vec::new();
        bad_utf8.extend_from_slice(&2u32.to_le_bytes());
        bad_utf8.extend_from_slice(&[0xFF, 0xFE]);
        bad_utf8.extend_from_slice(&0u32.to_le_bytes());
        cases.push([good.clone(), bad_utf8].concat());
        // A length that would overflow when added to the position.
        let mut huge = Vec::new();
        huge.extend_from_slice(&u32::MAX.to_le_bytes());
        cases.push([good.clone(), huge].concat());
        for case in cases {
            let error = put_batch_with(&Probe::default(), &base, &case, MAX_WORKERS).unwrap_err();
            assert!(error.starts_with("malformed:"), "{}", error);
        }
        assert!(tree(&base).is_empty(), "a call error must leave the disk alone");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_body_that_is_not_raw_is_refused_with_the_not_raw_prefix() {
        for value in [serde_json::json!([1, 2, 3]), serde_json::json!({ "a": 1 }), serde_json::Value::Null] {
            let error = raw_body(&tauri::ipc::InvokeBody::Json(value)).unwrap_err();
            assert!(error.starts_with("not-raw:"), "{}", error);
        }
        let raw = tauri::ipc::InvokeBody::Raw(vec![1, 2, 3]);
        assert_eq!(raw_body(&raw).unwrap(), &[1, 2, 3]);
    }

    // ----- key rules --------------------------------------------------------------

    #[test]
    fn put_refuses_keys_outside_assets_or_failing_the_creatable_rules_and_writes_the_rest() {
        let base = scratch("put-rules");
        let refused = [
            "blocks/head",
            "head",
            "../x",
            "assets/../blocks/x",
            "assets/.x",
            "assets/a/.x",
            "assets/",
            "assets",
            "/assets/a",
            "assets//a",
            "assets/a/",
            "assets/a\\b",
            "assets/a:b",
            "assets/a<b",
            "assets/a.",
            "assets/a ",
            "assets/ ",
            "assets/...",
            "assets/. .",
            "assets/risu-write-0123456789abcdef.tmp",
            "C:/assets/a",
            "",
        ];
        let mut entries: Vec<(&str, &[u8])> = refused.iter().map(|k| (*k, b"x".as_slice())).collect();
        entries.push(("assets/ok", b"fine"));
        let results = put(&base, &entries);
        for (index, key) in refused.iter().enumerate() {
            assert!(matches!(results[index], Outcome::Invalid(_)), "should refuse {:?}: {:?}", key, results[index]);
        }
        assert_eq!(results[refused.len()], Outcome::Ok);
        assert_eq!(tree(&base), vec!["assets/", "assets/ok"]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn dot_and_space_only_segments_are_refused_by_the_guard_for_both_directions() {
        let base = PathBuf::from("base");
        for key in ["assets/ ", "assets/..", "assets/ .", "assets/a/ /b", "assets/a/.../b", "assets/."] {
            assert!(guarded_asset_path(&base, key, false).is_err(), "should refuse {:?}", key);
        }
        for key in ["assets/a", "assets/a/b.c", "assets/a.", "assets/x y"] {
            assert!(guarded_asset_path(&base, key, false).is_ok(), "should accept {:?}", key);
        }
        assert!(guarded_asset_path(&base, "blocks/x", false).is_err());
        assert!(guarded_asset_path(&base, "assets", false).is_err());
    }

    #[test]
    fn a_refused_key_in_the_middle_does_not_stop_the_others_and_results_keep_input_order() {
        let base = scratch("mid");
        let results = put(&base, &[("assets/a", b"1"), ("blocks/x", b"2"), ("assets/c", b"3"), ("assets/.d", b"4")]);
        assert_eq!(results[0], Outcome::Ok);
        assert!(matches!(results[1], Outcome::Invalid(_)));
        assert_eq!(results[2], Outcome::Ok);
        assert!(matches!(results[3], Outcome::Invalid(_)));
        assert!(!base.join("blocks").exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn addressable_rules_mirror_the_page_rules_on_each_platform() {
        // Both platforms.
        for windows in [false, true] {
            for key in ["", "/assets/a", "\\assets\\a", "C:x", "c:/x", "assets//a", "assets/./a", "assets/../a", "assets/a/", "assets\0a"] {
                assert!(addressable_violation(key, windows).is_some(), "should refuse {:?} (windows={})", key, windows);
            }
            for key in ["assets/a", "assets/a.", "assets/a b", "assets/.hidden", "assets/a<b", "assets/x/y.png"] {
                assert!(addressable_violation(key, windows).is_none(), "should accept {:?} (windows={})", key, windows);
            }
        }
        // Windows splits on both separators and refuses a colon.
        assert!(addressable_violation("assets/a\\..\\b", true).is_some());
        assert!(addressable_violation("assets\\a", true).is_none());
        assert!(addressable_violation("assets/a\\\\b", true).is_some());
        assert!(addressable_violation("assets/a:b", true).is_some());
        assert!(addressable_violation("assets/a::$DATA", true).is_some());
        // POSIX keeps a backslash and a colon as ordinary characters.
        assert!(addressable_violation("assets/a\\..\\b", false).is_none());
        assert!(addressable_violation("assets/a:b", false).is_none());
    }

    #[test]
    fn the_addressable_set_is_wider_than_the_creatable_set() {
        // Names upstream stored stay readable: a trailing dot, a leading dot, a colon on POSIX.
        let base = scratch("wide");
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("hash."), b"empty extension").unwrap();
        fs::write(assets.join(".hidden"), b"dot").unwrap();
        let keys = vec!["assets/hash.".to_string(), "assets/.hidden".to_string()];
        let out = get_batch_with(&base, &keys, false, u64::from(u32::MAX));
        let frames = read_frames(&out);
        assert_eq!(frames[0], (STATUS_OK, b"empty extension".to_vec()));
        assert_eq!(frames[1], (STATUS_OK, b"dot".to_vec()));
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- faults -----------------------------------------------------------------

    fn fault_run(probe: Probe, k_payload: &[u8]) -> (PathBuf, Vec<Outcome>, Probe) {
        let base = scratch("fault");
        let assets = base.join("assets");
        fs::create_dir_all(assets.join("d")).unwrap();
        fs::write(assets.join("d").join("k"), b"old bytes of k").unwrap();
        let entries: Vec<(&str, &[u8])> = vec![
            ("assets/d/a", b"payload a"),
            ("assets/d/b", b"payload b"),
            ("assets/d/k", k_payload),
            ("assets/d/c", b"payload c"),
            ("assets/e/d", b"payload d"),
        ];
        let results = put_batch_with(&probe, &base, &body(&entries), MAX_WORKERS).unwrap();
        (base, results, probe)
    }

    fn assert_k_failed_others_fine(base: &Path, results: &[Outcome]) {
        assert!(matches!(results[2], Outcome::Error(_)), "{:?}", results[2]);
        for index in [0, 1, 3, 4] {
            assert_eq!(results[index], Outcome::Ok);
        }
        let assets = base.join("assets");
        assert_eq!(fs::read(assets.join("d").join("k")).unwrap(), b"old bytes of k");
        assert_eq!(fs::read(assets.join("d").join("a")).unwrap(), b"payload a");
        assert_eq!(fs::read(assets.join("d").join("b")).unwrap(), b"payload b");
        assert_eq!(fs::read(assets.join("d").join("c")).unwrap(), b"payload c");
        assert_eq!(fs::read(assets.join("e").join("d")).unwrap(), b"payload d");
        assert!(temps_in(base).is_empty(), "no temp may remain: {:?}", temps_in(base));
    }

    #[test]
    fn a_write_fault_on_one_entry_removes_its_temp_keeps_its_target_and_spares_the_others() {
        let probe = Probe { fail_write_payload: Some(b"new k that fails".to_vec()), ..Probe::default() };
        let (base, results, probe) = fault_run(probe, b"new k that fails");
        assert_k_failed_others_fine(&base, &results);
        assert_eq!(lock(&probe.removes).len(), 1);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_flush_fault_on_one_entry_removes_its_complete_temp_and_keeps_its_target() {
        let probe = Probe { fail_sync_payload: Some(b"new k unsynced".to_vec()), ..Probe::default() };
        let (base, results, _) = fault_run(probe, b"new k unsynced");
        assert_k_failed_others_fine(&base, &results);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_rename_fault_on_one_entry_removes_its_temp_keeps_its_target_and_spares_the_others() {
        let probe = Probe { fail_rename_name: Some("k".to_string()), ..Probe::default() };
        let (base, results, _) = fault_run(probe, b"new k renamed");
        assert_k_failed_others_fine(&base, &results);
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_rename_blocked_by_another_handle_is_retried_and_then_succeeds() {
        struct Blocked(AtomicUsize);
        impl FileOps for Blocked {
            fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
                RealOps.create_synced(temp, bytes)
            }
            fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
                if self.0.fetch_add(1, Ordering::SeqCst) < 3 {
                    return Err(io::Error::from_raw_os_error(32));
                }
                RealOps.rename(from, to)
            }
            fn sync_dir(&self, dir: &Path) -> io::Result<()> {
                RealOps.sync_dir(dir)
            }
            fn remove(&self, path: &Path) -> io::Result<()> {
                RealOps.remove(path)
            }
            fn sleep_ms(&self, _ms: u64) {}
            fn temp_name(&self) -> String {
                RealOps.temp_name()
            }
        }
        let base = scratch("retry");
        let outcome = put_single_with(&Blocked(AtomicUsize::new(0)), &base, "assets/a", b"bytes");
        assert_eq!(outcome, Outcome::Ok);
        assert_eq!(fs::read(base.join("assets").join("a")).unwrap(), b"bytes");
        assert!(temps_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_directory_that_cannot_be_created_is_an_error_for_that_entry_only() {
        let base = scratch("not-a-dir");
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("blocker"), b"i am a file").unwrap();
        let results = put(&base, &[("assets/blocker/x", b"1"), ("assets/y", b"2")]);
        assert!(matches!(results[0], Outcome::Error(_)), "{:?}", results[0]);
        assert_eq!(results[1], Outcome::Ok);
        assert_eq!(fs::read(assets.join("blocker")).unwrap(), b"i am a file");
        assert!(temps_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn every_written_file_is_flushed_before_its_rename_and_replaces_an_existing_target() {
        let base = scratch("replace");
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("a"), b"old").unwrap();
        let probe = Probe::default();
        let results = put_batch_with(&probe, &base, &body(&[("assets/a", b"new longer"), ("assets/b", b"b")]), 4).unwrap();
        assert_eq!(results, vec![Outcome::Ok, Outcome::Ok]);
        assert_eq!(fs::read(assets.join("a")).unwrap(), b"new longer");
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- directory flushes ------------------------------------------------------

    #[test]
    fn touched_directories_and_the_parents_of_new_directories_are_flushed() {
        let base = scratch("flush");
        let probe = Probe::default();
        let results = put_batch_with(&probe, &base, &body(&[("assets/gen/x", b"bytes")]), 4).unwrap();
        assert_eq!(results, vec![Outcome::Ok]);
        // The target directory, then the parent of `assets` (the base) and `assets` itself.
        let flushes = lock(&probe.dir_flushes).clone();
        assert_eq!(flushes.len(), 1 + 2, "{:?}", flushes);
        assert!(flushes.contains(&base.join("assets").join("gen")));
        assert!(flushes.contains(&base));
        assert!(flushes.contains(&base.join("assets")));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn each_directory_is_flushed_once_and_an_existing_directory_adds_no_parent_flush() {
        let base = scratch("flush-once");
        fs::create_dir_all(base.join("assets").join("d")).unwrap();
        let probe = Probe::default();
        let entries = [("assets/d/a", b"1".as_slice()), ("assets/d/b", b"2"), ("assets/d/c", b"3"), ("assets/top", b"4")];
        put_batch_with(&probe, &base, &body(&entries), 4).unwrap();
        let mut flushes = lock(&probe.dir_flushes).clone();
        flushes.sort();
        assert_eq!(flushes, vec![base.join("assets"), base.join("assets").join("d")]);
        assert!(lock(&probe.create_dirs).is_empty(), "existing directories are not created again");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_directory_shared_by_many_entries_is_created_once() {
        let base = scratch("shared-dir");
        let probe = Probe::default();
        let names: Vec<String> = (0..20).map(|i| format!("assets/x/y/f{}", i)).collect();
        let entries: Vec<(&str, &[u8])> = names.iter().map(|n| (n.as_str(), b"z".as_slice())).collect();
        put_batch_with(&probe, &base, &body(&entries), 4).unwrap();
        assert_eq!(lock(&probe.create_dirs).len(), 1);
        // assets/x/y created: the parents of assets, x and y plus y itself.
        assert_eq!(lock(&probe.dir_flushes).len(), 1 + 3);
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- order, duplicates, workers ----------------------------------------------

    #[test]
    fn results_stay_in_input_order_when_workers_finish_out_of_order() {
        let base = scratch("order");
        let names: Vec<String> = (0..40).map(|i| format!("assets/f{:02}", i)).collect();
        let datas: Vec<Vec<u8>> = (0..40u8).map(|i| vec![i, i, i]).collect();
        let mut entries: Vec<(&str, &[u8])> = names.iter().zip(&datas).map(|(n, d)| (n.as_str(), d.as_slice())).collect();
        entries.insert(7, ("blocks/bad", b"x"));
        entries.insert(20, ("assets/.bad", b"x"));
        let probe = Probe { scramble: true, ..Probe::default() };
        let results = put_batch_with(&probe, &base, &body(&entries), 4).unwrap();
        assert_eq!(results.len(), entries.len());
        for (index, (key, data)) in entries.iter().enumerate() {
            if key.contains("bad") {
                assert!(matches!(results[index], Outcome::Invalid(_)), "{}", key);
            } else {
                assert_eq!(results[index], Outcome::Ok, "{}", key);
                assert_eq!(fs::read(base.join(key)).unwrap(), *data);
            }
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_last_duplicate_key_in_input_order_wins_even_with_several_workers() {
        let base = scratch("dup");
        for round in 0..10 {
            let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
            for i in 0..12 {
                entries.push((format!("assets/other{}", i), vec![i as u8]));
            }
            entries.insert(1, ("assets/dup".to_string(), b"first".to_vec()));
            entries.insert(6, ("assets/dup".to_string(), b"second".to_vec()));
            entries.push(("assets/dup".to_string(), format!("last{}", round).into_bytes()));
            let refs: Vec<(&str, &[u8])> = entries.iter().map(|(k, d)| (k.as_str(), d.as_slice())).collect();
            let probe = Probe { scramble: true, ..Probe::default() };
            let results = put_batch_with(&probe, &base, &body(&refs), 4).unwrap();
            assert!(results.iter().all(|r| *r == Outcome::Ok));
            assert_eq!(fs::read(base.join("assets").join("dup")).unwrap(), format!("last{}", round).into_bytes());
        }
        assert!(temps_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn keys_that_differ_only_by_case_are_written_in_input_order_by_one_worker() {
        let base = scratch("case");
        let entries: Vec<(&str, &[u8])> = vec![("assets/Same", b"upper"), ("assets/same", b"lower")];
        let results = put(&base, &entries);
        assert_eq!(results, vec![Outcome::Ok, Outcome::Ok]);
        // On a case-insensitive file system the second write is what stays.
        let on_disk = tree(&base.join("assets"));
        if on_disk.len() == 1 {
            assert_eq!(fs::read(base.join("assets").join("Same")).unwrap(), b"lower");
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_single_write_stores_the_data_and_refuses_a_bad_key() {
        let base = scratch("single");
        assert_eq!(put_single_with(&Probe::default(), &base, "assets/n/big", &[7u8; 300_000]), Outcome::Ok);
        assert_eq!(fs::read(base.join("assets").join("n").join("big")).unwrap(), vec![7u8; 300_000]);
        assert!(matches!(put_single_with(&Probe::default(), &base, "blocks/head", b"x"), Outcome::Invalid(_)));
        assert!(!base.join("blocks").exists());
        let json = put_asset_single(&base, "assets/../x", b"x");
        assert_eq!(json["k"], "invalid");
        assert!(json["reason"].is_string());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_json_shape_of_each_outcome_is_the_contract() {
        assert_eq!(Outcome::Ok.to_json(), json!({ "k": "ok" }));
        assert_eq!(Outcome::Invalid("r".into()).to_json(), json!({ "k": "invalid", "reason": "r" }));
        assert_eq!(Outcome::Error("m".into()).to_json(), json!({ "k": "error", "message": "m" }));
        let base = scratch("json");
        let value = put_assets_batch(&base, &body(&[("assets/a", b"1"), ("x", b"2")])).unwrap();
        assert_eq!(value[0], json!({ "k": "ok" }));
        assert_eq!(value[1]["k"], "invalid");
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- read -------------------------------------------------------------------

    fn read_frames(out: &[u8]) -> Vec<(u8, Vec<u8>)> {
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

    #[test]
    fn get_answers_one_frame_per_key_in_key_order_with_each_status() {
        let base = scratch("get");
        let assets = base.join("assets");
        fs::create_dir_all(assets.join("dir")).unwrap();
        fs::write(assets.join("a"), b"alpha").unwrap();
        fs::write(assets.join("empty"), b"").unwrap();
        let keys: Vec<String> = ["assets/a", "assets/nope", "blocks/head", "assets/empty", "../x", "assets/dir", "assets/a"]
            .iter()
            .map(|k| k.to_string())
            .collect();
        let frames = read_frames(&get_batch_with(&base, &keys, false, u64::from(u32::MAX)));
        assert_eq!(frames.len(), keys.len());
        assert_eq!(frames[0], (STATUS_OK, b"alpha".to_vec()));
        assert_eq!(frames[1], (STATUS_MISSING, vec![]));
        assert_eq!(frames[2].0, STATUS_INVALID);
        assert!(!frames[2].1.is_empty());
        assert_eq!(frames[3], (STATUS_OK, vec![]));
        assert_eq!(frames[4].0, STATUS_INVALID);
        assert_eq!(frames[5].0, STATUS_ERROR, "a directory holds no value");
        assert!(!frames[5].1.is_empty());
        assert_eq!(frames[6], (STATUS_OK, b"alpha".to_vec()));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn get_refuses_traversal_dot_only_segments_and_non_assets_keys() {
        let base = scratch("get-refuse");
        fs::write(base.join("secret"), b"top secret").unwrap();
        fs::create_dir_all(base.join("assets")).unwrap();
        let keys: Vec<String> = [
            "assets/../secret",
            "../secret",
            "assets/..",
            "assets/ ",
            "assets/...",
            "assets/a/../../secret",
            "blocks/head",
            "assets",
            "assets/",
            "/etc/passwd",
            "",
        ]
        .iter()
        .map(|k| k.to_string())
        .collect();
        for windows in [false, true] {
            let frames = read_frames(&get_batch_with(&base, &keys, windows, u64::from(u32::MAX)));
            assert_eq!(frames.len(), keys.len());
            for (index, frame) in frames.iter().enumerate() {
                assert_eq!(frame.0, STATUS_INVALID, "{:?} (windows={})", keys[index], windows);
            }
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn get_on_a_windows_platform_refuses_backslash_traversal_and_colons() {
        let base = scratch("get-win");
        let keys: Vec<String> = ["assets/a\\..\\..\\secret", "assets/a:b", "assets/a::$DATA", "assets\\a", "assets/x\\"]
            .iter()
            .map(|k| k.to_string())
            .collect();
        let frames = read_frames(&get_batch_with(&base, &keys, true, u64::from(u32::MAX)));
        for (index, frame) in frames.iter().enumerate() {
            assert_eq!(frame.0, STATUS_INVALID, "{:?}", keys[index]);
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_length_over_the_frame_limit_is_refused_and_never_truncated() {
        assert_eq!(frame_length(0).unwrap(), 0);
        assert_eq!(frame_length(u64::from(u32::MAX)).unwrap(), u32::MAX);
        assert!(frame_length(u64::from(u32::MAX) + 1).is_err());
        assert!(frame_length(u64::MAX).is_err());

        let base = scratch("limit");
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("fits"), vec![1u8; 10]).unwrap();
        fs::write(assets.join("big"), vec![2u8; 11]).unwrap();
        let keys: Vec<String> = ["assets/fits", "assets/big"].iter().map(|k| k.to_string()).collect();
        let frames = read_frames(&get_batch_with(&base, &keys, false, 10));
        assert_eq!(frames[0], (STATUS_OK, vec![1u8; 10]));
        assert_eq!(frames[1].0, STATUS_ERROR);
        assert_ne!(frames[1].1.len(), 11, "the bytes are not sent truncated or whole");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_refused_file_in_the_middle_leaves_the_frames_around_it_intact() {
        let base = scratch("limit-middle");
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let first: Vec<u8> = (0..=255u8).cycle().take(3_000_000).collect();
        fs::write(assets.join("first"), &first).unwrap();
        fs::write(assets.join("big"), vec![9u8; 4_000_001]).unwrap();
        fs::write(assets.join("last"), b"tail").unwrap();
        let keys: Vec<String> = ["assets/first", "assets/big", "assets/gone", "assets/last"]
            .iter()
            .map(|k| k.to_string())
            .collect();
        let frames = read_frames(&get_batch_with(&base, &keys, false, 4_000_000));
        assert_eq!(frames.len(), 4);
        assert_eq!(frames[0], (STATUS_OK, first));
        assert_eq!(frames[1].0, STATUS_ERROR);
        assert!(frames[1].1.len() < 200, "an error frame holds a message, not the file");
        assert_eq!(frames[2], (STATUS_MISSING, vec![]));
        assert_eq!(frames[3], (STATUS_OK, b"tail".to_vec()));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_route_merges_letter_case_variants_that_a_plain_lowercase_keeps_apart() {
        for (a, b) in [("assets/\u{17f}.png", "assets/s.png"), ("assets/\u{3c2}", "assets/\u{3c3}"), ("assets/\u{b5}", "assets/\u{3bc}"), ("assets/A", "assets/a")] {
            assert_eq!(route_key(a), route_key(b), "{:?} and {:?}", a, b);
        }
        assert_ne!(route_key("assets/a"), route_key("assets/b"));
    }

    #[test]
    fn the_last_of_two_keys_that_meet_in_the_case_round_trip_wins_in_input_order() {
        for round in 0..10 {
            let base = scratch("long-s");
            let mut entries: Vec<(String, Vec<u8>)> = (0..12).map(|i| (format!("assets/o{}", i), vec![i as u8])).collect();
            entries.insert(2, ("assets/\u{17f}.png".to_string(), b"long s first".to_vec()));
            entries.push(("assets/s.png".to_string(), format!("s last {}", round).into_bytes()));
            let refs: Vec<(&str, &[u8])> = entries.iter().map(|(k, d)| (k.as_str(), d.as_slice())).collect();
            let probe = Probe { scramble: true, ..Probe::default() };
            let results = put_batch_with(&probe, &base, &body(&refs), 4).unwrap();
            assert!(results.iter().all(|r| *r == Outcome::Ok));
            // On a file system that treats the two names as one file, the later entry is what stays.
            let s = base.join("assets").join("s.png");
            let long_s = base.join("assets").join("\u{17f}.png");
            let same_file = fs::read_dir(base.join("assets")).unwrap().filter(|e| {
                let name = e.as_ref().unwrap().file_name().to_string_lossy().into_owned();
                name.ends_with(".png")
            }).count() == 1;
            if same_file {
                assert_eq!(fs::read(if s.exists() { &s } else { &long_s }).unwrap(), format!("s last {}", round).into_bytes());
            }
            fs::remove_dir_all(&base).unwrap();
        }
    }

    #[test]
    fn a_batch_written_by_put_reads_back_identically() {
        let base = scratch("roundtrip");
        let payload: Vec<u8> = (0..=255u8).cycle().take(100_000).collect();
        let entries: Vec<(&str, &[u8])> = vec![("assets/h1", &payload), ("assets/sub/h2", b"two"), ("assets/h3", b"")];
        assert!(put(&base, &entries).iter().all(|r| *r == Outcome::Ok));
        let keys: Vec<String> = entries.iter().map(|(k, _)| k.to_string()).collect();
        let frames = read_frames(&get_assets_batch(&base, &keys));
        for (index, (_, data)) in entries.iter().enumerate() {
            assert_eq!(frames[index], (STATUS_OK, data.to_vec()));
        }
        fs::remove_dir_all(&base).unwrap();
    }

    // ----- list -------------------------------------------------------------------

    #[test]
    fn list_of_a_missing_assets_directory_is_empty() {
        let base = scratch("list-none");
        assert_eq!(list_assets_sized(&base).unwrap(), vec![]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn list_gives_keys_sizes_and_hides_temp_files_at_every_depth() {
        let base = scratch("list");
        let assets = base.join("assets");
        fs::create_dir_all(assets.join("d").join("e")).unwrap();
        fs::write(assets.join("a"), b"12345").unwrap();
        fs::write(assets.join("risu-write-0123456789abcdef.tmp"), b"top temp").unwrap();
        fs::write(assets.join("d").join("b"), b"").unwrap();
        fs::write(assets.join("d").join("risu-write-fedcba9876543210.tmp"), b"nested temp").unwrap();
        fs::write(assets.join("d").join("e").join("c"), b"abc").unwrap();
        fs::write(assets.join("d").join("e").join("risu-write-00000000000000aa.tmp"), b"deep temp").unwrap();
        // Names that only resemble the temp pattern are real files.
        fs::write(assets.join("risu-write-ABCDEF0123456789.tmp"), b"upper").unwrap();
        fs::write(assets.join("risu-write-0123456789abcdef.tmp.bak"), b"bak").unwrap();

        let listed = list_assets_sized(&base).unwrap();
        let mut sorted = listed.clone();
        sorted.sort();
        assert_eq!(
            sorted,
            vec![
                ("assets/a".to_string(), 5),
                ("assets/d/b".to_string(), 0),
                ("assets/d/e/c".to_string(), 3),
                ("assets/risu-write-0123456789abcdef.tmp.bak".to_string(), 3),
                ("assets/risu-write-ABCDEF0123456789.tmp".to_string(), 5),
            ]
        );
        // A directory's keys are contiguous at the directory's own position.
        let d_positions: Vec<usize> = listed.iter().enumerate().filter(|(_, (k, _))| k.starts_with("assets/d/")).map(|(i, _)| i).collect();
        assert_eq!(d_positions.last().unwrap() - d_positions.first().unwrap() + 1, d_positions.len());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn list_follows_read_dir_order_with_depth_first_recursion() {
        let base = scratch("list-order");
        let assets = base.join("assets");
        for dir in ["x", "m/n", "z"] {
            fs::create_dir_all(assets.join(dir)).unwrap();
        }
        for file in ["x/1", "m/n/2", "m/3", "z/4", "5", "6"] {
            fs::write(assets.join(file), file.as_bytes()).unwrap();
        }
        fn reference(dir: &Path, prefix: &str, out: &mut Vec<String>) {
            for entry in fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let key = format!("{}/{}", prefix, entry.file_name().to_string_lossy());
                if entry.file_type().unwrap().is_dir() {
                    reference(&entry.path(), &key, out);
                } else {
                    out.push(key);
                }
            }
        }
        let mut expected = Vec::new();
        reference(&assets, "assets", &mut expected);
        let listed: Vec<String> = list_assets_sized(&base).unwrap().into_iter().map(|(k, _)| k).collect();
        assert_eq!(listed, expected);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_directory_named_like_a_temp_file_is_entered() {
        let base = scratch("list-temp-dir");
        let dir = base.join("assets").join("risu-write-0123456789abcdef.tmp");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("inner"), b"x").unwrap();
        let listed = list_assets_sized(&base).unwrap();
        assert_eq!(listed, vec![("assets/risu-write-0123456789abcdef.tmp/inner".to_string(), 1)]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_failure_other_than_absence_is_a_list_error() {
        let base = scratch("list-file");
        fs::write(base.join("assets"), b"i am a file").unwrap();
        assert!(list_assets_sized(&base).is_err());
        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn list_skips_names_that_are_not_utf8() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let base = scratch("list-utf8");
        let assets = base.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("good"), b"x").unwrap();
        if fs::write(assets.join(OsStr::from_bytes(b"bad\xff")), b"y").is_err() {
            fs::remove_dir_all(&base).unwrap();
            return;
        }
        let listed: Vec<String> = list_assets_sized(&base).unwrap().into_iter().map(|(k, _)| k).collect();
        assert_eq!(listed, vec!["assets/good".to_string()]);
        fs::remove_dir_all(&base).unwrap();
    }

    fn try_symlink(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            if target.is_dir() {
                std::os::windows::fs::symlink_dir(target, link).is_ok()
            } else {
                std::os::windows::fs::symlink_file(target, link).is_ok()
            }
        }
    }

    #[test]
    fn list_keeps_a_resolving_symlink_drops_a_dangling_one_and_never_enters_a_linked_directory() {
        let base = scratch("list-links");
        let assets = base.join("assets");
        let outside = base.join("outside");
        fs::create_dir_all(&assets).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("leak"), b"must not be listed").unwrap();
        fs::write(outside.join("target"), b"1234").unwrap();
        let file_link = try_symlink(&outside.join("target"), &assets.join("file-link"));
        let dangling = try_symlink(&outside.join("missing"), &assets.join("dangling"));
        let dir_link = try_symlink(&outside, &assets.join("dir-link"));
        if !(file_link && dangling && dir_link) {
            // Creating links needs a privilege some platforms withhold.
            eprintln!(
                "NOTE: symlink listing test not exercised: this OS refused to create links (file {}, dangling {}, dir {})",
                file_link, dangling, dir_link
            );
            fs::remove_dir_all(&base).unwrap();
            return;
        }
        let listed = list_assets_sized(&base).unwrap();
        let keys: Vec<&str> = listed.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"assets/file-link"), "{:?}", keys);
        assert!(!keys.contains(&"assets/dangling"), "{:?}", keys);
        assert!(!keys.iter().any(|k| k.contains("leak")), "{:?}", keys);
        fs::remove_dir_all(&base).unwrap();
    }
}
