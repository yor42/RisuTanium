//! Byte transport for the page on Android: a durable or atomic write assembled
//! from base64 chunks, and a ranged read. Each call carries one bounded piece,
//! so no call moves a whole file through the IPC bridge.
//!
//! A chunked write appends to a temp file in the target's own directory (the
//! name `is_temp_name` accepts, so the listing hides it and the boot sweep
//! removes it) and renames it over the target on the last chunk. Until that
//! rename the target keeps its old bytes. For a durable key the file is flushed
//! before the rename, the target directory after it, and every directory the
//! write created is flushed into its parent, as `write_durable_with` does.
//! Non-durable keys add no flush.
//!
//! The write keys follow `resolve_key`; the read keys follow the addressable
//! rules of `tauriAddressableViolation` in `src/ts/storage/store/keyRules.ts`,
//! because the byte store reads keys that it would not create.

use crate::durable_write::{is_temp_name, rename_with_retry, resolve_key, FileOps, RealOps};
use base64::{engine::general_purpose, Engine as _};
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// The most bytes one chunk may carry once decoded.
pub const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;

/// The most bytes one ranged read returns, whatever the caller asked for.
pub const MAX_RANGE_BYTES: u64 = 32 * 1024 * 1024;

/// A ranged read answers the piece followed by this many bytes: seven
/// little-endian u64 values. The first is the file's total size. The six after it
/// are the file identity: device, inode, mtime seconds, mtime nanoseconds, ctime
/// seconds, ctime nanoseconds (zero where the platform has none). A page that
/// reads a file in pieces compares the whole trailer between pieces.
pub const TRAILER_BYTES: usize = 56;

/// The temp file name for a write id: the id is 16 lowercase hex digits and
/// nothing else.
pub fn temp_name_for(id: &str) -> Result<String, String> {
    let name = format!("risu-write-{}.tmp", id);
    if is_temp_name(&name) {
        Ok(name)
    } else {
        Err("refused write id: 16 lowercase hex digits".to_string())
    }
}

fn decode_chunk(data: &str) -> Result<Vec<u8>, String> {
    if data.len() > MAX_CHUNK_BYTES / 3 * 4 + 4 {
        return Err("the chunk is larger than a chunk may be".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("the chunk is not valid base64: {}", e))?;
    if bytes.len() > MAX_CHUNK_BYTES {
        return Err("the chunk is larger than a chunk may be".to_string());
    }
    Ok(bytes)
}

fn discard_temp<O: FileOps>(ops: &O, temp: &Path) {
    let _ = ops.remove(temp);
}

/// Applies one chunk of the write that `temp_name` identifies. `Err` means the
/// write is over: the temp file this call owns is removed and the target is
/// unchanged. `Ok` with `last` means the target holds every chunk. A temp file
/// that chunk 0 found already in place is not this write's file and is left alone.
pub fn write_chunk_with<O: FileOps>(
    ops: &O,
    target: &Path,
    temp_name: &str,
    offset: u64,
    bytes: &[u8],
    last: bool,
    durable: bool,
) -> Result<(), String> {
    let directory = target
        .parent()
        .ok_or_else(|| "the target has no parent directory".to_string())?;
    let temp = directory.join(temp_name);
    if offset == 0 {
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
        if durable {
            // A new directory has its own entry in its parent. The flush is
            // best-effort like the one after the rename.
            for dir in created {
                if let Some(parent) = dir.parent() {
                    if let Err(error) = ops.sync_dir(parent) {
                        eprintln!("directory flush for a new directory failed for {}: {}", parent.display(), error);
                    }
                }
            }
        }
        // An existing temp is not this write's file: nothing is removed.
        ops.create_empty(&temp)
            .map_err(|e| format!("failed to create {}: {}", temp.display(), e))?;
    }
    if let Err(error) = ops.append(&temp, offset, bytes) {
        discard_temp(ops, &temp);
        return Err(format!("failed to write {}: {}", temp.display(), error));
    }
    if !last {
        return Ok(());
    }
    if durable {
        if let Err(error) = ops.sync_file(&temp) {
            discard_temp(ops, &temp);
            return Err(format!("failed to flush {}: {}", temp.display(), error));
        }
    }
    if let Err(error) = rename_with_retry(ops, &temp, target) {
        discard_temp(ops, &temp);
        return Err(format!("failed to rename {} to {}: {}", temp.display(), target.display(), error));
    }
    if durable {
        if let Err(error) = ops.sync_dir(directory) {
            eprintln!("directory flush after rename failed for {}: {}", directory.display(), error);
        }
    }
    Ok(())
}

/// Removes the temp file of an unfinished write. A temp that is already gone is
/// not an error.
pub fn abort_chunk_with<O: FileOps>(ops: &O, target: &Path, temp_name: &str) -> Result<(), String> {
    let directory = target
        .parent()
        .ok_or_else(|| "the target has no parent directory".to_string())?;
    let temp = directory.join(temp_name);
    match ops.remove(&temp) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove {}: {}", temp.display(), error)),
    }
}

