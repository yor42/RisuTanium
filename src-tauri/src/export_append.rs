//! Appends one chunk of a backup export to a file the Android save dialog chose.
//!
//! The page cannot hand a byte array to the file-system plugin cheaply on Android, so it sends each chunk as base64
//! text and this command opens the same `content://` document with the modes the plugin's own `write_file` uses
//! (`wt` to create, `wa` to append) and writes the decoded bytes. The command accepts only an exact `content://` URI
//! that names a host, so it is never a general file writer.

use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::io::Write;

/// The most decoded bytes one call may carry; the page writes chunks of this size at most.
pub const MAX_CHUNK_BYTES: usize = 4 * 1024 * 1024;

/// The longest target URI, in bytes, that a call may name.
const MAX_URI_BYTES: usize = 4096;

/// The target as the URL type the file-system plugin opens. The URI must parse to exactly the text given: a parse that
/// rewrites its input (dot segments, stripped whitespace, an escaped NUL) names a document the caller did not write, so
/// it is refused. A plain path, another scheme and a URI with no host are refused too.
pub fn check_target(uri: &str) -> Result<url::Url, String> {
    if uri.is_empty() {
        return Err("refused-target: the target is empty".to_string());
    }
    if uri.len() > MAX_URI_BYTES {
        return Err("refused-target: the target is too long".to_string());
    }
    if uri.contains('\0') {
        return Err("refused-target: the target holds a NUL".to_string());
    }
    let parsed = url::Url::parse(uri).map_err(|_| "refused-target: the target is not a URI".to_string())?;
    if parsed.scheme() != "content" {
        return Err("refused-target: the target is not a content URI".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("refused-target: the target names no host".to_string());
    }
    if parsed.as_str() != uri {
        return Err("refused-target: the target is not in its canonical form".to_string());
    }
    Ok(parsed)
}

/// The bytes of one chunk. The text is bounded before it is decoded, and the decoded length again after, so a text
/// that fits the first bound but decodes to more than `MAX_CHUNK_BYTES` is refused as well.
pub fn decode_chunk(data: &str) -> Result<Vec<u8>, String> {
    if data.len() > MAX_CHUNK_BYTES / 3 * 4 + 4 {
        return Err("too-large: the chunk text is larger than a chunk may be".to_string());
    }
    let bytes = general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("malformed: the chunk is not valid base64: {}", e))?;
    if bytes.len() > MAX_CHUNK_BYTES {
        return Err("too-large: the chunk is larger than a chunk may be".to_string());
    }
    Ok(bytes)
}

/// Writes every byte of `bytes` to `writer` (a partial write is continued; only an error or a write of zero bytes
/// fails), then, on `last`, asks `sync` to flush it. A failed sync is not a failed export: it answers `synced: false`.
/// The reply's `written` is the decoded length. `synced` is present only when `last`.
pub fn append_to<W: Write>(
    writer: &mut W,
    bytes: &[u8],
    last: bool,
    sync: impl FnOnce(&mut W) -> std::io::Result<()>,
) -> Result<Value, String> {
    writer
        .write_all(bytes)
        .map_err(|e| format!("write-failed: {}", e))?;
    if !last {
        return Ok(json!({ "written": bytes.len() as u64 }));
    }
    let synced = sync(writer).is_ok();
    Ok(json!({ "written": bytes.len() as u64, "synced": synced }))
}

/// Opens the document once more without writing, reads the size of the descriptor it yielded, and closes it. Nothing
/// can fail the export from here: a failed or panicking `open` answers `open-failed`, a failed size answers
/// `stat-failed`, and no error text is ever placed in the answer (the plugin's error text can name the URI).
/// The answer is `{ "reopenSize": n }` or `{ "reopen": "open-failed" | "stat-failed" }`.
pub fn reopen_note<F>(
    open: impl FnOnce() -> std::io::Result<F> + std::panic::UnwindSafe,
    size: impl FnOnce(&F) -> std::io::Result<u64>,
) -> Value {
    match std::panic::catch_unwind(open) {
        Ok(Ok(file)) => match size(&file) {
            Ok(n) => json!({ "reopenSize": n }),
            Err(_) => json!({ "reopen": "stat-failed" }),
        },
        Ok(Err(_)) | Err(_) => json!({ "reopen": "open-failed" }),
    }
}

/// Adds the fields of a reopen answer to the reply of a chunk that was written. It is only called with the reply of a
/// successful append, so a reopen answer can never replace or hide a write failure; `written` and `synced` are kept.
pub fn merge_reopen(reply: Value, note: Value) -> Value {
    match (reply, note) {
        (Value::Object(mut fields), Value::Object(extra)) => {
            for (key, value) in extra {
                fields.entry(key).or_insert(value);
            }
            Value::Object(fields)
        }
        (reply, _) => reply,
    }
}

