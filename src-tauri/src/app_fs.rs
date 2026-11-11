//! Existence, directory-creation and delete operations on keys under the app
//! data directory: the app's own replacement for the fs plugin's synchronous
//! `exists`, `mkdir` and `remove`, which wait for the UI thread on Android.
//! The page sends a bare key, never a path; every function takes the base
//! directory and applies the key rule of `chunked_io::resolve_addressable`
//! before it touches the disk.

use crate::chunked_io::resolve_addressable;
use crate::store2_gate::ungated_remove_refusal;
use std::fs;
use std::io;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The path of `key`; the empty key is the app data directory itself.
fn resolve_dir(base: &Path, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() {
        Ok(base.to_path_buf())
    } else {
        resolve_addressable(base, key)
    }
}

/// Whether a file or directory exists at `key`. A link is followed, and any
/// metadata error answers false, as the plugin's `exists` does.
pub fn exists_key(base: &Path, key: &str) -> Result<bool, String> {
    Ok(resolve_dir(base, key)?.exists())
}

/// Creates the directory `key` and every missing ancestor. An existing
/// directory is not an error; an existing file at `key` is.
pub fn mkdir_all_key(base: &Path, key: &str) -> Result<(), String> {
    let path = resolve_dir(base, key)?;
    fs::create_dir_all(&path).map_err(|e| format!("failed to create directory {}: {}", path.display(), e))
}

/// Removes the file or link at `key`, or an empty directory; never recursive,
/// and a link is removed without touching its target. A missing path is an
/// error whose text ends in `(os error 2)` (the page reads that suffix).
pub fn remove_key(base: &Path, key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("refused key: a key is a non-empty string".to_string());
    }
    let path = resolve_addressable(base, key)?;
    let kind = fs::symlink_metadata(&path)
        .map_err(|e| format!("failed to get metadata of {}: {}", path.display(), e))?
        .file_type();
    let result = if kind.is_dir() { fs::remove_dir(&path) } else { remove_file_or_link(&path, &kind) };
    result.map_err(|e| format!("failed to remove {}: {}", path.display(), e))
}

/// `remove_key` for the ungated `app_fs_remove` command: the gated keys and the
/// `store2/` keys are removed only through the store2 gate, except a temp file
/// the sweep clears.
pub fn remove_key_guarded(base: &Path, key: &str) -> Result<(), String> {
    if let Some(reason) = ungated_remove_refusal(key) {
        return Err(reason.to_string());
    }
    remove_key(base, key)
}

/// What one boot sweep did: how many leftover temp files it removed, and one
/// text per directory it could not list, key it refused or file it could not remove.
#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct SweepReport {
    pub removed: u32,
    pub failures: Vec<String>,
}

/// The directories the process-start sweep walks: the same set as the page's
/// `WRITE_TEMP_DIRECTORIES`, which `writeTempDirectories.json` keeps equal.
pub const STARTUP_SWEEP_DIRECTORIES: [&str; 6] = ["database", "remotes", "coldstorage", "blocks", "assets", "modeldata"];

/// How far before its trigger a walk's cutoff lies. File times come from a
/// tick-coarse clock that can read slightly earlier than a precise `now`, so a
/// temp created just after the trigger must still compare as newer.
const STARTUP_CUTOFF_MARGIN: Duration = Duration::from_secs(2);

/// The modification time before which a walk triggered at `trigger` removes
/// temps; an underflow gives `UNIX_EPOCH`, which removes nothing.
fn cutoff_for(trigger: SystemTime) -> SystemTime {
    trigger.checked_sub(STARTUP_CUTOFF_MARGIN).unwrap_or(UNIX_EPOCH)
}

/// How a temp's modification time compares with a walk's cutoff.
#[derive(Debug, PartialEq)]
enum TempAge {
    /// Strictly before the cutoff: a leftover to remove.
    Old,
    /// At or after the cutoff: it may belong to a live write, so it stays.
    Newer,
    /// Removed by someone else between the listing and the stat: nothing to do.
    Gone,
    /// The time cannot be read: the temp stays and the walk reports it.
    Unreadable(String),
}

fn temp_age(modified: io::Result<SystemTime>, cutoff: SystemTime) -> TempAge {
    match modified {
        Ok(time) if time < cutoff => TempAge::Old,
        Ok(_) => TempAge::Newer,
        Err(e) if e.kind() == io::ErrorKind::NotFound => TempAge::Gone,
        Err(e) => TempAge::Unreadable(e.to_string()),
    }
}

/// Removes the swept temp at `key` with the refusals of `remove_key_guarded`.
/// `Ok(false)` means it was already gone, which another walk can cause and
/// which is not a failure; `Ok(true)` means this call removed it.
fn remove_swept_temp(base: &Path, key: &str) -> Result<bool, String> {
    if let Some(reason) = ungated_remove_refusal(key) {
        return Err(reason.to_string());
    }
    if key.is_empty() {
        return Err("refused key: a key is a non-empty string".to_string());
    }
    let path = resolve_addressable(base, key)?;
    let kind = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata.file_type(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("failed to get metadata of {}: {}", path.display(), e)),
    };
    let result = if kind.is_dir() { fs::remove_dir(&path) } else { remove_file_or_link(&path, &kind) };
    removal_outcome(result, &path)
}

/// The outcome of removing `path`: a temp that vanished meanwhile is not a failure.
fn removal_outcome(result: io::Result<()>, path: &Path) -> Result<bool, String> {
    match result {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("failed to remove {}: {}", path.display(), e)),
    }
}

/// Removes the leftover `risu-write-<16 hex>.tmp` files of interrupted writes
/// with no age rule: use it only while no write of the page can be in flight.
/// The production walks go through `sweep_write_temps_with` and a cutoff.
pub fn sweep_write_temps(base: &Path, directories: &[String]) -> SweepReport {
    sweep_write_temps_with(base, directories, None)
}

