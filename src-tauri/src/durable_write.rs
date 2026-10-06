//! Durable file replacement under the app data directory. The write itself is
//! std only; only `decode_body` names a Tauri type (the request body enum).
//!
//! A write goes to a new temp file in the target's own directory, is flushed to
//! the file system (`sync_all`), and is renamed over the target. A reader sees
//! the old file or the complete new one, never a partial one. After the rename
//! the directory entry is flushed; that flush is best-effort (a failure is
//! logged and the write still succeeds, because the rename has happened).
//!
//! The key rules repeat `creatableViolation` and `tauriCreatableViolation` in
//! `src/ts/storage/store/keyRules.ts`, plus the traversal rules of
//! `tauriAddressableViolation`. A key that fails them never reaches the disk.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The IPC header that carries the percent-encoded key.
pub const KEY_HEADER: &str = "x-risu-key";

const MAX_SEGMENT_BYTES: usize = 255;

/// Waits before each retry of a rename that a competing handle blocked.
const RENAME_RETRY_DELAYS_MS: [u64; 4] = [50, 100, 200, 400];

/// ERROR_ACCESS_DENIED and ERROR_SHARING_VIOLATION: a rename blocked by another handle.
const RETRYABLE_RENAME_ERRORS: [i32; 2] = [5, 32];

/// `ATOMIC_TEMP_NAME_PATTERN` in `src/ts/storage/tauriAtomicWrite.ts`:
/// `risu-write-` plus 16 lowercase hex digits plus `.tmp`.
pub fn is_temp_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("risu-write-") else {
        return false;
    };
    let Some(hex) = rest.strip_suffix(".tmp") else {
        return false;
    };
    hex.len() == 16 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Why `key` may not be written, or `None` when it may.
pub fn key_violation(key: &str) -> Option<&'static str> {
    if key.is_empty() {
        return Some("a key is a non-empty string");
    }
    if key.contains('\\') || key.chars().any(|c| (c as u32) < 0x20) {
        return Some("a key holds no backslash and no control character");
    }
    if key.starts_with('/') || key.ends_with('/') {
        return Some("a key does not start or end with /");
    }
    let bytes = key.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some("a key is relative to the app data directory");
    }
    let segments: Vec<&str> = key.split('/').collect();
    for segment in &segments {
        if segment.is_empty() {
            return Some("a key has no empty segment");
        }
        if segment.starts_with('.') {
            return Some("no segment of a key starts with .");
        }
    }
    if is_temp_name(segments[segments.len() - 1]) {
        return Some("the last segment is reserved for temporary files");
    }
    if key.chars().any(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*')) {
        return Some("a key holds none of < > : \" | ? *");
    }
    for segment in &segments {
        if segment.ends_with('.') || segment.ends_with(' ') {
            return Some("no segment of a key ends with a dot or a space");
        }
        if segment.len() > MAX_SEGMENT_BYTES {
            return Some("a segment is at most 255 UTF-8 bytes");
        }
    }
    None
}

/// Decodes the header value that `encodeURIComponent` produced. Only `%XX`
/// escapes are decoded; the result must be valid UTF-8.
pub fn decode_key_header(raw: &str) -> Result<String, String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = bytes
                .get(i + 1..i + 3)
                .and_then(|pair| std::str::from_utf8(pair).ok())
                .and_then(|pair| u8::from_str_radix(pair, 16).ok());
            match hex {
                Some(value) => out.push(value),
                None => return Err("the key header holds a bad escape".to_string()),
            }
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "the key header is not valid UTF-8".to_string())
}

/// The path of `key` under `base`, after the key rules. Every segment passed
/// the rules, so the result cannot leave `base`.
pub fn resolve_key(base: &Path, key: &str) -> Result<PathBuf, String> {
    if let Some(reason) = key_violation(key) {
        return Err(format!("refused key: {}", reason));
    }
    let mut path = base.to_path_buf();
    for segment in key.split('/') {
        path.push(segment);
    }
    Ok(path)
}