/// One chunk of an export file: `create` truncates the document first, otherwise the chunk is appended; `last` also
/// syncs the file and then, once the write has succeeded, opens the document once more in append mode without writing
/// and reports the size of that descriptor. The result is `{ "written": n }`, with `"synced": bool` and a reopen
/// field (`"reopenSize"` or `"reopen"`) on a last chunk. A failed reopen never changes the result of the write.
#[tauri::command]
pub async fn export_append_b64(
    app: tauri::AppHandle,
    uri: String,
    data: String,
    create: bool,
    last: bool,
) -> Result<Value, String> {
    let target = check_target(&uri)?;
    let bytes = decode_chunk(&data)?;
    drop(data);
    let reopen_target = if last { Some(target.clone()) } else { None };
    let reopen_app = app.clone();
    let reply = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_fs::FsExt;
        let mut options = tauri_plugin_fs::OpenOptions::new();
        if create {
            options.read(false).write(true).truncate(true);
        } else {
            options.read(false).write(true).append(true);
        }
        let mut file = app
            .fs()
            .open(tauri_plugin_fs::FilePath::Url(target), options.clone())
            .map_err(|e| format!("open-failed: {}", e))?;
        append_to(&mut file, &bytes, last, |f| f.sync_all())
    })
    .await
    .map_err(|e| format!("the write task failed: {}", e))??;
    let Some(reopen_target) = reopen_target else {
        return Ok(reply);
    };
    // A separate task: a panic here is a JoinError for this task only and cannot reach the finished write above.
    let note = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_fs::FsExt;
        let mut options = tauri_plugin_fs::OpenOptions::new();
        options.read(false).write(true).append(true);
        reopen_note(
            std::panic::AssertUnwindSafe(|| {
                reopen_app
                    .fs()
                    .open(tauri_plugin_fs::FilePath::Url(reopen_target), options)
            }),
            |f| f.metadata().map(|m| m.len()),
        )
    })
    .await
    .unwrap_or_else(|_| json!({ "reopen": "open-failed" }));
    Ok(merge_reopen(reply, note))
}
// end of command

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    const SAF_URI: &str =
        "content://com.android.externalstorage.documents/document/primary%3ADownload%2Frisu-backup.bin";

    #[test]
    fn check_target_accepts_a_real_document_uri() {
        assert!(check_target(SAF_URI).is_ok());
    }

    #[test]
    fn check_target_accepts_a_document_id_holding_two_dots() {
        let uri = "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fa..bin";
        assert!(check_target(uri).is_ok());
    }

    #[test]
    fn check_target_refuses_everything_else() {
        let long = format!("content://auth/{}", "a".repeat(MAX_URI_BYTES));
        let refused = [
            "../x.bin",
            "/x.bin",
            "file:///x.bin",
            "https://auth/x",
            "",
            "content://auth/x\0y",
            long.as_str(),
            "content:foo",
            "content://auth/doc/../other",
            " content://auth/x",
            "content://auth/a\tb",
        ];
        for uri in refused {
            let err = check_target(uri).expect_err(uri);
            assert!(err.starts_with("refused-target:"), "{uri}: {err}");
        }
    }

    #[test]
    fn decode_chunk_accepts_exactly_the_cap() {
        let text = general_purpose::STANDARD.encode(vec![7u8; MAX_CHUNK_BYTES]);
        assert_eq!(decode_chunk(&text).unwrap().len(), MAX_CHUNK_BYTES);
    }

    #[test]
    fn decode_chunk_refuses_a_chunk_one_and_two_bytes_over_the_cap_after_decoding() {
        for extra in [1usize, 2] {
            let text = general_purpose::STANDARD.encode(vec![7u8; MAX_CHUNK_BYTES + extra]);
            assert!(text.len() <= MAX_CHUNK_BYTES / 3 * 4 + 4, "the text must pass the first bound");
            let err = decode_chunk(&text).expect_err("over the cap");
            assert!(err.starts_with("too-large:"), "{err}");
        }
    }

    #[test]
    fn decode_chunk_refuses_over_long_text_before_decoding() {
        // Not base64 at all: only the length bound can have produced a too-large answer.
        let text = "!".repeat(MAX_CHUNK_BYTES / 3 * 4 + 5);
        let err = decode_chunk(&text).expect_err("too long");
        assert!(err.starts_with("too-large:"), "{err}");
    }

    #[test]
    fn decode_chunk_refuses_invalid_and_unpadded_text() {
        assert!(decode_chunk("not base64!").unwrap_err().starts_with("malformed:"));
        assert!(decode_chunk("QQ").unwrap_err().starts_with("malformed:"));
        assert_eq!(decode_chunk("QQ==").unwrap(), b"A");
        assert_eq!(decode_chunk("").unwrap(), Vec::<u8>::new());
    }

    /// Accepts at most `per_call` bytes per `write`, as a provider may.
    struct Partial {
        per_call: usize,
        out: Vec<u8>,
    }
    impl Write for Partial {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let n = buf.len().min(self.per_call);
            self.out.extend_from_slice(&buf[..n]);
            Ok(n)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct Zero;
    impl Write for Zero {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Ok(0)
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct Failing;
    impl Write for Failing {
        fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
            Err(io::Error::other("disk full"))
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn append_to_lands_every_byte_of_a_partial_writer_in_order() {
        let bytes: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let mut writer = Partial { per_call: 7, out: Vec::new() };
        let reply = append_to(&mut writer, &bytes, false, |_| Ok(())).unwrap();
        assert_eq!(writer.out, bytes);
        assert_eq!(reply, json!({ "written": 1000 }));
    }

    #[test]
    fn append_to_fails_on_a_zero_length_write() {
        let err = append_to(&mut Zero, b"abc", false, |_| Ok(())).unwrap_err();
        assert!(err.starts_with("write-failed:"), "{err}");
    }

    #[test]
    fn append_to_fails_on_a_write_error() {
        let err = append_to(&mut Failing, b"abc", true, |_| Ok(())).unwrap_err();
        assert!(err.starts_with("write-failed:"), "{err}");
    }

    #[test]
    fn append_to_syncs_only_on_the_last_chunk() {
        let mut writer = Partial { per_call: 100, out: Vec::new() };
        let mut synced = 0;
        let reply = append_to(&mut writer, b"abc", false, |_| {
            synced += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(synced, 0);
        assert!(reply.get("synced").is_none());
        let reply = append_to(&mut writer, b"def", true, |_| {
            synced += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(synced, 1);
        assert_eq!(reply, json!({ "written": 3, "synced": true }));
    }

    #[test]
    fn append_to_answers_synced_false_when_the_sync_fails() {
        let mut writer = Partial { per_call: 100, out: Vec::new() };
        let reply = append_to(&mut writer, b"abc", true, |_| Err(io::Error::other("no sync"))).unwrap();
        assert_eq!(writer.out, b"abc");
        assert_eq!(reply, json!({ "written": 3, "synced": false }));
    }

    // Unit tests of the reopen helpers only. The native "wa" open of a content:// document is not tested offline.
    #[test]
    fn reopen_note_reports_the_size_of_the_reopened_descriptor() {
        let note = reopen_note(|| Ok(42u64), |f| Ok(*f));
        assert_eq!(note, json!({ "reopenSize": 42 }));
    }

    #[test]
    fn reopen_note_answers_open_failed_without_the_error_text() {
        let note = reopen_note(
            || Err::<u64, _>(io::Error::other("content://secret/document/id")),
            |f| Ok(*f),
        );
        assert_eq!(note, json!({ "reopen": "open-failed" }));
        assert!(!note.to_string().contains("secret"));
    }

    #[test]
    fn reopen_note_answers_stat_failed_without_the_error_text() {
        let note = reopen_note(|| Ok(1u64), |_| Err(io::Error::other("content://secret/stat")));
        assert_eq!(note, json!({ "reopen": "stat-failed" }));
        assert!(!note.to_string().contains("secret"));
    }

    #[test]
    fn reopen_note_maps_a_panicking_open_to_open_failed() {
        let note = reopen_note(
            || -> io::Result<u64> { panic!("null descriptor") },
            |f| Ok(*f),
        );
        assert_eq!(note, json!({ "reopen": "open-failed" }));
    }

    #[test]
    fn merge_reopen_keeps_the_append_reply_and_adds_only_the_reopen_field() {
        let reply = json!({ "written": 3, "synced": true });
        let panicked = reopen_note(|| -> io::Result<u64> { panic!("null descriptor") }, |f| Ok(*f));
        assert_eq!(
            merge_reopen(reply.clone(), panicked),
            json!({ "written": 3, "synced": true, "reopen": "open-failed" })
        );
        assert_eq!(
            merge_reopen(reply, json!({ "reopenSize": 3 })),
            json!({ "written": 3, "synced": true, "reopenSize": 3 })
        );
    }

    #[test]
    fn merge_reopen_never_overwrites_a_field_of_the_append_reply() {
        let merged = merge_reopen(json!({ "written": 3, "synced": false }), json!({ "written": 99, "reopenSize": 3 }));
        assert_eq!(merged, json!({ "written": 3, "synced": false, "reopenSize": 3 }));
    }

    #[test]
    fn append_to_an_empty_last_chunk_only_syncs() {
        let mut writer = Partial { per_call: 100, out: Vec::new() };
        let reply = append_to(&mut writer, b"", true, |_| Ok(())).unwrap();
        assert!(writer.out.is_empty());
        assert_eq!(reply, json!({ "written": 0, "synced": true }));
    }
}