/// Removes the leftover `risu-write-<16 hex>.tmp` files of interrupted writes:
/// from `base` itself without descending, and from every key in `directories`
/// with everything below it. A link is never entered; a link named like a temp is
/// removed as a link. A directory that does not exist is skipped quietly; a
/// refused key, an unlistable directory and a failed removal are reported and
/// the rest continue. With `older_than`, a temp whose modification time is at or
/// after it stays (it may belong to a live write), and one whose time cannot be
/// read stays and is reported; a temp that vanishes meanwhile is skipped quietly.
pub fn sweep_write_temps_with(base: &Path, directories: &[String], older_than: Option<SystemTime>) -> SweepReport {
    let mut report = SweepReport::default();
    sweep_directory(base, "", false, older_than, &mut report);
    for directory in directories {
        match resolve_dir(base, directory) {
            Ok(_) if !directory.is_empty() => sweep_directory(base, directory, true, older_than, &mut report),
            Ok(_) => report.failures.push("refused key: a swept directory key is a non-empty string".to_string()),
            Err(reason) => report.failures.push(reason),
        }
    }
    report
}

/// Sweeps the directory `key` (empty: `base`). The temps of one directory are
/// removed only after its listing ends, so nothing is removed while iterating.
fn sweep_directory(base: &Path, key: &str, recursive: bool, older_than: Option<SystemTime>, report: &mut SweepReport) {
    let path = match resolve_dir(base, key) {
        Ok(path) => path,
        Err(reason) => {
            report.failures.push(reason);
            return;
        }
    };
    let listing = match fs::read_dir(&path) {
        Ok(listing) => listing,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return,
        Err(e) => {
            report.failures.push(format!("failed to list {}: {}", path.display(), e));
            return;
        }
    };
    let mut temps: Vec<String> = Vec::new();
    let mut subdirectories: Vec<String> = Vec::new();
    for entry in listing {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                report.failures.push(format!("failed to list {}: {}", path.display(), e));
                continue;
            }
        };
        let Ok(name) = entry.file_name().into_string() else { continue };
        let Ok(kind) = entry.file_type() else { continue };
        if recursive && kind.is_dir() {
            subdirectories.push(child_key(key, &name));
        } else if crate::durable_write::is_temp_name(&name) {
            if let Some(cutoff) = older_than {
                // The entry's own time, read without following a link; only temp-named
                // entries pay for it.
                match temp_age(entry.metadata().and_then(|metadata| metadata.modified()), cutoff) {
                    TempAge::Old => {}
                    TempAge::Newer | TempAge::Gone => continue,
                    TempAge::Unreadable(reason) => {
                        report.failures.push(format!("kept {}: its modification time is unreadable: {}", path.join(&name).display(), reason));
                        continue;
                    }
                }
            }
            temps.push(child_key(key, &name));
        }
    }
    for temp in temps {
        match remove_swept_temp(base, &temp) {
            Ok(true) => report.removed += 1,
            Ok(false) => {}
            Err(reason) => report.failures.push(reason),
        }
    }
    for subdirectory in subdirectories {
        sweep_directory(base, &subdirectory, true, older_than, report);
    }
}

/// The key of the entry `name` inside the directory `key` (empty: `base`).
fn child_key(key: &str, name: &str) -> String {
    if key.is_empty() { name.to_string() } else { format!("{}/{}", key, name) }
}

/// The state of the walk that starts with the process. Created already
/// `Running` at `.manage()`, before any page exists, so a command call can
/// never see an unarmed slot and walk past a startup walk still to come.
pub struct StartupSweep {
    slot: Mutex<Startup>,
    settled: Condvar,
    started: SystemTime,
    /// Calls that found the startup walk running, counted under the lock, so a
    /// test can wait until a caller is really waiting.
    #[cfg(test)]
    waiters: std::sync::atomic::AtomicUsize,
}

enum Startup {
    Running,
    Finished { outcome: Result<(PathBuf, SweepReport), String>, delivered: bool },
}

impl StartupSweep {
    pub fn new() -> StartupSweep {
        StartupSweep::with_started(SystemTime::now())
    }