/// The steps of a write that can fail or be made to fail. `RealOps` is the
/// file system; a test substitutes its own to inject a fault at one step.
pub trait FileOps {
    /// Creates `temp` (it must not exist), writes `bytes` and flushes the file.
    fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()>;
    /// Creates `temp` (it must not exist) and leaves it empty.
    fn create_empty(&self, temp: &Path) -> io::Result<()>;
    /// Appends `bytes` to `temp` and closes it. `temp` must hold exactly `offset`
    /// bytes already; any other length is an error and nothing is written.
    fn append(&self, temp: &Path, offset: u64, bytes: &[u8]) -> io::Result<()>;
    /// Flushes the data of the file at `path` to the file system.
    fn sync_file(&self, path: &Path) -> io::Result<()>;
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn sync_dir(&self, dir: &Path) -> io::Result<()>;
    fn remove(&self, path: &Path) -> io::Result<()>;
    fn sleep_ms(&self, ms: u64);
    fn temp_name(&self) -> String;
    /// Creates `dir` and every missing ancestor. A substitute may override it to inject a fault.
    fn create_dir_all(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir_all(dir)
    }
}

pub struct RealOps;

impl FileOps for RealOps {
    fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
        let mut file = OpenOptions::new().write(true).create_new(true).open(temp)?;
        file.write_all(bytes)?;
        file.sync_all()
    }

    fn create_empty(&self, temp: &Path) -> io::Result<()> {
        OpenOptions::new().write(true).create_new(true).open(temp).map(|_| ())
    }

    fn append(&self, temp: &Path, offset: u64, bytes: &[u8]) -> io::Result<()> {
        let mut file = OpenOptions::new().append(true).open(temp)?;
        let length = file.metadata()?.len();
        if length != offset {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("the chunk starts at {} but the temp file holds {} bytes", offset, length),
            ));
        }
        file.write_all(bytes)
    }

    fn sync_file(&self, path: &Path) -> io::Result<()> {
        OpenOptions::new().write(true).open(path)?.sync_all()
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }

    #[cfg(windows)]
    fn sync_dir(&self, dir: &Path) -> io::Result<()> {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_BACKUP_SEMANTICS opens a directory handle.
        OpenOptions::new()
            .write(true)
            .custom_flags(0x0200_0000)
            .open(dir)?
            .sync_all()
    }

    #[cfg(not(windows))]
    fn sync_dir(&self, dir: &Path) -> io::Result<()> {
        fs::File::open(dir)?.sync_all()
    }

    fn remove(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }

    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }

    fn temp_name(&self) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        format!("risu-write-{}.tmp", &id[..16])
    }
}

fn is_retryable_rename_error(error: &io::Error) -> bool {
    cfg!(windows)
        && error
            .raw_os_error()
            .map_or(false, |code| RETRYABLE_RENAME_ERRORS.contains(&code))
}

pub(crate) fn rename_with_retry<O: FileOps>(ops: &O, from: &Path, to: &Path) -> io::Result<()> {
    let mut attempt = 0;
    loop {
        match ops.rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error) => {
                if attempt >= RENAME_RETRY_DELAYS_MS.len() || !is_retryable_rename_error(&error) {
                    return Err(error);
                }
            }
        }
        ops.sleep_ms(RENAME_RETRY_DELAYS_MS[attempt]);
        attempt += 1;
    }
}

/// Replaces the file at `target` with `bytes`, or creates it. `Err` means the
/// target was not replaced and the temp file was removed where possible. `Ok`
/// means the target holds `bytes` and the bytes were flushed before the rename.
pub fn write_durable_with<O: FileOps>(ops: &O, target: &Path, bytes: &[u8]) -> Result<(), String> {
    let directory = target
        .parent()
        .ok_or_else(|| "the target has no parent directory".to_string())?;
    // Directories this call creates, outermost first.
    let mut created: Vec<&Path> = Vec::new();
    for ancestor in directory.ancestors() {
        if ancestor.as_os_str().is_empty() || ancestor.exists() {
            break;
        }
        created.push(ancestor);
    }
    created.reverse();
    fs::create_dir_all(directory).map_err(|e| format!("failed to create {}: {}", directory.display(), e))?;
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
    if let Err(error) = ops.sync_dir(directory) {
        eprintln!("directory flush after rename failed for {}: {}", directory.display(), error);
    }
    // A directory created by this call has its own entry in its parent. Those
    // flushes are best-effort like the one above.
    for dir in created {
        if let Some(parent) = dir.parent() {
            if let Err(error) = ops.sync_dir(parent) {
                eprintln!("directory flush for a new directory failed for {}: {}", parent.display(), error);
            }
        }
    }
    Ok(())
}