/// The command's whole job apart from reading the request: validate the key
/// and the id, decode the chunk, apply it. A refused key, id or chunk never
/// reaches the disk.
pub fn write_chunk_key(
    base: &Path,
    key: &str,
    id: &str,
    offset: u64,
    data: &str,
    last: bool,
    durable: bool,
) -> Result<(), String> {
    let target = resolve_key(base, key)?;
    let temp_name = temp_name_for(id)?;
    let bytes = decode_chunk(data)?;
    write_chunk_with(&RealOps, &target, &temp_name, offset, &bytes, last, durable)
}

pub fn abort_chunk_key(base: &Path, key: &str, id: &str) -> Result<(), String> {
    let target = resolve_key(base, key)?;
    let temp_name = temp_name_for(id)?;
    abort_chunk_with(&RealOps, &target, &temp_name)
}

/// Why `key` may not be read, or `None` when it may: not empty, no NUL, not
/// absolute, no drive prefix, no empty, `.` or `..` segment; on Windows also no
/// `:` and no `\`. A key that is not creatable (a leading dot, a temp name, a
/// character a Windows file name refuses) is still readable.
pub fn addressable_violation(key: &str) -> Option<&'static str> {
    if key.is_empty() {
        return Some("a key is a non-empty string");
    }
    if key.contains('\0') {
        return Some("a key holds no NUL");
    }
    let bytes = key.as_bytes();
    if key.starts_with('/') || key.starts_with('\\') || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':') {
        return Some("a key is relative to the app data directory");
    }
    if cfg!(windows) && (key.contains(':') || key.contains('\\')) {
        return Some("a key holds no : and no \\ on Windows");
    }
    for segment in key.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Some("a key has no empty, . or .. segment");
        }
    }
    None
}

/// The path of a readable key under `base`; the result cannot leave `base`.
pub fn resolve_addressable(base: &Path, key: &str) -> Result<PathBuf, String> {
    if let Some(reason) = addressable_violation(key) {
        return Err(format!("refused key: {}", reason));
    }
    let mut path = base.to_path_buf();
    for segment in key.split('/') {
        path.push(segment);
    }
    Ok(path)
}

#[cfg(unix)]
fn identity(meta: &fs::Metadata) -> [u64; 6] {
    use std::os::unix::fs::MetadataExt;
    [
        meta.dev(),
        meta.ino(),
        meta.mtime() as u64,
        meta.mtime_nsec() as u64,
        meta.ctime() as u64,
        meta.ctime_nsec() as u64,
    ]
}

#[cfg(not(unix))]
fn identity(meta: &fs::Metadata) -> [u64; 6] {
    let (secs, nanos) = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or((0, 0), |elapsed| (elapsed.as_secs(), u64::from(elapsed.subsec_nanos())));
    [0, 0, secs, nanos, 0, 0]
}

/// Up to `len` bytes of the file at `path` from `offset` (fewer at the end of
/// the file, and never more than `MAX_RANGE_BYTES`), followed by the trailer.
/// The file is opened once and its identity is read from that open file, so the
/// piece and the trailer describe the same file.
pub fn read_range(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| format!("failed to open {}: {}", path.display(), e))?;
    let meta = file
        .metadata()
        .map_err(|e| format!("failed to read the metadata of {}: {}", path.display(), e))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let total = meta.len();
    let want = len.min(MAX_RANGE_BYTES).min(total.saturating_sub(offset)) as usize;
    let mut out = vec![0u8; want];
    if want > 0 {
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("failed to seek in {}: {}", path.display(), e))?;
        let mut filled = 0;
        while filled < want {
            match file.read(&mut out[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(format!("failed to read {}: {}", path.display(), e)),
            }
        }
        out.truncate(filled);
    }
    out.reserve_exact(TRAILER_BYTES);
    out.extend_from_slice(&total.to_le_bytes());
    for value in identity(&meta) {
        out.extend_from_slice(&value.to_le_bytes());
    }
    Ok(out)
}

