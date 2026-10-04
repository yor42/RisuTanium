//! Files and deep links the operating system hands the app when it starts or
//! while it runs. Std only, so it can be tested without a Tauri build.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Set when the app exits, so the process its own restart starts finds it; the
/// restart child has then already had its command line consumed.
pub const LAUNCH_CONSUMED_ENV: &str = "RISU_LAUNCH_CONSUMED";

const FILE_EXTENSIONS: [&str; 3] = ["risum", "risup", "charx"];
const DEEP_LINK_PREFIXES: [&str; 2] = ["risutaniumlocal:", "risuailocal:"];

#[derive(Debug, Default, PartialEq, Eq)]
pub struct LaunchInputs {
    pub files: Vec<PathBuf>,
    pub urls: Vec<String>,
}

impl LaunchInputs {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.urls.is_empty()
    }

    pub fn extend(&mut self, other: LaunchInputs) {
        for file in other.files {
            if !self.files.contains(&file) {
                self.files.push(file);
            }
        }
        self.urls.extend(other.urls);
    }

    /// Takes everything queued so far and leaves the queue empty.
    pub fn drain(&mut self) -> LaunchInputs {
        std::mem::take(self)
    }
}

/// True when this process was started by an earlier process of the app, whose
/// command line was already consumed.
pub fn argv_gate(lookup: impl Fn(&str) -> Option<OsString>) -> bool {
    lookup(LAUNCH_CONSUMED_ENV).is_some()
}

pub fn is_deep_link(arg: &str) -> bool {
    DEEP_LINK_PREFIXES.iter().any(|prefix| {
        arg.get(..prefix.len())
            .map_or(false, |head| head.eq_ignore_ascii_case(prefix))
    })
}

/// The path to import when `path` is an existing regular file with a card,
/// preset or module extension. A relative path is resolved against `cwd`.
pub fn file_input(path: &Path, cwd: Option<&Path>) -> Option<PathBuf> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if !FILE_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }
    let resolved = match cwd {
        Some(cwd) if path.is_relative() => cwd.join(path),
        _ => path.to_path_buf(),
    };
    if !resolved.is_file() {
        return None;
    }
    let canonical = resolved.canonicalize().unwrap_or(resolved);
    Some(strip_verbatim(canonical))
}

/// Removes the Windows `\\?\` prefix `canonicalize` adds to drive paths, so the
/// path matches what the operating system itself reports.
fn strip_verbatim(path: PathBuf) -> PathBuf {
    match path.to_str() {
        Some(text) if text.starts_with(r"\\?\") && !text.starts_with(r"\\?\UNC\") => {
            PathBuf::from(&text[4..])
        }
        _ => path,
    }
}