/// The bytes of a request body. A raw body is the bytes. A JSON body must be an
/// array of integers 0 to 255, which is how the postMessage fallback sends a
/// `Uint8Array`. Anything else is rejected before any disk access.
pub fn decode_body(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(serde_json::Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_u64()
                    .and_then(|n| u8::try_from(n).ok())
                    .ok_or_else(|| "the body must be an array of byte values".to_string())
            })
            .collect(),
        _ => Err("the body must be raw bytes or an array of byte values".to_string()),
    }
}

pub fn write_durable(target: &Path, bytes: &[u8]) -> Result<(), String> {
    write_durable_with(&RealOps, target, bytes)
}

/// The command's whole job apart from reading the request: resolve the key
/// under `base` and write durably.
pub fn write_key_durable(base: &Path, key: &str, bytes: &[u8]) -> Result<(), String> {
    let target = resolve_key(base, key)?;
    write_durable(&target, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu-durable-test-{}-{}", name, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The real file system with an optional fault and a record of the order of steps.
    struct Faulty {
        fail_create: bool,
        fail_rename: Cell<u32>,
        rename_error_code: i32,
        fail_sync_dir: bool,
        steps: RefCell<Vec<&'static str>>,
        sleeps: RefCell<Vec<u64>>,
    }

    impl Faulty {
        fn new() -> Self {
            Faulty {
                fail_create: false,
                fail_rename: Cell::new(0),
                rename_error_code: 1,
                fail_sync_dir: false,
                steps: RefCell::new(Vec::new()),
                sleeps: RefCell::new(Vec::new()),
            }
        }
    }

    impl FileOps for Faulty {
        fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
            self.steps.borrow_mut().push("create_synced");
            if self.fail_create {
                // A cut file is left behind, as a full disk leaves one.
                fs::write(temp, &bytes[..bytes.len() / 2])?;
                return Err(io::Error::new(io::ErrorKind::Other, "disk full"));
            }
            RealOps.create_synced(temp, bytes)
        }
        fn create_empty(&self, temp: &Path) -> io::Result<()> {
            self.steps.borrow_mut().push("create_empty");
            RealOps.create_empty(temp)
        }
        fn append(&self, temp: &Path, offset: u64, bytes: &[u8]) -> io::Result<()> {
            self.steps.borrow_mut().push("append");
            RealOps.append(temp, offset, bytes)
        }
        fn sync_file(&self, path: &Path) -> io::Result<()> {
            self.steps.borrow_mut().push("sync_file");
            RealOps.sync_file(path)
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.steps.borrow_mut().push("rename");
            if self.fail_rename.get() > 0 {
                self.fail_rename.set(self.fail_rename.get() - 1);
                return Err(io::Error::from_raw_os_error(self.rename_error_code));
            }
            RealOps.rename(from, to)
        }
        fn sync_dir(&self, dir: &Path) -> io::Result<()> {
            self.steps.borrow_mut().push("sync_dir");
            if self.fail_sync_dir {
                return Err(io::Error::new(io::ErrorKind::Other, "flush failed"));
            }
            RealOps.sync_dir(dir)
        }
        fn remove(&self, path: &Path) -> io::Result<()> {
            self.steps.borrow_mut().push("remove");
            RealOps.remove(path)
        }
        fn sleep_ms(&self, ms: u64) {
            self.sleeps.borrow_mut().push(ms);
        }
        fn temp_name(&self) -> String {
            RealOps.temp_name()
        }
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_syncs_renames_then_flushes_the_directory_in_that_order() {
        let dir = scratch("order");
        let target = dir.join("a.bin");
        let ops = Faulty::new();

        write_durable_with(&ops, &target, b"new bytes").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new bytes");
        assert_eq!(*ops.steps.borrow(), vec!["create_synced", "rename", "sync_dir"]);
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn replaces_an_existing_file_and_creates_missing_directories() {
        let dir = scratch("replace");
        let target = dir.join("blocks").join("gen").join("c").join("x");
        write_durable(&target, b"one").unwrap();
        write_durable(&target, b"two-longer").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"two-longer");
        assert_eq!(names_in(target.parent().unwrap()), vec!["x"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failure_before_the_rename_rejects_keeps_the_old_bytes_and_removes_the_temp() {
        let dir = scratch("before-rename");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        let mut ops = Faulty::new();
        ops.fail_create = true;

        let result = write_durable_with(&ops, &target, b"new bytes that fail");

        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        assert!(!ops.steps.borrow().contains(&"rename"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_rename_failure_rejects_keeps_the_old_bytes_and_removes_the_temp() {
        let dir = scratch("rename-fails");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        let ops = Faulty::new();
        ops.fail_rename.set(1);

        let result = write_durable_with(&ops, &target, b"new bytes");

        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        assert!(!ops.steps.borrow().contains(&"sync_dir"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_directory_flush_failure_after_the_rename_still_resolves() {
        let dir = scratch("dir-flush");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        let mut ops = Faulty::new();
        ops.fail_sync_dir = true;

        write_durable_with(&ops, &target, b"new bytes").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"new bytes");
        assert_eq!(*ops.steps.borrow(), vec!["create_synced", "rename", "sync_dir"]);
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_real_directory_flush_does_not_fail_on_this_platform() {
        let dir = scratch("real-flush");
        RealOps.sync_dir(&dir).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_temp_name_matches_the_pattern_the_boot_sweep_uses() {
        for _ in 0..50 {
            assert!(is_temp_name(&RealOps.temp_name()));
        }
        assert!(!is_temp_name("risu-write-ABCDEF0123456789.tmp"));
        assert!(!is_temp_name("risu-write-0123456789abcde.tmp"));
        assert!(!is_temp_name("x-risu-write-0123456789abcdef.tmp"));
        assert!(!is_temp_name("risu-write-0123456789abcdef.tmp.bak"));
    }

    #[cfg(windows)]
    #[test]
    fn a_blocked_rename_is_retried_with_the_waits_and_then_succeeds() {
        let dir = scratch("retry");
        let target = dir.join("a.bin");
        let mut ops = Faulty::new();
        ops.rename_error_code = 32;
        ops.fail_rename.set(3);

        write_durable_with(&ops, &target, b"new bytes").unwrap();

        assert_eq!(*ops.sleeps.borrow(), vec![50, 100, 200]);
        assert_eq!(fs::read(&target).unwrap(), b"new bytes");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn a_rename_blocked_past_every_retry_rejects_and_removes_the_temp() {
        let dir = scratch("retry-exhausted");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        let mut ops = Faulty::new();
        ops.rename_error_code = 5;
        ops.fail_rename.set(100);

        assert!(write_durable_with(&ops, &target, b"new bytes").is_err());

        assert_eq!(*ops.sleeps.borrow(), vec![50, 100, 200, 400]);
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_refused_key_touches_nothing_on_disk() {
        let outer = scratch("refused");
        let base = outer.join("base");
        fs::create_dir_all(&base).unwrap();
        let refused = [
            "", "/abs", "a/", "/a", "a//b", "a/./b", "a/../b", "../x", "..", ".hidden", "a/.hidden",
            "C:x", "c:/x", "a\\b", "a\u{0}b", "a\nb", "x/a:b", "a<b", "a|b", "a?b", "a*b", "a\"b", "a>b",
            "a/b.", "a/b ", "blocks/risu-write-0123456789abcdef.tmp",
        ];
        for key in refused {
            assert!(key_violation(key).is_some(), "should refuse {:?}", key);
            assert!(write_key_durable(&base, key, b"x").is_err(), "should refuse {:?}", key);
        }
        let too_long = format!("a/{}", "x".repeat(256));
        assert!(write_key_durable(&base, &too_long, b"x").is_err());
        assert!(names_in(&base).is_empty());
        assert_eq!(names_in(&outer), vec!["base"]);
        fs::remove_dir_all(&outer).unwrap();
    }

    #[test]
    fn accepted_keys_resolve_under_the_base_directory() {
        let base = PathBuf::from("base");
        for key in [
            "blocks/head",
            "blocks/20261005-abc/c/6162",
            "database/dbbackup-17909517188.bin",
            "coldstorage/unit-1",
            "blocks/g/\u{d55c}\u{ae00}",
        ] {
            assert!(key_violation(key).is_none(), "should accept {:?}", key);
            assert!(resolve_key(&base, key).unwrap().starts_with(&base));
        }
    }

    #[test]
    fn write_key_durable_writes_under_the_base_directory() {
        let base = scratch("key");
        write_key_durable(&base, "blocks/gen/root", b"root bytes").unwrap();
        assert_eq!(fs::read(base.join("blocks").join("gen").join("root")).unwrap(), b"root bytes");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_raw_body_decodes_to_its_bytes() {
        let body = tauri::ipc::InvokeBody::Raw(vec![0, 1, 255]);
        assert_eq!(decode_body(&body).unwrap(), vec![0, 1, 255]);
    }

    #[test]
    fn a_json_array_of_byte_values_decodes_to_those_bytes() {
        let body = tauri::ipc::InvokeBody::Json(serde_json::json!([0, 7, 128, 255]));
        assert_eq!(decode_body(&body).unwrap(), vec![0, 7, 128, 255]);
        let empty = tauri::ipc::InvokeBody::Json(serde_json::json!([]));
        assert_eq!(decode_body(&empty).unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn a_malformed_body_is_rejected_and_a_write_after_it_touches_nothing() {
        let base = scratch("bad-body");
        let rejected = [
            serde_json::json!({ "a": 1 }),
            serde_json::json!("text"),
            serde_json::json!(5),
            serde_json::Value::Null,
            serde_json::json!([1, 256]),
            serde_json::json!([1, -1]),
            serde_json::json!([1, 2.5]),
            serde_json::json!([1, "2"]),
            serde_json::json!([1, null]),
            serde_json::json!([[1]]),
            serde_json::json!([true]),
        ];
        for value in rejected {
            let body = tauri::ipc::InvokeBody::Json(value.clone());
            let decoded = decode_body(&body);
            assert!(decoded.is_err(), "should reject {}", value);
            // The command writes only what decoded, so an Err stops before the disk.
            if let Ok(bytes) = decoded {
                write_key_durable(&base, "blocks/gen/x", &bytes).unwrap();
            }
        }
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn new_directories_are_flushed_into_their_parents() {
        let base = scratch("new-dirs");
        let target = base.join("blocks").join("gen").join("x");
        let ops = Faulty::new();

        write_durable_with(&ops, &target, b"bytes").unwrap();

        // The target directory, then the parent of `blocks` (the base) and `blocks` itself.
        let flushes = ops.steps.borrow().iter().filter(|s| **s == "sync_dir").count();
        assert_eq!(flushes, 1 + 2);
        assert_eq!(fs::read(&target).unwrap(), b"bytes");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_key_header_decodes_what_encode_uri_component_produces() {
        assert_eq!(decode_key_header("blocks%2Fgen%2Fc%2F6162").unwrap(), "blocks/gen/c/6162");
        assert_eq!(decode_key_header("a%20b%2Bc").unwrap(), "a b+c");
        assert_eq!(decode_key_header("%ED%95%9C").unwrap(), "\u{d55c}");
        assert!(decode_key_header("%").is_err());
        assert!(decode_key_header("%zz").is_err());
        assert!(decode_key_header("%FF").is_err());
    }

    #[test]
    fn an_encoded_traversal_is_refused_after_decoding() {
        let base = scratch("encoded");
        let key = decode_key_header("..%2F..%2Fx").unwrap();
        assert!(write_key_durable(&base, &key, b"x").is_err());
        let key = decode_key_header("%2Fetc%2Fx").unwrap();
        assert!(write_key_durable(&base, &key, b"x").is_err());
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }
}
