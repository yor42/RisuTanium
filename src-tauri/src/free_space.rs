//! Free bytes of the filesystem under a directory, for the page's check before a large import.

use std::path::Path;
use tauri::{AppHandle, Manager};

/// The largest byte count a JavaScript number holds exactly (2^53 - 1). A larger answer would read as unknown on the page.
const MAX_JS_SAFE_BYTES: u64 = (1 << 53) - 1;

/// Bytes available to an unprivileged process: `bavail` blocks of the fragment size (`frsize`), or of the block size
/// (`bsize`) when the filesystem reports no fragment size. Saturates instead of wrapping, and stays within what the page
/// can hold exactly.
#[cfg_attr(not(unix), allow(dead_code))]
pub fn free_bytes(frsize: u64, bsize: u64, bavail: u64) -> u64 {
    let unit = if frsize == 0 { bsize } else { frsize };
    unit.saturating_mul(bavail).min(MAX_JS_SAFE_BYTES)
}

#[cfg(unix)]
pub fn available_bytes(dir: &Path) -> Result<u64, String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let path = CString::new(dir.as_os_str().as_bytes()).map_err(|_| "the data directory path holds a NUL byte".to_string())?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `path` is a NUL-terminated string that outlives the call, and `stat` is a writable statvfs.
    let rc = unsafe { libc::statvfs(path.as_ptr(), &mut stat) };
    if rc != 0 {
        return Err(format!("statvfs failed: {}", std::io::Error::last_os_error()));
    }
    // The field types differ by target (32-bit Android uses 32-bit counts), so every field is widened first.
    Ok(free_bytes(stat.f_frsize as u64, stat.f_bsize as u64, stat.f_bavail as u64))
}

#[cfg(not(unix))]
pub fn available_bytes(_dir: &Path) -> Result<u64, String> {
    Err("reading the free space is not supported on this platform".to_string())
}

/// Free bytes under the app data directory, the filesystem every import write lands on. The page supplies no path.
/// Async with the file system call on a blocking worker thread, so a stalled mount cannot hold the command thread; the
/// directory is resolved first, as the other app data commands do. An error (including on platforms without the call)
/// is read by the page as "cannot check".
#[tauri::command]
pub async fn app_data_free_bytes(app: AppHandle) -> Result<u64, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || available_bytes(&base))
        .await
        .map_err(|e| format!("the free space task failed: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multiplies_the_fragment_size_by_the_available_blocks() {
        assert_eq!(free_bytes(4096, 8192, 1000), 4_096_000);
    }

    #[test]
    fn falls_back_to_the_block_size_when_there_is_no_fragment_size() {
        assert_eq!(free_bytes(0, 4096, 1000), 4_096_000);
    }

    #[test]
    fn zero_available_blocks_is_zero_bytes() {
        assert_eq!(free_bytes(4096, 4096, 0), 0);
        assert_eq!(free_bytes(0, 0, 1000), 0);
    }

    #[test]
    fn saturates_instead_of_wrapping() {
        assert_eq!(free_bytes(u64::MAX, u64::MAX, u64::MAX), MAX_JS_SAFE_BYTES);
    }

    #[test]
    fn clamps_to_the_largest_exact_javascript_integer() {
        assert_eq!(free_bytes(1, 1, MAX_JS_SAFE_BYTES + 5), MAX_JS_SAFE_BYTES);
        assert_eq!(free_bytes(1, 1, MAX_JS_SAFE_BYTES), MAX_JS_SAFE_BYTES);
        assert_eq!(free_bytes(1, 1, MAX_JS_SAFE_BYTES - 1), MAX_JS_SAFE_BYTES - 1);
    }

    #[cfg(not(unix))]
    #[test]
    fn the_stub_reports_an_error() {
        assert!(available_bytes(Path::new(".")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_temporary_directory_reports_a_positive_amount() {
        assert!(available_bytes(&std::env::temp_dir()).unwrap() > 0);
    }
}