pub fn read_key_range(base: &Path, key: &str, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let path = resolve_addressable(base, key)?;
    read_range(&path, offset, len)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu-chunked-test-{}-{}", name, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const ID: &str = "0123456789abcdef";
    const TEMP: &str = "risu-write-0123456789abcdef.tmp";

    /// The real file system with one injected fault (a step name and which
    /// occurrence of it fails, counting from 1) and a record of every step.
    struct Faulty {
        fail: Option<(&'static str, usize)>,
        steps: RefCell<Vec<&'static str>>,
    }

    impl Faulty {
        fn new() -> Self {
            Faulty { fail: None, steps: RefCell::new(Vec::new()) }
        }
        fn failing(step: &'static str, nth: usize) -> Self {
            Faulty { fail: Some((step, nth)), steps: RefCell::new(Vec::new()) }
        }
        /// Records `step` and says whether this occurrence is the injected fault.
        fn hit(&self, step: &'static str) -> bool {
            self.steps.borrow_mut().push(step);
            match self.fail {
                Some((name, nth)) => name == step && self.steps.borrow().iter().filter(|s| **s == step).count() == nth,
                None => false,
            }
        }
        fn count(&self, step: &str) -> usize {
            self.steps.borrow().iter().filter(|s| **s == step).count()
        }
        fn fault() -> io::Error {
            io::Error::new(io::ErrorKind::Other, "injected fault")
        }
    }

    impl FileOps for Faulty {
        fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
            RealOps.create_synced(temp, bytes)
        }
        fn create_empty(&self, temp: &Path) -> io::Result<()> {
            if self.hit("create_empty") {
                return Err(Self::fault());
            }
            RealOps.create_empty(temp)
        }
        fn append(&self, temp: &Path, offset: u64, bytes: &[u8]) -> io::Result<()> {
            if self.hit("append") {
                // A cut chunk is left behind, as a full disk leaves one.
                let _ = RealOps.append(temp, offset, &bytes[..bytes.len() / 2]);
                return Err(Self::fault());
            }
            RealOps.append(temp, offset, bytes)
        }
        fn sync_file(&self, path: &Path) -> io::Result<()> {
            if self.hit("sync_file") {
                return Err(Self::fault());
            }
            RealOps.sync_file(path)
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            if self.hit("rename") {
                return Err(io::Error::from_raw_os_error(1));
            }
            RealOps.rename(from, to)
        }
        fn sync_dir(&self, dir: &Path) -> io::Result<()> {
            if self.hit("sync_dir") {
                return Err(Self::fault());
            }
            RealOps.sync_dir(dir)
        }
        fn remove(&self, path: &Path) -> io::Result<()> {
            self.steps.borrow_mut().push("remove");
            RealOps.remove(path)
        }
        fn sleep_ms(&self, _ms: u64) {}
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

    /// Writes `bytes` to `target` in chunks of `chunk` bytes; at least one chunk.
    fn write_in_chunks<O: FileOps>(ops: &O, target: &Path, bytes: &[u8], chunk: usize, durable: bool) -> Result<(), String> {
        let mut offset = 0;
        loop {
            let end = (offset + chunk).min(bytes.len());
            write_chunk_with(ops, target, TEMP, offset as u64, &bytes[offset..end], end == bytes.len(), durable)?;
            if end == bytes.len() {
                return Ok(());
            }
            offset = end;
        }
    }

    fn patterned(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 7 % 251) as u8).collect()
    }

    #[test]
    fn the_file_is_byte_identical_for_every_chunk_boundary() {
        let dir = scratch("identical");
        for len in [0usize, 1, 3, 4, 5, 8, 9, 23] {
            for durable in [false, true] {
                let target = dir.join("blocks").join("x");
                write_in_chunks(&RealOps, &target, &patterned(len), 4, durable).unwrap();
                assert_eq!(fs::read(&target).unwrap(), patterned(len), "len {} durable {}", len, durable);
                assert_eq!(names_in(target.parent().unwrap()), vec!["x"]);
            }
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_durable_write_syncs_the_file_renames_then_flushes_the_directory() {
        let dir = scratch("order");
        let target = dir.join("a.bin");
        let ops = Faulty::new();

        write_in_chunks(&ops, &target, &patterned(10), 4, true).unwrap();

        assert_eq!(
            *ops.steps.borrow(),
            vec!["create_empty", "append", "append", "append", "sync_file", "rename", "sync_dir"]
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_non_durable_write_adds_no_flush() {
        let dir = scratch("plain");
        let target = dir.join("new").join("a.bin");
        let ops = Faulty::new();

        write_in_chunks(&ops, &target, &patterned(10), 4, false).unwrap();

        assert_eq!(*ops.steps.borrow(), vec!["create_empty", "append", "append", "append", "rename"]);
        assert_eq!(fs::read(&target).unwrap(), patterned(10));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn new_directories_are_flushed_into_their_parents_before_the_temp_exists() {
        let base = scratch("new-dirs");
        let target = base.join("blocks").join("gen").join("x");
        let ops = Faulty::new();

        write_in_chunks(&ops, &target, &patterned(9), 4, true).unwrap();

        // `blocks` and `gen` are new: two flushes before the temp is created,
        // then the target directory after the rename.
        assert_eq!(ops.count("sync_dir"), 2 + 1);
        let steps = ops.steps.borrow();
        assert_eq!(&steps[..3], &["sync_dir", "sync_dir", "create_empty"]);
        assert_eq!(*steps.last().unwrap(), "sync_dir");
        drop(steps);
        assert_eq!(fs::read(&target).unwrap(), patterned(9));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn an_existing_directory_is_not_flushed_into_its_parent() {
        let base = scratch("old-dirs");
        fs::create_dir_all(base.join("blocks")).unwrap();
        let ops = Faulty::new();

        write_in_chunks(&ops, &base.join("blocks").join("x"), &patterned(9), 4, true).unwrap();

        assert_eq!(ops.count("sync_dir"), 1);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_failure_at_any_step_keeps_the_old_bytes_removes_the_temp_and_reports_the_original_error() {
        let faults: [(&'static str, usize); 4] = [("create_empty", 1), ("append", 1), ("append", 3), ("sync_file", 1)];
        let mut cases: Vec<(&'static str, usize)> = faults.to_vec();
        cases.push(("rename", 1));
        for (step, nth) in cases {
            let dir = scratch("fault");
            let target = dir.join("a.bin");
            fs::write(&target, b"old bytes").unwrap();
            let ops = Faulty::failing(step, nth);

            let error = write_in_chunks(&ops, &target, &patterned(10), 4, true).unwrap_err();

            if step == "rename" {
                assert!(error.contains("failed to rename"), "{} {}: {}", step, nth, error);
            } else {
                assert!(error.contains("injected fault"), "{} {}: {}", step, nth, error);
            }
            assert_eq!(fs::read(&target).unwrap(), b"old bytes", "{} {}", step, nth);
            assert_eq!(names_in(&dir), vec!["a.bin"], "{} {}", step, nth);
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn a_non_durable_write_fails_cleanly_at_chunk_k_and_at_the_rename() {
        for (step, nth) in [("append", 2), ("rename", 1)] {
            let dir = scratch("fault-plain");
            let target = dir.join("a.bin");
            fs::write(&target, b"old bytes").unwrap();

            assert!(write_in_chunks(&Faulty::failing(step, nth), &target, &patterned(10), 4, false).is_err());

            assert_eq!(fs::read(&target).unwrap(), b"old bytes");
            assert_eq!(names_in(&dir), vec!["a.bin"]);
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    #[test]
    fn a_failed_directory_flush_does_not_fail_the_write() {
        // The first flush is a new directory's, the last is the target directory's.
        for nth in [1, 3] {
            let base = scratch("flush-fails");
            let target = base.join("blocks").join("gen").join("x");
            let ops = Faulty::failing("sync_dir", nth);

            write_in_chunks(&ops, &target, &patterned(9), 4, true).unwrap();

            assert_eq!(ops.count("sync_dir"), 3);
            assert_eq!(fs::read(&target).unwrap(), patterned(9));
            assert_eq!(names_in(target.parent().unwrap()), vec!["x"]);
            fs::remove_dir_all(&base).unwrap();
        }
    }

    #[test]
    fn a_temp_that_chunk_zero_finds_in_place_is_left_alone() {
        let dir = scratch("exists");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        fs::write(dir.join(TEMP), b"someone else").unwrap();
        let ops = Faulty::new();

        assert!(write_chunk_with(&ops, &target, TEMP, 0, b"abcd", false, true).is_err());

        assert_eq!(ops.count("remove"), 0);
        assert_eq!(fs::read(dir.join(TEMP)).unwrap(), b"someone else");
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_duplicate_chunk_is_rejected_and_the_write_is_over() {
        let dir = scratch("duplicate");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        write_chunk_with(&RealOps, &target, TEMP, 0, b"abcd", false, false).unwrap();
        write_chunk_with(&RealOps, &target, TEMP, 4, b"efgh", false, false).unwrap();

        let error = write_chunk_with(&RealOps, &target, TEMP, 4, b"efgh", false, false).unwrap_err();

        assert!(error.contains("starts at 4"), "{}", error);
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_chunk_that_skips_ahead_or_has_no_temp_is_rejected() {
        let dir = scratch("skip");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();

        assert!(write_chunk_with(&RealOps, &target, TEMP, 8, b"xxxx", true, false).is_err());
        assert_eq!(names_in(&dir), vec!["a.bin"]);

        write_chunk_with(&RealOps, &target, TEMP, 0, b"abcd", false, false).unwrap();
        assert!(write_chunk_with(&RealOps, &target, TEMP, 8, b"xxxx", true, false).is_err());
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_abort_removes_its_own_temp_only_and_a_missing_temp_is_fine() {
        let dir = scratch("abort");
        let target = dir.join("a.bin");
        fs::write(&target, b"old bytes").unwrap();
        fs::write(dir.join("risu-write-fedcba9876543210.tmp"), b"other write").unwrap();
        write_chunk_with(&RealOps, &target, TEMP, 0, b"abcd", false, false).unwrap();

        abort_chunk_with(&RealOps, &target, TEMP).unwrap();
        abort_chunk_with(&RealOps, &target, TEMP).unwrap();

        assert_eq!(names_in(&dir), vec!["a.bin", "risu-write-fedcba9876543210.tmp"]);
        assert_eq!(fs::read(&target).unwrap(), b"old bytes");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn two_writes_to_one_key_keep_separate_temps_and_the_last_commit_wins() {
        let dir = scratch("concurrent");
        let target = dir.join("a.bin");
        let other = "risu-write-fedcba9876543210.tmp";

        write_chunk_with(&RealOps, &target, TEMP, 0, b"aaaa", false, false).unwrap();
        write_chunk_with(&RealOps, &target, other, 0, b"bbbb", false, false).unwrap();
        write_chunk_with(&RealOps, &target, TEMP, 4, b"aaaa", true, false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"aaaaaaaa");
        write_chunk_with(&RealOps, &target, other, 4, b"bbbb", true, false).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"bbbbbbbb");
        assert_eq!(names_in(&dir), vec!["a.bin"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_leftover_temp_is_named_so_the_listing_and_the_boot_sweep_recognise_it() {
        for _ in 0..20 {
            let id: String = RealOps.temp_name().trim_start_matches("risu-write-").trim_end_matches(".tmp").to_string();
            assert!(is_temp_name(&temp_name_for(&id).unwrap()));
        }
    }

    #[test]
    fn a_refused_key_or_id_touches_nothing_on_disk() {
        let outer = scratch("refused");
        let base = outer.join("base");
        fs::create_dir_all(&base).unwrap();
        let keys = [
            "", "/abs", "a/", "/a", "a//b", "a/./b", "a/../b", "../x", "..", ".hidden", "a/.hidden", "./a", "./blocks/x",
            "C:x", "c:/x", "a\\b", "a\u{0}b", "a\nb", "x/a:b", "a<b", "a|b", "a?b", "a*b", "a\"b", "a>b",
            "a/b.", "a/b ", "blocks/risu-write-0123456789abcdef.tmp",
        ];
        for key in keys {
            assert!(write_chunk_key(&base, key, ID, 0, "", true, true).is_err(), "should refuse {:?}", key);
            assert!(abort_chunk_key(&base, key, ID).is_err(), "should refuse {:?}", key);
        }
        let ids = [
            "", "0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "../0123456789abcdef", "0123456789abcde/",
            "0123456789abcdeg", "0123456789abcdef.tmp", "x/0123456789abcdef", "0123456789abcde\u{0}",
        ];
        for id in ids {
            assert!(write_chunk_key(&base, "blocks/x", id, 0, "", true, true).is_err(), "should refuse id {:?}", id);
            assert!(abort_chunk_key(&base, "blocks/x", id).is_err(), "should refuse id {:?}", id);
        }
        let too_long = format!("a/{}", "x".repeat(256));
        assert!(write_chunk_key(&base, &too_long, ID, 0, "", true, true).is_err());
        assert!(names_in(&base).is_empty());
        assert_eq!(names_in(&outer), vec!["base"]);
        fs::remove_dir_all(&outer).unwrap();
    }

    #[test]
    fn a_bad_chunk_is_refused_before_the_disk_is_touched() {
        let base = scratch("bad-chunk");
        for data in ["!!!!", "YQ=", "YQ==YQ==", "AAAA AAAA"] {
            assert!(write_chunk_key(&base, "blocks/gen/x", ID, 0, data, true, true).is_err(), "should refuse {:?}", data);
        }
        let too_big = "A".repeat(MAX_CHUNK_BYTES / 3 * 4 + 8);
        assert!(write_chunk_key(&base, "blocks/gen/x", ID, 0, &too_big, true, true).is_err());
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn write_chunk_key_decodes_base64_and_writes_under_the_base_directory() {
        let base = scratch("key");
        let encode = |bytes: &[u8]| general_purpose::STANDARD.encode(bytes);

        write_chunk_key(&base, "blocks/gen/root", ID, 0, &encode(&[0, 1, 2, 250, 251, 252, 253]), false, true).unwrap();
        write_chunk_key(&base, "blocks/gen/root", ID, 7, &encode(&[255, 254]), true, true).unwrap();

        assert_eq!(
            fs::read(base.join("blocks").join("gen").join("root")).unwrap(),
            vec![0, 1, 2, 250, 251, 252, 253, 255, 254]
        );
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_read_key_is_addressable_even_when_it_is_not_creatable() {
        for key in [".hidden", "a/.b", "a/risu-write-0123456789abcdef.tmp", "assets/x.what?", "assets/x.jpg ", "a/b.", "blocks/gen/c/6162"] {
            assert!(addressable_violation(key).is_none(), "should accept {:?}", key);
        }
        for key in ["", "/abs", "\\a", "a//b", "a/", "a/./b", "a/../b", "../x", "..", ".", "a\u{0}b", "C:x", "c:/x"] {
            assert!(addressable_violation(key).is_some(), "should refuse {:?}", key);
        }
        if cfg!(windows) {
            assert!(addressable_violation("a\\b").is_some());
            assert!(addressable_violation("x/a:b").is_some());
        } else {
            assert!(addressable_violation("a\\b").is_none());
            assert!(addressable_violation("x/a:b").is_none());
        }
    }

    #[test]
    fn a_refused_read_key_never_reads_outside_the_base() {
        let outer = scratch("read-refused");
        let base = outer.join("base");
        fs::create_dir_all(&base).unwrap();
        fs::write(outer.join("secret"), b"secret").unwrap();
        for key in ["../secret", "a/../../secret", "/secret", "..", "", "base/../../secret", "C:secret"] {
            assert!(read_key_range(&base, key, 0, 100).is_err(), "should refuse {:?}", key);
        }
        let absolute = outer.join("secret");
        assert!(read_key_range(&base, &absolute.to_string_lossy().replace('\\', "/"), 0, 100).is_err());
        fs::remove_dir_all(&outer).unwrap();
    }

    fn trailer(response: &[u8]) -> Vec<u64> {
        response[response.len() - TRAILER_BYTES..]
            .chunks(8)
            .map(|word| u64::from_le_bytes(word.try_into().unwrap()))
            .collect()
    }

    fn piece(response: &[u8]) -> &[u8] {
        &response[..response.len() - TRAILER_BYTES]
    }

    #[test]
    fn pieces_of_a_file_add_up_to_the_file_and_report_its_size() {
        let base = scratch("pieces");
        let bytes = patterned(25);
        fs::create_dir_all(base.join("assets")).unwrap();
        fs::write(base.join("assets").join("x"), &bytes).unwrap();

        let mut joined = Vec::new();
        let mut identities = Vec::new();
        let mut offset = 0u64;
        while offset < 25 {
            let response = read_key_range(&base, "assets/x", offset, 10).unwrap();
            let words = trailer(&response);
            assert_eq!(words.len(), 7);
            assert_eq!(words[0], 25);
            identities.push(words);
            joined.extend_from_slice(piece(&response));
            offset += piece(&response).len() as u64;
        }

        assert_eq!(joined, bytes);
        assert!(identities.windows(2).all(|pair| pair[0] == pair[1]));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_read_past_the_end_or_of_an_empty_file_is_an_empty_piece_with_the_size() {
        let base = scratch("past-end");
        fs::write(base.join("empty"), b"").unwrap();
        fs::write(base.join("four"), b"abcd").unwrap();

        let empty = read_key_range(&base, "empty", 0, 100).unwrap();
        assert!(piece(&empty).is_empty());
        assert_eq!(trailer(&empty)[0], 0);
        let past = read_key_range(&base, "four", 10, 100).unwrap();
        assert!(piece(&past).is_empty());
        assert_eq!(trailer(&past)[0], 4);
        let whole = read_key_range(&base, "four", 0, 4).unwrap();
        assert_eq!(piece(&whole), b"abcd");
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn one_call_never_returns_more_than_the_range_cap() {
        let base = scratch("cap");
        let file = File::create(base.join("big")).unwrap();
        file.set_len(MAX_RANGE_BYTES + 5).unwrap();
        drop(file);

        let response = read_key_range(&base, "big", 0, u64::MAX).unwrap();

        assert_eq!(piece(&response).len() as u64, MAX_RANGE_BYTES);
        assert_eq!(trailer(&response)[0], MAX_RANGE_BYTES + 5);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_missing_key_reports_an_error_that_ends_with_the_os_error() {
        let base = scratch("missing");
        fs::create_dir_all(base.join("assets")).unwrap();

        let in_existing_directory = read_key_range(&base, "assets/gone", 0, 10).unwrap_err();
        let in_missing_directory = read_key_range(&base, "gone/dir/file", 0, 10).unwrap_err();
        let top_level = read_key_range(&base, "gone", 0, 10).unwrap_err();

        // The page treats `(os error 2)` or `(os error 3)` at the very end of the message as "no such file".
        for message in [&in_existing_directory, &top_level] {
            assert!(message.ends_with("(os error 2)"), "{}", message);
        }
        assert!(
            in_missing_directory.ends_with("(os error 2)") || in_missing_directory.ends_with("(os error 3)"),
            "{}",
            in_missing_directory
        );
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_directory_is_not_read_as_a_file() {
        let base = scratch("directory");
        fs::create_dir_all(base.join("assets")).unwrap();

        let error = read_key_range(&base, "assets", 0, 10).unwrap_err();

        assert!(!error.ends_with("(os error 2)") && !error.ends_with("(os error 3)"), "{}", error);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_trailer_changes_when_the_file_is_replaced() {
        let base = scratch("identity");
        let key = "assets/x";
        fs::create_dir_all(base.join("assets")).unwrap();
        fs::write(base.join("assets").join("x"), b"aaaa").unwrap();
        let before = trailer(&read_key_range(&base, key, 0, 10).unwrap());

        // Every store write replaces a file by rename, which gives it a new identity.
        write_chunk_key(&base, key, ID, 0, &general_purpose::STANDARD.encode(b"bbbb"), true, false).unwrap();
        let after = trailer(&read_key_range(&base, key, 0, 10).unwrap());

        assert_eq!(before[0], after[0]);
        assert_ne!(before, after);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn the_trailer_layout_is_seven_little_endian_words_with_the_size_first() {
        let base = scratch("layout");
        fs::write(base.join("f"), b"hello").unwrap();

        let response = read_key_range(&base, "f", 1, 2).unwrap();

        assert_eq!(response.len(), 2 + TRAILER_BYTES);
        assert_eq!(&response[..2], b"el");
        assert_eq!(&response[2..10], &5u64.to_le_bytes());
        fs::remove_dir_all(&base).unwrap();
    }
}