/// Sorts a command line into files and deep links. The first argument is the
/// executable and is never classified; anything else is ignored.
pub fn classify(args: impl Iterator<Item = OsString>, cwd: Option<&Path>) -> LaunchInputs {
    let mut inputs = LaunchInputs::default();
    for arg in args.skip(1) {
        if let Some(text) = arg.to_str() {
            if is_deep_link(text) {
                inputs.urls.push(text.to_string());
                continue;
            }
        }
        if let Some(path) = file_input(Path::new(&arg), cwd) {
            if !inputs.files.contains(&path) {
                inputs.files.push(path);
            }
        }
    }
    inputs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu_launch_inputs_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn args(list: &[&str]) -> impl Iterator<Item = OsString> {
        list.iter().map(OsString::from).collect::<Vec<_>>().into_iter()
    }

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn accepts_existing_files_with_each_extension_in_any_case() {
        let dir = scratch_dir("ext");
        let a = touch(&dir, "a.risum");
        let b = touch(&dir, "b.RISUP");
        let c = touch(&dir, "c.ChArX");
        let found = classify(
            args(&["risu.exe", a.to_str().unwrap(), b.to_str().unwrap(), c.to_str().unwrap()]),
            None,
        );
        assert_eq!(found.files.len(), 3);
        assert!(found.urls.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_missing_files_directories_and_other_extensions() {
        let dir = scratch_dir("ignore");
        let text = touch(&dir, "notes.txt");
        let folder = dir.join("folder.charx");
        fs::create_dir_all(&folder).unwrap();
        let missing = dir.join("missing.risum");
        let found = classify(
            args(&[
                "risu.exe",
                text.to_str().unwrap(),
                folder.to_str().unwrap(),
                missing.to_str().unwrap(),
                "--flag",
                "-x.risum",
            ]),
            None,
        );
        assert!(found.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolves_relative_paths_against_the_given_directory() {
        let dir = scratch_dir("relative");
        touch(&dir, "card.charx");
        let found = classify(args(&["risu.exe", "card.charx"]), Some(&dir));
        assert_eq!(found.files.len(), 1);
        assert!(found.files[0].is_absolute());
        assert_eq!(found.files[0].file_name().unwrap(), "card.charx");
        let without_cwd = classify(args(&["risu.exe", "card.charx"]), None);
        assert!(without_cwd.files.iter().all(|f| f.is_absolute()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn never_classifies_the_first_argument() {
        let dir = scratch_dir("first");
        let first = touch(&dir, "first.risum");
        let found = classify(args(&[first.to_str().unwrap()]), None);
        assert!(found.is_empty());
        let found = classify(args(&["risutaniumlocal://realm/abc"]), None);
        assert!(found.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recognises_both_deep_link_schemes_in_any_case() {
        let found = classify(
            args(&[
                "risu.exe",
                "risutaniumlocal://realm/abc",
                "RISUAILOCAL://realm/def",
                "https://example.com/realm/ghi",
                "risutanium://realm/jkl",
            ]),
            None,
        );
        assert_eq!(
            found.urls,
            vec!["risutaniumlocal://realm/abc".to_string(), "RISUAILOCAL://realm/def".to_string()]
        );
        assert!(found.files.is_empty());
    }

    #[test]
    fn a_deep_link_prefix_split_by_a_multibyte_character_is_not_a_match() {
        assert!(!is_deep_link("risutaniumlocaé:x"));
        assert!(!is_deep_link("ris"));
        assert!(!is_deep_link(""));
    }

    #[test]
    fn a_repeated_file_is_queued_once() {
        let dir = scratch_dir("dupe");
        let a = touch(&dir, "a.risum");
        let p = a.to_str().unwrap();
        let found = classify(args(&["risu.exe", p, p]), None);
        assert_eq!(found.files.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_gate_is_set_only_when_the_marker_is_present() {
        assert!(argv_gate(|name| (name == LAUNCH_CONSUMED_ENV).then(|| OsString::from("1"))));
        assert!(!argv_gate(|_| None));
        assert!(!argv_gate(|name| (name == "OTHER").then(|| OsString::from("1"))));
    }

    #[test]
    fn draining_empties_the_queue_and_returns_its_content() {
        let mut queue = LaunchInputs::default();
        queue.extend(LaunchInputs {
            files: vec![PathBuf::from("/a.risum")],
            urls: vec!["risutaniumlocal://realm/x".to_string()],
        });
        queue.extend(LaunchInputs { files: vec![PathBuf::from("/a.risum")], urls: vec![] });
        let taken = queue.drain();
        assert_eq!(taken.files.len(), 1);
        assert_eq!(taken.urls.len(), 1);
        assert!(queue.is_empty());
        assert!(queue.drain().is_empty());
    }

    #[test]
    fn the_verbatim_prefix_is_removed_from_drive_paths_only() {
        assert_eq!(strip_verbatim(PathBuf::from(r"\\?\C:\docs\a.risum")), PathBuf::from(r"C:\docs\a.risum"));
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\server\share\a.risum")),
            PathBuf::from(r"\\?\UNC\server\share\a.risum")
        );
        assert_eq!(strip_verbatim(PathBuf::from("/tmp/a.risum")), PathBuf::from("/tmp/a.risum"));
    }
}
