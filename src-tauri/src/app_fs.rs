//! Existence, directory-creation and delete operations on keys under the app
//! data directory: the app's own replacement for the fs plugin's synchronous
//! `exists`, `mkdir` and `remove`, which wait for the UI thread on Android.
//! The page sends a bare key, never a path; every function takes the base
//! directory and applies the key rule of `chunked_io::resolve_addressable`
//! before it touches the disk.

use crate::chunked_io::resolve_addressable;
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
}
