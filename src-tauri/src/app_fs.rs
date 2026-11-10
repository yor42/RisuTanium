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
use std::path::{Path, PathBuf};

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
#[derive(Debug, Default, serde::Serialize)]
pub struct SweepReport {
    pub removed: u32,
    pub failures: Vec<String>,
}

/// Removes the leftover `risu-write-<16 hex>.tmp` files of interrupted writes:
/// from `base` itself without descending, and from every key in `directories`
/// with everything below it. A link is never entered; a link named like a temp is
/// removed as a link. A directory that does not exist is skipped quietly; a
/// refused key, an unlistable directory and a failed removal are reported and
/// the rest continue. Call it only while no write of the page can be in flight.
pub fn sweep_write_temps(base: &Path, directories: &[String]) -> SweepReport {
    let mut report = SweepReport::default();
    sweep_directory(base, "", false, &mut report);
    for directory in directories {
        match resolve_dir(base, directory) {
            Ok(_) if !directory.is_empty() => sweep_directory(base, directory, true, &mut report),
            Ok(_) => report.failures.push("refused key: a swept directory key is a non-empty string".to_string()),
            Err(reason) => report.failures.push(reason),
        }
    }
    report
}

/// Sweeps the directory `key` (empty: `base`). The temps of one directory are
/// removed only after its listing ends, so nothing is removed while iterating.
fn sweep_directory(base: &Path, key: &str, recursive: bool, report: &mut SweepReport) {
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
        let child = if key.is_empty() { name } else { format!("{}/{}", key, name) };
        let leaf = child.rsplit('/').next().unwrap_or("");
        if recursive && kind.is_dir() {
            subdirectories.push(child);
        } else if crate::durable_write::is_temp_name(leaf) {
            temps.push(child);
        }
    }
    for temp in temps {
        match remove_key_guarded(base, &temp) {
            Ok(()) => report.removed += 1,
            Err(reason) => report.failures.push(reason),
        }
    }
    for subdirectory in subdirectories {
        sweep_directory(base, &subdirectory, true, report);
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
}