    /// A slot whose process start is `started`, so a test can place the start in the past.
    fn with_started(started: SystemTime) -> StartupSweep {
        StartupSweep {
            slot: Mutex::new(Startup::Running),
            settled: Condvar::new(),
            started,
            #[cfg(test)]
            waiters: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Startup> {
        self.slot.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Runs the startup walk on the calling (worker) thread, keeping every temp
    /// newer than the process start minus the margin, so it cannot reach a temp
    /// any page of this process writes. The lock is never held across `resolve`
    /// or the walk. Only a `Running` state moves to `Finished`: a second call
    /// does nothing. A panic is stored as a failure so no waiter hangs.
    pub fn run(&self, resolve: impl FnOnce() -> Result<PathBuf, String>) {
        if !matches!(*self.lock(), Startup::Running) {
            return;
        }
        let cutoff = cutoff_for(self.started);
        let outcome = catch_unwind(AssertUnwindSafe(|| -> Result<(PathBuf, SweepReport), String> {
            let base = resolve()?;
            let directories: Vec<String> = STARTUP_SWEEP_DIRECTORIES.iter().map(|name| name.to_string()).collect();
            let report = sweep_write_temps_with(&base, &directories, Some(cutoff));
            Ok((base, report))
        }))
        .unwrap_or_else(|_| Err("the startup sweep panicked".to_string()));
        let mut slot = self.lock();
        if matches!(*slot, Startup::Running) {
            *slot = Startup::Finished { outcome, delivered: false };
        }
        drop(slot);
        self.settled.notify_all();
    }

    /// Ends a startup walk that could not start, so every waiter walks fresh.
    pub fn fail(&self, reason: String) {
        let mut slot = self.lock();
        if matches!(*slot, Startup::Running) {
            *slot = Startup::Finished { outcome: Err(reason), delivered: false };
        }
        drop(slot);
        self.settled.notify_all();
    }

    /// The report for one sweep command call that arrived at `arrival`. A call
    /// never returns while the startup walk is running. The startup walk's report
    /// goes to every call that waited for it, and otherwise to the first call after
    /// it finished, when the base and the directory list match; every other call
    /// walks fresh and keeps the temps newer than `arrival` minus the margin.
    pub fn take_or_walk(&self, base: &Path, directories: &[String], arrival: SystemTime) -> SweepReport {
        self.take_or_walk_with(base, directories, arrival, |base, directories, cutoff| {
            sweep_write_temps_with(base, directories, Some(cutoff))
        })
    }

    fn take_or_walk_with(
        &self,
        base: &Path,
        directories: &[String],
        arrival: SystemTime,
        walk: impl FnOnce(&Path, &[String], SystemTime) -> SweepReport,
    ) -> SweepReport {
        let mut slot = self.lock();
        let waited = matches!(*slot, Startup::Running);
        #[cfg(test)]
        if waited {
            self.waiters.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        slot = self.settled.wait_while(slot, |state| matches!(state, Startup::Running)).unwrap_or_else(PoisonError::into_inner);
        let mut note = None;
        if let Startup::Finished { outcome, delivered } = &mut *slot {
            let entitled = waited || !*delivered;
            *delivered = true;
            if entitled {
                match outcome {
                    Ok((startup_base, report)) => {
                        let same_list = directories.len() == STARTUP_SWEEP_DIRECTORIES.len()
                            && directories.iter().zip(STARTUP_SWEEP_DIRECTORIES).all(|(sent, listed)| sent == listed);
                        if startup_base.as_path() == base && same_list {
                            return report.clone();
                        }
                    }
                    Err(reason) => note = Some(format!("the startup sweep failed: {}", reason)),
                }
            }
        }
        drop(slot);
        let mut report = walk(base, directories, cutoff_for(arrival));
        if let Some(note) = note {
            report.failures.push(note);
        }
        report
    }
}

#[cfg(windows)]
fn remove_file_or_link(path: &Path, kind: &fs::FileType) -> io::Result<()> {
    use std::os::windows::fs::FileTypeExt;
    // A link to a directory is removed with remove_dir on Windows.
    if kind.is_symlink_dir() {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(not(windows))]
fn remove_file_or_link(path: &Path, _kind: &fs::FileType) -> io::Result<()> {
    fs::remove_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh scratch directory holding `base/` and a sentinel file next to it, outside `base`.
    struct Scratch {
        root: PathBuf,
        base: PathBuf,
        sentinel: PathBuf,
    }

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let root = std::env::temp_dir().join(format!("risu-appfs-test-{}-{}", name, uuid::Uuid::new_v4().simple()));
            let base = root.join("base");
            fs::create_dir_all(&base).unwrap();
            let sentinel = root.join("outside");
            fs::write(&sentinel, b"keep").unwrap();
            Scratch { root, base, sentinel }
        }

        fn sentinel_intact(&self) -> bool {
            fs::read(&self.sentinel).map(|bytes| bytes == b"keep").unwrap_or(false)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    const REFUSED: [&str; 9] = ["../outside", "a/../../outside", "/abs", "\\\\x", "C:x", "a\0b", "a//b", "a/./b", "a/"];

    #[test]
    fn exists_answers_for_file_directory_missing_and_root() {
        let s = Scratch::new("exists");
        fs::create_dir_all(s.base.join("dir")).unwrap();
        fs::write(s.base.join("dir").join("file"), b"x").unwrap();
        assert!(exists_key(&s.base, "dir/file").unwrap());
        assert!(exists_key(&s.base, "dir").unwrap());
        assert!(!exists_key(&s.base, "dir/none").unwrap());
        assert!(!exists_key(&s.base, "missing/child").unwrap());
        assert!(exists_key(&s.base, "").unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn exists_follows_links_and_a_dangling_link_does_not_exist() {
        let s = Scratch::new("exists-link");
        std::os::unix::fs::symlink(&s.sentinel, s.base.join("live")).unwrap();
        std::os::unix::fs::symlink(s.root.join("nowhere"), s.base.join("dangling")).unwrap();
        assert!(exists_key(&s.base, "live").unwrap());
        assert!(!exists_key(&s.base, "dangling").unwrap());
    }

    #[test]
    fn refused_keys_fail_before_any_disk_access_and_leave_the_outside_alone() {
        let s = Scratch::new("refused");
        for key in REFUSED {
            for result in [
                exists_key(&s.base, key).map(|_| ()),
                mkdir_all_key(&s.base, key),
                remove_key(&s.base, key),
            ] {
                let message = result.unwrap_err();
                assert!(message.starts_with("refused key:"), "{:?} gave {}", key, message);
            }
        }
        assert!(s.sentinel_intact());
        assert_eq!(fs::read_dir(&s.base).unwrap().count(), 0);
    }

    #[test]
    fn remove_refuses_the_empty_key() {
        let s = Scratch::new("remove-empty");
        let message = remove_key(&s.base, "").unwrap_err();
        assert!(message.starts_with("refused key:"));
        assert!(s.base.exists());
    }

    #[test]
    fn mkdir_creates_nested_directories_and_repeating_is_not_an_error() {
        let s = Scratch::new("mkdir");
        mkdir_all_key(&s.base, "a/b/c").unwrap();
        mkdir_all_key(&s.base, "a/b/c").unwrap();
        assert!(s.base.join("a").join("b").join("c").is_dir());
        mkdir_all_key(&s.base, "").unwrap();
        assert!(s.base.is_dir());
    }

    #[test]
    fn mkdir_over_an_existing_file_fails_and_keeps_the_file() {
        let s = Scratch::new("mkdir-file");
        fs::write(s.base.join("file"), b"data").unwrap();
        assert!(mkdir_all_key(&s.base, "file").is_err());
        assert!(mkdir_all_key(&s.base, "file/child").is_err());
        assert_eq!(fs::read(s.base.join("file")).unwrap(), b"data");
    }

    #[test]
    fn remove_deletes_a_file_and_names_a_missing_one_with_the_os_error_suffix() {
        let s = Scratch::new("remove");
        fs::create_dir_all(s.base.join("d")).unwrap();
        fs::write(s.base.join("d").join("f"), b"x").unwrap();
        remove_key(&s.base, "d/f").unwrap();
        assert!(!s.base.join("d").join("f").exists());
        let message = remove_key(&s.base, "d/f").unwrap_err();
        assert!(message.ends_with("(os error 2)"), "{}", message);
        let message = remove_key(&s.base, "missing/child").unwrap_err();
        assert!(message.ends_with("(os error 2)") || message.ends_with("(os error 3)"), "{}", message);
    }

    #[test]
    fn remove_takes_an_empty_directory_but_never_a_full_one() {
        let s = Scratch::new("remove-dir");
        fs::create_dir_all(s.base.join("empty")).unwrap();
        fs::create_dir_all(s.base.join("full")).unwrap();
        fs::write(s.base.join("full").join("f"), b"x").unwrap();
        remove_key(&s.base, "empty").unwrap();
        assert!(!s.base.join("empty").exists());
        assert!(remove_key(&s.base, "full").is_err());
        assert_eq!(fs::read(s.base.join("full").join("f")).unwrap(), b"x");
    }

    #[test]
    fn remove_takes_names_that_cannot_be_created() {
        let s = Scratch::new("remove-odd");
        fs::write(s.base.join(".hidden"), b"x").unwrap();
        fs::write(s.base.join("risu-write-0123456789abcdef.tmp"), b"x").unwrap();
        remove_key(&s.base, ".hidden").unwrap();
        remove_key(&s.base, "risu-write-0123456789abcdef.tmp").unwrap();
        assert_eq!(fs::read_dir(&s.base).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn remove_of_a_link_removes_the_link_and_not_its_target() {
        let s = Scratch::new("remove-link");
        std::os::unix::fs::symlink(&s.sentinel, s.base.join("link")).unwrap();
        remove_key(&s.base, "link").unwrap();
        assert!(fs::symlink_metadata(s.base.join("link")).is_err());
        assert!(s.sentinel_intact());
    }

    #[cfg(unix)]
    #[test]
    fn remove_of_a_link_to_a_directory_leaves_the_directory() {
        let s = Scratch::new("remove-dirlink");
        let target = s.root.join("elsewhere");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("f"), b"x").unwrap();
        std::os::unix::fs::symlink(&target, s.base.join("link")).unwrap();
        remove_key(&s.base, "link").unwrap();
        assert!(fs::symlink_metadata(s.base.join("link")).is_err());
        assert_eq!(fs::read(target.join("f")).unwrap(), b"x");
    }

    const TEMP: &str = "risu-write-0123456789abcdef.tmp";
    const LISTED: [&str; 6] = ["database", "remotes", "coldstorage", "blocks", "assets", "modeldata"];

    fn listed() -> Vec<String> {
        LISTED.iter().map(|name| name.to_string()).collect()
    }

    fn plant(s: &Scratch, key: &str) {
        let path = s.base.join(key);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    #[test]
    fn sweep_removes_temps_at_the_root_and_at_any_depth_of_every_listed_directory() {
        let s = Scratch::new("sweep-all");
        plant(&s, TEMP);
        let mut expected = 1;
        for directory in LISTED {
            plant(&s, &format!("{}/{}", directory, TEMP));
            plant(&s, &format!("{}/nested/deeper/{}", directory, TEMP));
            plant(&s, &format!("{}/keep.bin", directory));
            expected += 2;
        }

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, expected);
        assert!(report.failures.is_empty(), "{:?}", report.failures);
        assert!(!s.base.join(TEMP).exists());
        for directory in LISTED {
            assert!(!s.base.join(directory).join(TEMP).exists());
            assert!(!s.base.join(directory).join("nested").join("deeper").join(TEMP).exists());
            assert!(s.base.join(directory).join("keep.bin").exists());
        }
    }

    #[test]
    fn sweep_keeps_names_that_only_look_like_a_temp() {
        let s = Scratch::new("sweep-lookalike");
        let keep = [
            "assets/risu-write-0123456789ABCDEF.tmp",
            "assets/risu-write-0123.tmp",
            "assets/xrisu-write-0123456789abcdef.tmp",
            "assets/risu-write-0123456789abcdef.tmp.bak",
            "assets/abc.png",
        ];
        for key in keep {
            plant(&s, key);
        }
        // In another directory: a case-insensitive file system folds the upper-case lookalike onto it.
        plant(&s, &format!("modeldata/{}", TEMP));

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        for key in keep {
            assert!(s.base.join(key).exists(), "{}", key);
        }
    }

    #[test]
    fn sweep_does_not_descend_from_the_root_and_leaves_an_unlisted_directory_alone() {
        let s = Scratch::new("sweep-root-flat");
        plant(&s, &format!("other/{}", TEMP));
        plant(&s, &format!("store2/{}", TEMP));
        plant(&s, &format!("assets/{}", TEMP));

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        assert!(s.base.join("other").join(TEMP).exists());
        assert!(s.base.join("store2").join(TEMP).exists());
    }

    #[test]
    fn sweep_skips_a_missing_listed_directory_without_a_failure() {
        let s = Scratch::new("sweep-missing");
        plant(&s, &format!("assets/{}", TEMP));

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        assert!(report.failures.is_empty(), "{:?}", report.failures);
    }

    #[test]
    fn sweep_descends_a_directory_named_like_a_temp_and_never_removes_it() {
        let s = Scratch::new("sweep-temp-named-dir");
        plant(&s, &format!("assets/{}/{}", TEMP, TEMP));
        fs::create_dir_all(s.base.join("assets").join("risu-write-fedcba9876543210.tmp")).unwrap();

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        assert!(report.failures.is_empty(), "{:?}", report.failures);
        assert!(s.base.join("assets").join(TEMP).is_dir());
        assert!(!s.base.join("assets").join(TEMP).join(TEMP).exists());
        assert!(s.base.join("assets").join("risu-write-fedcba9876543210.tmp").is_dir());
    }

    /// A link to `target`, or the error that refused it; Windows refuses link creation without the symbolic-link privilege.
    fn make_link(target: &Path, link: &Path) -> io::Result<()> {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link)
        }
        #[cfg(windows)]
        {
            if target.is_dir() {
                std::os::windows::fs::symlink_dir(target, link)
            } else {
                std::os::windows::fs::symlink_file(target, link)
            }
        }
    }

    #[test]
    fn sweep_never_enters_a_link_and_removes_a_link_named_like_a_temp_without_touching_its_target() {
        let s = Scratch::new("sweep-link");
        let target = s.root.join("elsewhere");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join(TEMP), b"x").unwrap();
        fs::create_dir_all(s.base.join("assets")).unwrap();
        let linked = make_link(&target, &s.base.join("assets").join("linked"));
        let named = make_link(&s.sentinel, &s.base.join("assets").join(TEMP));
        if let (Err(e), _) | (_, Err(e)) = (&linked, &named) {
            eprintln!("SKIPPED: this host refuses link creation ({}), so the link rules are not exercised here", e);
            return;
        }

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        assert!(target.join(TEMP).exists());
        assert!(fs::symlink_metadata(s.base.join("assets").join(TEMP)).is_err());
        assert!(fs::symlink_metadata(s.base.join("assets").join("linked")).is_ok());
        assert!(s.sentinel_intact());
    }

    #[test]
    fn sweep_reports_a_temp_it_cannot_remove_and_still_removes_the_others() {
        let s = Scratch::new("sweep-failure");
        plant(&s, &format!("{}/inner", TEMP));
        plant(&s, "other-file");
        plant(&s, &format!("assets/{}", TEMP));

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        assert_eq!(report.failures.len(), 1, "{:?}", report.failures);
        assert!(s.base.join(TEMP).join("inner").exists());
        assert!(!s.base.join("assets").join(TEMP).exists());
    }

    #[test]
    fn sweep_refuses_a_bad_directory_key_and_touches_nothing_for_it() {
        let s = Scratch::new("sweep-refused-key");
        plant(&s, &format!("assets/{}", TEMP));
        let escaped = s.root.join("escaped");
        fs::create_dir_all(&escaped).unwrap();
        fs::write(escaped.join(TEMP), b"x").unwrap();
        let bad: Vec<String> = ["../escaped", "/abs", "a//b"].iter().map(|key| key.to_string()).collect();

        let report = sweep_write_temps(&s.base, &bad);

        assert_eq!(report.removed, 0);
        assert_eq!(report.failures.len(), bad.len(), "{:?}", report.failures);
        assert!(report.failures.iter().all(|reason| reason.starts_with("refused key:")));
        assert!(escaped.join(TEMP).exists());
        assert!(s.base.join("assets").join(TEMP).exists());
        assert!(s.sentinel_intact());
    }

    #[test]
    fn sweep_removes_the_temp_an_abandoned_chunked_write_left_and_keeps_the_target() {
        let s = Scratch::new("sweep-chunked");
        plant(&s, "assets/nested/old.bin");
        // The page dies after chunk 0: no last chunk, no abort.
        crate::chunked_io::write_chunk_key(&s.base, "assets/nested/old.bin", "0123456789abcdef", 0, "AAAA", false, true, None).unwrap();
        assert!(s.base.join("assets").join("nested").join(TEMP).exists());

        let report = sweep_write_temps(&s.base, &listed());

        assert_eq!(report.removed, 1);
        assert!(!s.base.join("assets").join("nested").join(TEMP).exists());
        assert_eq!(fs::read(s.base.join("assets").join("nested").join("old.bin")).unwrap(), b"x");
    }

    use std::sync::atomic::Ordering;
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::thread;

    const WAIT: Duration = Duration::from_secs(5);

    fn ago(seconds: u64) -> SystemTime {
        SystemTime::now() - Duration::from_secs(seconds)
    }

    /// A temp name from the producer's format (`durable_write`'s `temp_name`).
    fn producer_temp_name() -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        format!("risu-write-{}.tmp", &id[..16])
    }

    /// A temp created the way the producer creates one (`create_new`), with its
    /// modification time set to `modified`.
    fn plant_temp(s: &Scratch, key: &str, modified: SystemTime) {
        let path = s.base.join(key);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();
        file.set_modified(modified).unwrap();
    }

    /// A temp created the way the producer creates one, left with the time the file system gave it.
    fn plant_fresh_temp(s: &Scratch, key: &str) {
        let path = s.base.join(key);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::OpenOptions::new().write(true).create_new(true).open(path).unwrap();
    }

    fn assets_temp() -> String {
        format!("assets/{}", producer_temp_name())
    }

    /// A startup sweep that already ran over `s.base`; a priming call takes its report.
    fn taken_startup(s: &Scratch) -> StartupSweep {
        let sweep = StartupSweep::new();
        sweep.run(|| Ok(s.base.clone()));
        sweep.take_or_walk(&s.base, &listed(), SystemTime::now());
        sweep
    }

    fn wait_for_waiters(sweep: &StartupSweep, count: usize) {
        let deadline = std::time::Instant::now() + WAIT;
        while sweep.waiters.load(Ordering::SeqCst) < count {
            assert!(std::time::Instant::now() < deadline, "the callers never started waiting");
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn startup_result_is_handed_over_and_later_calls_walk_fresh() {
        let s = Scratch::new("startup-handover");
        plant_temp(&s, &producer_temp_name(), ago(60));
        plant_temp(&s, &format!("assets/nested/{}", producer_temp_name()), ago(60));
        let sweep = StartupSweep::new();
        sweep.run(|| Ok(s.base.clone()));
        let late = assets_temp();
        plant_temp(&s, &late, ago(60));

        let first = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());
        assert_eq!(first.removed, 2);
        assert!(s.base.join(&late).exists());

        let second = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());
        assert_eq!(second.removed, 1);
        assert!(!s.base.join(&late).exists());
    }

    #[test]
    fn a_call_during_the_startup_sweep_waits_for_it() {
        let s = Scratch::new("startup-waits");
        plant_temp(&s, &assets_temp(), ago(60));
        let sweep = Arc::new(StartupSweep::new());
        let (release, gate) = mpsc::channel::<()>();
        let worker = {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            thread::spawn(move || {
                sweep.run(|| {
                    gate.recv().unwrap();
                    Ok(base)
                })
            })
        };
        let (done, reply) = mpsc::channel();
        let caller = {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            thread::spawn(move || done.send(sweep.take_or_walk(&base, &listed(), SystemTime::now())).unwrap())
        };
        wait_for_waiters(&sweep, 1);
        thread::sleep(Duration::from_millis(100));
        assert!(!caller.is_finished(), "the call returned while the startup walk was running");

        release.send(()).unwrap();

        let report = reply.recv_timeout(WAIT).expect("the call never returned");
        assert_eq!(report.removed, 1);
        worker.join().unwrap();
        caller.join().unwrap();
    }

    #[test]
    fn a_different_directory_list_walks_fresh() {
        let s = Scratch::new("startup-list");
        let sweep = StartupSweep::new();
        sweep.run(|| Ok(s.base.clone()));
        let late = assets_temp();
        plant_temp(&s, &late, ago(60));
        let without_remotes: Vec<String> = listed().into_iter().filter(|name| name != "remotes").collect();

        let report = sweep.take_or_walk(&s.base, &without_remotes, SystemTime::now());

        assert_eq!(report.removed, 1);
        assert!(!s.base.join(&late).exists());
    }

    #[test]
    fn a_different_base_walks_fresh() {
        let s = Scratch::new("startup-base");
        let sweep = StartupSweep::new();
        sweep.run(|| Ok(s.root.join("another-base")));
        let late = assets_temp();
        plant_temp(&s, &late, ago(60));

        let report = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());

        assert_eq!(report.removed, 1);
        assert!(!s.base.join(&late).exists());
    }

    /// Runs the call on a thread so a mutant that hangs fails instead.
    fn call_within_the_wait(sweep: Arc<StartupSweep>, base: PathBuf) -> SweepReport {
        let (done, reply) = mpsc::channel();
        thread::spawn(move || done.send(sweep.take_or_walk(&base, &listed(), SystemTime::now())).unwrap());
        reply.recv_timeout(WAIT).expect("the call never returned")
    }

    #[test]
    fn a_failed_or_panicking_startup_sweep_falls_back_to_a_fresh_walk() {
        let s = Scratch::new("startup-failure");
        let failed = Arc::new(StartupSweep::new());
        failed.run(|| Err("no base".to_string()));
        let late = assets_temp();
        plant_temp(&s, &late, ago(60));

        let report = call_within_the_wait(failed, s.base.clone());

        assert_eq!(report.removed, 1);
        assert!(!s.base.join(&late).exists());
        assert_eq!(report.failures, vec!["the startup sweep failed: no base".to_string()]);

        let panicked = Arc::new(StartupSweep::new());
        panicked.run(|| -> Result<PathBuf, String> { panic!("resolve blew up") });
        let late = assets_temp();
        plant_temp(&s, &late, ago(60));

        let report = call_within_the_wait(panicked, s.base.clone());

        assert_eq!(report.removed, 1);
        assert!(!s.base.join(&late).exists());
        assert_eq!(report.failures, vec!["the startup sweep failed: the startup sweep panicked".to_string()]);
    }

    #[test]
    fn run_after_it_finished_is_a_no_op() {
        let s = Scratch::new("startup-run-twice");
        plant_temp(&s, &assets_temp(), ago(60));
        let sweep = StartupSweep::new();
        sweep.run(|| Ok(s.base.clone()));
        sweep.run(|| Ok(s.root.join("another-base")));

        let report = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());

        assert_eq!(report.removed, 1);
        assert!(report.failures.is_empty(), "{:?}", report.failures);
    }

    #[test]
    fn fail_ends_the_wait_and_only_a_running_state_can_fail() {
        let s = Scratch::new("startup-fail");
        let sweep = Arc::new(StartupSweep::new());
        let (done, reply) = mpsc::channel();
        {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            thread::spawn(move || done.send(sweep.take_or_walk(&base, &listed(), SystemTime::now())).unwrap());
        }
        wait_for_waiters(&sweep, 1);
        let late = assets_temp();
        plant_temp(&s, &late, ago(60));

        sweep.fail("x".to_string());

        let report = reply.recv_timeout(WAIT).expect("the call never returned");
        assert_eq!(report.removed, 1);
        assert_eq!(report.failures, vec!["the startup sweep failed: x".to_string()]);

        let finished = StartupSweep::new();
        finished.run(|| Ok(s.base.clone()));
        finished.fail("too late".to_string());
        let report = finished.take_or_walk(&s.base, &listed(), SystemTime::now());
        assert!(report.failures.is_empty(), "{:?}", report.failures);
    }

    #[test]
    fn startup_directories_match_the_page_list_fixture() {
        let page: Vec<String> = serde_json::from_str(include_str!("../../src/ts/storage/tests/writeTempDirectories.json")).unwrap();
        let native: Vec<String> = STARTUP_SWEEP_DIRECTORIES.iter().map(|name| name.to_string()).collect();
        assert_eq!(page, native);
    }

    #[test]
    fn sweep_continues_inside_a_directory_after_a_removal_failure() {
        let s = Scratch::new("sweep-continues");
        plant(&s, &format!("assets/sub/{}", TEMP));
        let stuck = s.base.join("assets").join(TEMP);

        #[cfg(windows)]
        let _held = {
            use std::os::windows::fs::OpenOptionsExt;
            // No sharing: the removal of this file fails while the handle is open.
            fs::OpenOptions::new().write(true).create_new(true).share_mode(0).open(&stuck).unwrap()
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(&stuck, b"x").unwrap();
            let assets = s.base.join("assets");
            fs::set_permissions(&assets, fs::Permissions::from_mode(0o555)).unwrap();
            if fs::write(assets.join("probe"), b"x").is_ok() {
                fs::set_permissions(&assets, fs::Permissions::from_mode(0o755)).unwrap();
                eprintln!("SKIPPED: this host ignores directory permissions (running as root?), so no removal can fail here");
                return;
            }
        }

        let report = sweep_write_temps(&s.base, &listed());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(s.base.join("assets"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(report.removed, 1, "{:?}", report.failures);
        assert_eq!(report.failures.len(), 1, "{:?}", report.failures);
        assert!(stuck.exists());
        assert!(!s.base.join("assets").join("sub").join(TEMP).exists());
    }

    #[test]
    fn every_call_waiting_on_the_startup_sweep_gets_its_report() {
        let s = Scratch::new("startup-two-waiters");
        plant_temp(&s, &assets_temp(), ago(60));
        let sweep = Arc::new(StartupSweep::new());
        let (release, gate) = mpsc::channel::<()>();
        let worker = {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            thread::spawn(move || {
                sweep.run(|| {
                    gate.recv().unwrap();
                    Ok(base)
                })
            })
        };
        let (done, reply) = mpsc::channel();
        for _ in 0..2 {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            let done = done.clone();
            thread::spawn(move || done.send(sweep.take_or_walk(&base, &listed(), SystemTime::now())).unwrap());
        }
        wait_for_waiters(&sweep, 2);
        let late = assets_temp();
        plant_fresh_temp(&s, &late);

        release.send(()).unwrap();

        for _ in 0..2 {
            let report = reply.recv_timeout(WAIT).expect("a waiting call never returned");
            assert_eq!(report.removed, 1, "{:?}", report.failures);
        }
        worker.join().unwrap();
        assert!(s.base.join(&late).exists());
        let third = sweep.take_or_walk(&s.base, &listed(), SystemTime::now() + Duration::from_secs(3));
        assert_eq!(third.removed, 1);
        assert!(!s.base.join(&late).exists());
    }

    #[test]
    fn a_blocked_fresh_walk_does_not_block_another_call() {
        let s = Scratch::new("fresh-blocked");
        let sweep = Arc::new(taken_startup(&s));
        let (entered_tx, entered) = mpsc::channel::<()>();
        let (release, gate) = mpsc::channel::<()>();
        let blocked = {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            thread::spawn(move || {
                sweep.take_or_walk_with(&base, &listed(), SystemTime::now(), |_, _, _| {
                    entered_tx.send(()).unwrap();
                    gate.recv().unwrap();
                    SweepReport::default()
                })
            })
        };
        entered.recv_timeout(WAIT).expect("the walk never started");
        let other = call_within_the_wait(Arc::clone(&sweep), s.base.clone());
        assert_eq!(other.removed, 0);

        release.send(()).unwrap();

        blocked.join().unwrap();
    }

    #[test]
    fn the_startup_walk_keeps_temps_newer_than_the_process() {
        let s = Scratch::new("startup-cutoff");
        let old = assets_temp();
        let fresh = assets_temp();
        let inside_margin = assets_temp();
        let sweep = StartupSweep::new();
        plant_temp(&s, &old, ago(60));
        plant_fresh_temp(&s, &fresh);
        plant_temp(&s, &inside_margin, ago(1));

        sweep.run(|| Ok(s.base.clone()));
        let startup = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());

        assert_eq!(startup.removed, 1);
        assert!(!s.base.join(&old).exists());
        assert!(s.base.join(&fresh).exists());
        assert!(s.base.join(&inside_margin).exists());
        let later = sweep.take_or_walk(&s.base, &listed(), SystemTime::now() + Duration::from_secs(3));
        assert_eq!(later.removed, 2);
        assert!(!s.base.join(&fresh).exists());
        assert!(!s.base.join(&inside_margin).exists());
    }

    #[test]
    fn the_startup_cutoff_is_the_process_start_not_the_moment_the_walk_begins() {
        let s = Scratch::new("startup-cutoff-process-start");
        let old = assets_temp();
        let after_process_start = assets_temp();
        let sweep = StartupSweep::with_started(ago(10));
        plant_temp(&s, &old, ago(60));
        plant_temp(&s, &after_process_start, ago(5));

        sweep.run(|| Ok(s.base.clone()));
        let startup = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());

        assert_eq!(startup.removed, 1);
        assert!(!s.base.join(&old).exists());
        assert!(s.base.join(&after_process_start).exists(), "a temp created after the process started was swept");
    }

    #[test]
    fn a_late_walk_keeps_temps_created_after_its_call_arrived() {
        let s = Scratch::new("late-walk");
        let sweep = Arc::new(taken_startup(&s));
        let arrival = ago(10);
        let (entered_tx, entered) = mpsc::channel::<()>();
        let (release, gate) = mpsc::channel::<()>();
        let (done, reply) = mpsc::channel();
        {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            thread::spawn(move || {
                let report = sweep.take_or_walk_with(&base, &listed(), arrival, |base, directories, cutoff| {
                    entered_tx.send(()).unwrap();
                    gate.recv().unwrap();
                    sweep_write_temps_with(base, directories, Some(cutoff))
                });
                done.send(report).unwrap();
            });
        }
        entered.recv_timeout(WAIT).expect("the walk never started");
        // The next page's call arrives, returns, and its first write creates a temp.
        let next = call_within_the_wait(Arc::clone(&sweep), s.base.clone());
        assert_eq!(next.removed, 0);
        let live = assets_temp();
        let leftover = assets_temp();
        plant_temp(&s, &live, arrival + Duration::from_secs(5));
        plant_temp(&s, &leftover, arrival - Duration::from_secs(50));

        release.send(()).unwrap();

        let report = reply.recv_timeout(WAIT).expect("the late walk never returned");
        assert!(s.base.join(&live).exists());
        assert!(!s.base.join(&leftover).exists());
        assert_eq!(report.removed, 1);
        assert!(report.failures.is_empty(), "{:?}", report.failures);
    }

    #[test]
    fn walks_that_fell_back_after_a_startup_failure_each_keep_temps_created_after_their_call() {
        let s = Scratch::new("late-walk-failed");
        let sweep = Arc::new(StartupSweep::new());
        let arrival = ago(10);
        let (done, reply) = mpsc::channel();
        let mut releases = Vec::new();
        for _ in 0..2 {
            let sweep = Arc::clone(&sweep);
            let base = s.base.clone();
            let done = done.clone();
            let (release, gate) = mpsc::channel::<()>();
            releases.push(release);
            thread::spawn(move || {
                let report = sweep.take_or_walk_with(&base, &listed(), arrival, |base, directories, cutoff| {
                    gate.recv().unwrap();
                    sweep_write_temps_with(base, directories, Some(cutoff))
                });
                done.send(report).unwrap();
            });
        }
        wait_for_waiters(&sweep, 2);
        sweep.fail("x".to_string());
        let live = assets_temp();
        let leftover = assets_temp();
        plant_temp(&s, &live, arrival + Duration::from_secs(5));
        plant_temp(&s, &leftover, arrival - Duration::from_secs(50));

        let mut removed = 0;
        for release in releases {
            release.send(()).unwrap();
            let report = reply.recv_timeout(WAIT).expect("a walk never returned");
            assert_eq!(report.failures, vec!["the startup sweep failed: x".to_string()]);
            removed += report.removed;
        }

        assert!(s.base.join(&live).exists());
        assert!(!s.base.join(&leftover).exists());
        assert_eq!(removed, 1);
    }

    #[test]
    fn temp_age_classifies() {
        let cutoff = SystemTime::now();
        assert_eq!(temp_age(Ok(cutoff - Duration::from_secs(1)), cutoff), TempAge::Old);
        assert_eq!(temp_age(Ok(cutoff), cutoff), TempAge::Newer);
        assert_eq!(temp_age(Ok(cutoff + Duration::from_secs(1)), cutoff), TempAge::Newer);
        assert_eq!(temp_age(Err(io::Error::from(io::ErrorKind::NotFound)), cutoff), TempAge::Gone);
        match temp_age(Err(io::Error::from(io::ErrorKind::PermissionDenied)), cutoff) {
            TempAge::Unreadable(reason) => assert!(!reason.is_empty()),
            other => panic!("expected Unreadable, got {:?}", other),
        }
    }

    #[test]
    fn removing_an_already_gone_temp_is_quiet() {
        let s = Scratch::new("remove-gone");
        let key = assets_temp();
        assert_eq!(remove_swept_temp(&s.base, &key), Ok(false));
        plant_temp(&s, &key, ago(60));
        assert_eq!(remove_swept_temp(&s.base, &key), Ok(true));
        assert_eq!(remove_swept_temp(&s.base, &key), Ok(false));
        for refused in ["../outside", "/abs", "a//b", "store2/unit"] {
            let message = remove_swept_temp(&s.base, refused).unwrap_err();
            assert!(message.starts_with("refused key:"), "{:?} gave {}", refused, message);
        }
        assert!(s.sentinel_intact());
    }

    #[test]
    fn a_removal_that_finds_the_temp_gone_is_quiet_and_any_other_error_is_a_failure() {
        let path = Path::new("assets/risu-write-0123456789abcdef.tmp");
        assert_eq!(removal_outcome(Ok(()), path), Ok(true));
        assert_eq!(removal_outcome(Err(io::Error::from(io::ErrorKind::NotFound)), path), Ok(false));
        let message = removal_outcome(Err(io::Error::from(io::ErrorKind::PermissionDenied)), path).unwrap_err();
        assert!(message.starts_with("failed to remove "), "{}", message);
    }

    #[test]
    fn a_cutoff_walk_keeps_new_temps_at_the_root_and_at_every_depth() {
        let s = Scratch::new("cutoff-depth");
        let mut fresh = vec![producer_temp_name()];
        let mut old = vec![producer_temp_name()];
        for directory in LISTED {
            fresh.push(format!("{}/{}", directory, producer_temp_name()));
            fresh.push(format!("{}/nested/deeper/{}", directory, producer_temp_name()));
            old.push(format!("{}/nested/deeper/{}", directory, producer_temp_name()));
        }
        for key in &fresh {
            plant_fresh_temp(&s, key);
        }
        for key in &old {
            plant_temp(&s, key, ago(60));
        }

        let report = sweep_write_temps_with(&s.base, &listed(), Some(cutoff_for(SystemTime::now())));

        assert_eq!(report.removed as usize, old.len());
        assert!(report.failures.is_empty(), "{:?}", report.failures);
        for key in &fresh {
            assert!(s.base.join(key).exists(), "{}", key);
        }
        for key in &old {
            assert!(!s.base.join(key).exists(), "{}", key);
        }
    }

    #[test]
    fn a_fresh_walk_keeps_temps_inside_the_margin_before_its_arrival() {
        let s = Scratch::new("fresh-margin");
        let sweep = taken_startup(&s);
        let arrival = ago(10);
        let before_margin = assets_temp();
        let inside_margin = assets_temp();
        plant_temp(&s, &before_margin, arrival - Duration::from_secs(60));
        plant_temp(&s, &inside_margin, arrival - Duration::from_secs(1));

        let first = sweep.take_or_walk(&s.base, &listed(), arrival);

        assert_eq!(first.removed, 1);
        assert!(!s.base.join(&before_margin).exists());
        assert!(s.base.join(&inside_margin).exists());
        let second = sweep.take_or_walk(&s.base, &listed(), SystemTime::now());
        assert_eq!(second.removed, 1);
        assert!(!s.base.join(&inside_margin).exists());
    }

    #[test]
    fn a_cutoff_walk_removes_a_link_named_like_a_temp_by_the_links_own_time() {
        let s = Scratch::new("cutoff-link");
        fs::create_dir_all(s.base.join("assets")).unwrap();
        let link = s.base.join("assets").join(TEMP);
        if let Err(e) = make_link(&s.sentinel, &link) {
            eprintln!("SKIPPED: this host refuses link creation ({}), so the link rule is not exercised here", e);
            return;
        }

        let kept = sweep_write_temps_with(&s.base, &listed(), Some(ago(3600)));
        assert_eq!(kept.removed, 0);
        assert!(fs::symlink_metadata(&link).is_ok());

        let removed = sweep_write_temps_with(&s.base, &listed(), Some(SystemTime::now() + Duration::from_secs(3600)));
        assert_eq!(removed.removed, 1);
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(s.sentinel_intact());
    }
}
