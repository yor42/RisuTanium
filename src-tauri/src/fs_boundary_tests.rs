//! What the Android build lets a page reach through the fs plugin, the key commands and the export command.
//!
//! Every test that writes or deletes runs in its own fresh directory under the system temp directory. The app's
//! directories are redirected into that directory before the app is built, and each target path is asserted to lie
//! under it before the call. Only synthetic marker bytes are written.

use crate::app_fs::{exists_key, mkdir_all_key, remove_key, remove_key_guarded, sweep_write_temps};
use crate::asset_batch::{write_chunk_raw_with, Outcome, RawChunkHeaders};
use crate::chunked_io::{abort_chunk_key, read_key_range, read_key_range_text, write_chunk_key};
use crate::durable_write::{write_key_durable, RealOps};
use crate::export_append::{check_target, export_append_b64};
use crate::fs_guard::{android_command_kind, android_verdict, foreign_content_uri, for_os, Guarded};
use crate::store_keys::{inside_store_set, ROOT_FILES, STORE_DIRECTORIES};
use crate::store2_gate::{remove_with, ungated_remove_refusal, ungated_write_refusal, write_top, Store2Gate};
use base64::{engine::general_purpose, Engine};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{CallbackFn, Invoke, InvokeBody, InvokeResponseBody};
use tauri::plugin::Plugin;
use tauri::{AppHandle, RunEvent, Runtime, Url, Webview, Window};
use tauri_plugin_fs::SafeFilePath;
use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY};
use tauri::utils::acl::ExecutionContext;
use tauri::utils::config::{AppDirectoriesOverride, FsScope};
use tauri::utils::platform::Target;
use tauri::webview::InvokeRequest;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const OWN: &str = "io.github.yor42.risutanium";
const MARKER: &[u8] = b"s1a-marker-bytes";
const ID: &str = "0123456789abcdef";
const TEMP: &str = "risu-write-0123456789abcdef.tmp";
const OUTSIDE_MESSAGE: &str = "refused key: outside the app's store";
/// What the pinned fs plugin answers a content URL on a host that is not Android: it has no content resolver there.
const PLUGIN_URL_ANSWER: &str = "URL is not a valid path";

const FIXTURE: &str = include_str!("../tests/fixtures/android-boundary.json");
const URIS: &str = include_str!("../gen/android/app/src/test/resources/picker-result-v1/uris.txt");

type Answer = Result<InvokeResponseBody, Value>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("the boundary fixture is JSON")
}

fn fixture_strings(path: &[&str]) -> Vec<String> {
    let mut node = fixture();
    for step in path {
        node = node[*step].take();
    }
    node.as_array()
        .unwrap_or_else(|| panic!("fixture {:?} is a list", path))
        .iter()
        .map(|v| v.as_str().expect("a fixture string").to_string())
        .collect()
}

fn store_directories() -> Vec<String> {
    fixture_strings(&["directories"])
}

fn root_files() -> Vec<String> {
    fixture_strings(&["rootFiles"])
}

fn every_fixture_key() -> Vec<String> {
    let mut keys = fixture_strings(&["keys", "head"]);
    for key in fixture_strings(&["keys", "baseline"]) {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

struct UriRow {
    accept: bool,
    text: String,
}

fn uri_rows() -> Vec<UriRow> {
    URIS.lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let (kind, text) = line.split_once('\t').expect("a row is kind, tab, text");
            let accept = match kind {
                "accept" => true,
                "refuse" => false,
                other => panic!("unknown row kind {other}"),
            };
            UriRow { accept, text: text.to_string() }
        })
        .collect()
}

fn b64(bytes: &[u8]) -> String {
    general_purpose::STANDARD.encode(bytes)
}

// ---------------------------------------------------------------------------
// A fresh temp root and a mock app whose directories lie inside it
// ---------------------------------------------------------------------------

struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    fn new() -> TempRoot {
        let parent = std::env::temp_dir();
        let path = parent.join(format!("risu-fsb-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&path).expect("create the temp root");
        assert!(path.starts_with(&parent), "the temp root must lie under the temp directory");
        TempRoot { path }
    }

    /// A directory that stands in for the app data directory in key-level tests.
    fn base(&self) -> PathBuf {
        let base = self.path.join("base");
        fs::create_dir_all(&base).expect("create the base");
        self.assert_under(&base);
        base
    }

    fn assert_under(&self, path: &Path) {
        assert!(path.starts_with(&self.path), "{} is outside the temp root {}", path.display(), self.path.display());
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        if self.path.starts_with(std::env::temp_dir()) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

struct Harness {
    app: tauri::App<MockRuntime>,
    webview: tauri::WebviewWindow<MockRuntime>,
    data: PathBuf,
    root: TempRoot,
}

/// A mock app built through `app_plugins` for `os`, with the production identifier, its directories inside a fresh
/// temp root, the whole root in the fs plugin's runtime scope (so only a gate can refuse), and `commands` of the fs
/// plugin allowed through the access control list.
fn harness(os: &str, commands: &[&str]) -> Harness {
    let root = TempRoot::new();
    let directories_root = root.path.clone();
    harness_in(os, commands, root, directories_root)
}

/// Like `harness`, with the app's directories override set to `directories_root`, which must lie inside `root`.
fn harness_in(os: &str, commands: &[&str], root: TempRoot, directories_root: PathBuf) -> Harness {
    root.assert_under(&directories_root);
    let mut context = mock_context(noop_assets());
    context.config_mut().identifier = OWN.into();
    context.config_mut().app.app_directories_override = Some(AppDirectoriesOverride::Root(directories_root));
    for command in commands {
        context
            .runtime_authority_mut()
            .__allow_command(format!("plugin:fs|{command}"), ExecutionContext::Local);
    }
    let app = crate::app_plugins::<MockRuntime>(mock_builder(), os).build(context).expect("the mock app builds");
    let data = app.path().app_data_dir().expect("an app data directory");
    root.assert_under(&data);
    fs::create_dir_all(&data).expect("create the data directory");
    app.fs_scope().allow_directory(&root.path, true).expect("allow the temp root");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
        .build()
        .expect("a mock webview");
    Harness { app, webview, data, root }
}

fn invoke(h: &Harness, cmd: &str, body: InvokeBody, headers: tauri::http::HeaderMap) -> Answer {
    get_ipc_response(
        &h.webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body,
            headers,
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

fn invoke_json(h: &Harness, cmd: &str, body: Value) -> Answer {
    invoke(h, cmd, InvokeBody::Json(body), tauri::http::HeaderMap::new())
}

fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

/// `write_file` as the fs 2.6.0 script sends it: the path in a header, the bytes as the raw body.
fn write_file_answer(h: &Harness, path_text: &str, bytes: &[u8]) -> Answer {
    let mut headers = tauri::http::HeaderMap::new();
    headers.insert("path", tauri::http::HeaderValue::from_str(&encode_component(path_text)).unwrap());
    invoke(h, "plugin:fs|write_file", InvokeBody::Raw(bytes.to_vec()), headers)
}

fn plant(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn refused_fs(answer: &Answer) -> bool {
    matches!(answer, Err(value) if value.as_str().map_or(false, |text| text.starts_with("refused-fs:")))
}

// ---------------------------------------------------------------------------
// D1
// ---------------------------------------------------------------------------

#[test]
fn d1_a_mock_app_builds_with_every_directory_inside_the_temp_root() {
    let h = harness("android", &[]);
    assert!(h.data.starts_with(&h.root.path));
    assert_eq!(h.app.config().identifier, OWN);
    for dir in [
        h.app.path().app_data_dir(),
        h.app.path().app_cache_dir(),
        h.app.path().app_local_data_dir(),
        h.app.path().app_config_dir(),
        h.app.path().app_log_dir(),
    ] {
        let dir = dir.expect("an app directory");
        assert!(dir.starts_with(&h.root.path), "{} is outside the temp root", dir.display());
    }
}

// ---------------------------------------------------------------------------
// T1, T2, T3: the bare fs plugin on Android
// ---------------------------------------------------------------------------

#[test]
fn t1_write_file_to_an_absolute_path_outside_the_store_is_refused_and_leaves_the_file() {
    let h = harness("android", &["write_file"]);
    let file = h.root.path.join("outside").join("marker.bin");
    plant(&file, MARKER);
    h.root.assert_under(&file);
    let answer = write_file_answer(&h, file.to_str().unwrap(), b"OVERWRITTEN");
    let on_disk = fs::read(&file).unwrap();
    assert!(refused_fs(&answer), "write_file to an absolute path outside the store was not refused by the gate: {answer:?}");
    assert_eq!(on_disk, MARKER, "the file outside the store was overwritten");
}

#[test]
fn t2_write_file_to_a_file_url_outside_the_store_is_refused_and_leaves_the_file() {
    let h = harness("android", &["write_file"]);
    let file = h.root.path.join("outside").join("marker.bin");
    plant(&file, MARKER);
    h.root.assert_under(&file);
    let url = url::Url::from_file_path(&file).expect("a file URL");
    let answer = write_file_answer(&h, url.as_str(), b"OVERWRITTEN");
    let on_disk = fs::read(&file).unwrap();
    assert!(refused_fs(&answer), "write_file to a file URL outside the store was not refused by the gate: {answer:?}");
    assert_eq!(on_disk, MARKER, "the file behind the file URL was overwritten");
}

#[test]
fn t3_a_file_url_reaches_no_other_fs_command() {
    let h = harness("android", &["open", "read_file", "remove", "rename", "mkdir"]);
    let outside = h.root.path.join("outside");
    let file = outside.join("marker.bin");
    let moved = outside.join("moved.bin");
    let made = outside.join("made");
    plant(&file, MARKER);
    for path in [&file, &moved, &made] {
        h.root.assert_under(path);
    }
    let url = |path: &Path| url::Url::from_file_path(path).expect("a file URL").to_string();
    let mut failures: Vec<String> = Vec::new();

    let answer = invoke_json(&h, "plugin:fs|open", json!({ "path": url(&file), "options": { "write": true, "truncate": true } }));
    if !refused_fs(&answer) {
        failures.push(format!("open write+truncate was not refused by the gate: {answer:?}"));
    }
    if fs::read(&file).unwrap_or_default() != MARKER {
        failures.push("open write+truncate changed the file".into());
    }
    plant(&file, MARKER);

    let answer = invoke_json(&h, "plugin:fs|open", json!({ "path": url(&file), "options": { "read": true } }));
    if !refused_fs(&answer) {
        failures.push(format!("read-only open was not refused by the gate: {answer:?}"));
    }
    let answer = invoke_json(&h, "plugin:fs|read_file", json!({ "path": url(&file) }));
    if !refused_fs(&answer) {
        failures.push(format!("read_file was not refused by the gate: {answer:?}"));
    }
    let answer = invoke_json(&h, "plugin:fs|rename", json!({ "oldPath": url(&file), "newPath": url(&moved) }));
    if !refused_fs(&answer) || moved.exists() || !file.exists() {
        failures.push(format!("rename was not refused by the gate or moved the file: {answer:?}"));
    }
    let answer = invoke_json(&h, "plugin:fs|mkdir", json!({ "path": url(&made), "options": { "recursive": true } }));
    if !refused_fs(&answer) || made.exists() {
        failures.push(format!("mkdir was not refused by the gate or made a directory: {answer:?}"));
    }
    let answer = invoke_json(&h, "plugin:fs|remove", json!({ "path": url(&file) }));
    if !refused_fs(&answer) || !file.exists() {
        failures.push(format!("remove was not refused by the gate or deleted the file: {answer:?}"));
    }
    assert!(failures.is_empty(), "file URL cells not refused: {failures:#?}");
}

// ---------------------------------------------------------------------------
// T4b, T4c, T4d
// ---------------------------------------------------------------------------

#[test]
fn t4b_a_foreign_content_open_and_a_path_read_dir_are_the_plugins_own_answer() {
    let h = harness("android", &["open", "read_dir"]);
    let assets = h.data.join("assets");
    plant(&assets.join("a.bin"), MARKER);
    h.root.assert_under(&assets);
    let opened = invoke_json(
        &h,
        "plugin:fs|open",
        json!({
            "path": "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fx.bin",
            "options": { "read": true }
        }),
    );
    assert!(!refused_fs(&opened), "a foreign content open was refused by the gate: {opened:?}");
    assert!(
        matches!(&opened, Err(value) if value.as_str() == Some(PLUGIN_URL_ANSWER)),
        "a foreign content open did not get the fs plugin's own answer on this host: {opened:?}"
    );
    let listed = invoke_json(&h, "plugin:fs|read_dir", json!({ "path": assets.to_str().unwrap() }));
    assert!(!refused_fs(&listed), "a path read_dir was refused by the gate: {listed:?}");
    assert!(listed.is_ok(), "the plugin did not list a directory inside its scope: {listed:?}");
}

#[test]
fn t4c_a_pass_through_target_writes_a_file() {
    let h = harness("windows", &["write_file"]);
    let file = h.root.path.join("outside").join("pass.bin");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    h.root.assert_under(&file);
    let answer = write_file_answer(&h, file.to_str().unwrap(), MARKER);
    assert!(answer.is_ok(), "write_file did not work on a desktop target: {answer:?}");
    assert_eq!(fs::read(&file).unwrap(), MARKER);
}

#[test]
fn t4d_unknown_and_refused_fs_commands_answer_refused_fs_on_android() {
    let names = [
        "write_file",
        "write_text_file",
        "read_file",
        "read_text_file",
        "remove",
        "rename",
        "mkdir",
        "copy_file",
        "create",
        "truncate",
        "stat",
        "lstat",
        "exists",
        "watch",
        "unwatch",
        "no_such_command",
        "",
    ];
    let h = harness("android", &names);
    let mut failures: Vec<String> = Vec::new();
    for name in names {
        let answer = invoke_json(&h, &format!("plugin:fs|{name}"), json!({}));
        if !refused_fs(&answer) {
            failures.push(format!("{name:?}: {answer:?}"));
        }
    }
    assert!(failures.is_empty(), "commands not answered with refused-fs: {failures:#?}");
}

// ---------------------------------------------------------------------------
// T5, T5b: the export target rule
// ---------------------------------------------------------------------------

#[test]
fn t5_check_target_refuses_every_refuse_row() {
    let failures: Vec<String> = uri_rows()
        .into_iter()
        .filter(|row| !row.accept)
        .filter(|row| match check_target(&row.text, OWN) {
            Ok(_) => true,
            Err(message) => !message.starts_with("refused-target:"),
        })
        .map(|row| row.text)
        .collect();
    assert!(failures.is_empty(), "refuse rows check_target did not refuse: {failures:#?}");
}

#[test]
fn t5_check_target_refuses_localhost_in_every_form() {
    let failures: Vec<String> = [
        "content://localhost/C:/dv603/x",
        "content://LocalHost/C:/dv603/x",
        "content://LOCALHOST/x",
        "content://0@localhost/C:/dv603/x",
        "content://10@LocalHost/x",
        "content://localhost:80/x",
    ]
    .iter()
    .filter(|text| check_target(text, OWN).is_ok())
    .map(|text| text.to_string())
    .collect();
    assert!(failures.is_empty(), "localhost forms check_target accepted: {failures:#?}");
}

/// A refuse row whose authority names this machine, retargeted at a file inside the temp root so a base that
/// accepts it can only ever touch the synthetic marker there.
fn retarget(text: &str, root_forward: &str) -> String {
    let path = if cfg!(windows) { format!("/{root_forward}/x") } else { format!("{root_forward}/x") };
    // Rows with the fixture's own synthetic paths end in one of these; the path part is replaced and the
    // authority part (possibly empty, possibly only a user prefix) is kept.
    for suffix in ["/C:/dv603/x", "/x"] {
        if let Some(rest) = text.strip_prefix("content://") {
            let authority = rest.strip_suffix(suffix).unwrap_or(rest);
            let names_this_machine = authority.is_empty()
                || authority.to_ascii_lowercase().contains("localhost")
                || authority.ends_with('@');
            if rest.ends_with(suffix) && names_this_machine {
                return format!("content://{authority}{path}");
            }
        }
    }
    text.to_string()
}

#[test]
fn t5_retarget_points_every_empty_or_local_authority_row_inside_the_temp_root() {
    let root = "C:/tmp/risu-603-root";
    let path = if cfg!(windows) { format!("/{root}/x") } else { format!("{root}/x") };
    for (text, authority) in [
        ("content:///C:/dv603/x", ""),
        ("content://0@/x", "0@"),
        ("content://localhost/C:/dv603/x", "localhost"),
        ("content://0@LocalHost/x", "0@LocalHost"),
    ] {
        assert_eq!(retarget(text, root), format!("content://{authority}{path}"), "{text}");
    }
    assert_eq!(retarget("content://com.android.externalstorage.documents/x", root), "content://com.android.externalstorage.documents/x");
}

#[test]
fn t5_export_append_refuses_every_refuse_row_and_never_touches_the_marker() {
    let h = harness("android", &[]);
    let marker = h.root.path.join("x");
    plant(&marker, MARKER);
    h.root.assert_under(&marker);
    let root_forward = h.root.path.to_str().unwrap().replace('\\', "/");
    let mut failures: Vec<String> = Vec::new();
    for row in uri_rows().into_iter().filter(|row| !row.accept) {
        let uri = retarget(&row.text, &root_forward);
        let answer = tauri::async_runtime::block_on(export_append_b64(
            h.app.handle().clone(),
            uri.clone(),
            "AA==".to_string(),
            true,
            false,
        ));
        let refused = matches!(&answer, Err(message) if message.starts_with("refused-target:"));
        let intact = fs::read(&marker).map(|bytes| bytes == MARKER).unwrap_or(false);
        if !refused || !intact {
            failures.push(format!("{}: answer {:?}, marker intact {}", row.text, answer, intact));
            plant(&marker, MARKER);
        }
    }
    assert!(failures.is_empty(), "refuse rows the export command did not refuse: {failures:#?}");
}

#[test]
fn t5b_every_accept_row_passes_the_rule_and_fails_only_at_the_open() {
    let h = harness("android", &[]);
    let mut failures: Vec<String> = Vec::new();
    for row in uri_rows().into_iter().filter(|row| row.accept) {
        if let Err(message) = check_target(&row.text, OWN) {
            failures.push(format!("{}: check_target {}", row.text, message));
            continue;
        }
        let answer = tauri::async_runtime::block_on(export_append_b64(
            h.app.handle().clone(),
            row.text.clone(),
            "AA==".to_string(),
            true,
            false,
        ));
        match answer {
            Err(message) if message.starts_with("open-failed:") => {}
            other => failures.push(format!("{}: {:?}", row.text, other)),
        }
    }
    assert!(failures.is_empty(), "accept rows not answered with open-failed: {failures:#?}");
}

// ---------------------------------------------------------------------------
// T6: the ten commands over keys outside the store set
// ---------------------------------------------------------------------------

const CELL_KEYS: [&str; 7] = [
    "shared_prefs/x",
    "cache/app-update/x",
    "databases/x",
    "files/x",
    "app_webview/x",
    "Assets/x",
    "store2-owner/x",
];

fn is_refusal(result: &Result<impl Sized, String>) -> bool {
    matches!(result, Err(message) if message.starts_with("refused key:"))
}

/// The exact refusal of a key outside the store set; another guard's `refused key:` text does not count.
fn is_outside(result: &Result<impl Sized, String>) -> bool {
    matches!(result, Err(message) if message == OUTSIDE_MESSAGE)
}

fn first_segment_exists(base: &Path, key: &str) -> bool {
    base.join(key.split('/').next().unwrap()).exists()
}

fn raw_headers(key: &str, offset: u64, last: bool, final_key: Option<&str>) -> RawChunkHeaders {
    RawChunkHeaders {
        key: key.to_string(),
        id: ID.to_string(),
        offset,
        last,
        durable: false,
        final_key: final_key.map(str::to_string),
    }
}

/// Runs `body` once per key in a fresh base, collecting the keys it reports as failing.
fn per_cell(keys: &[&str], body: impl Fn(&TempRoot, &Path, &str) -> Option<String>) -> Vec<String> {
    let mut failures = Vec::new();
    for key in keys {
        let root = TempRoot::new();
        let base = root.base();
        if let Some(why) = body(&root, &base, key) {
            failures.push(format!("{key}: {why}"));
        }
    }
    failures
}

#[test]
fn t6_write_durable_refuses_and_changes_nothing() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let result = write_key_durable(base, key, MARKER);
        (!is_outside(&result) || first_segment_exists(base, key)).then(|| format!("{result:?}, wrote: {}", first_segment_exists(base, key)))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_write_chunk_refuses_and_changes_nothing() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let result = write_chunk_key(base, key, ID, 0, &b64(MARKER), true, false, None);
        (!is_outside(&result) || first_segment_exists(base, key)).then(|| format!("{result:?}, wrote: {}", first_segment_exists(base, key)))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_write_chunk_raw_refuses_and_changes_nothing() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let outcome = write_chunk_raw_with(&RealOps, base, &raw_headers(key, 0, true, None), MARKER);
        let refused = matches!(&outcome, Outcome::Invalid(message) if message == OUTSIDE_MESSAGE);
        (!refused || first_segment_exists(base, key)).then(|| format!("{outcome:?}, wrote: {}", first_segment_exists(base, key)))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_mkdir_all_refuses_and_creates_nothing() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let result = mkdir_all_key(base, key);
        (!is_outside(&result) || first_segment_exists(base, key)).then(|| format!("{result:?}, created: {}", first_segment_exists(base, key)))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_remove_refuses_and_keeps_the_planted_file() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let path = base.join(key);
        plant(&path, MARKER);
        let result = remove_key_guarded(base, key);
        (!is_outside(&result) || !path.exists()).then(|| format!("{result:?}, remains: {}", path.exists()))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_abort_chunked_refuses_and_keeps_the_planted_temp() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let temp = base.join(key).parent().unwrap().join(TEMP);
        plant(&temp, MARKER);
        let result = abort_chunk_key(base, key, ID);
        (!is_outside(&result) || !temp.exists()).then(|| format!("{result:?}, temp remains: {}", temp.exists()))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_sweep_lists_a_failure_and_keeps_the_planted_temp() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        let temp = base.join(key).join(TEMP);
        plant(&temp, MARKER);
        let report = sweep_write_temps(base, &[key.to_string()]);
        let listed = report.failures.iter().any(|message| message == OUTSIDE_MESSAGE);
        (!listed || !temp.exists()).then(|| format!("failures {:?}, removed {}, temp remains: {}", report.failures, report.removed, temp.exists()))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_reads_refuse_a_planted_file() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        plant(&base.join(key), MARKER);
        let bytes = read_key_range(base, key, 0, 64);
        let text = read_key_range_text(base, key, 0, 64);
        (!is_outside(&bytes) || !is_outside(&text))
            .then(|| format!("read_range ok: {}, read_range_text ok: {}", bytes.is_ok(), text.is_ok()))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_exists_refuses_a_planted_file() {
    let failures = per_cell(&CELL_KEYS, |_, base, key| {
        plant(&base.join(key), MARKER);
        let result = exists_key(base, key);
        (!is_outside(&result)).then(|| format!("{result:?}"))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

const REPLY_KEYS: [&str; 2] = ["native-reply/x", "Native-Reply/x"];

#[test]
fn t6_native_reply_writes_and_remove_are_refused() {
    let failures = per_cell(&REPLY_KEYS, |_, base, key| {
        let mut why: Vec<String> = Vec::new();
        let durable = write_key_durable(base, key, MARKER);
        if !is_refusal(&durable) {
            why.push(format!("write_durable {durable:?}"));
        }
        let chunk = write_chunk_key(base, key, ID, 0, &b64(MARKER), true, false, None);
        if !is_refusal(&chunk) {
            why.push(format!("write_chunk {chunk:?}"));
        }
        let outcome = write_chunk_raw_with(&RealOps, base, &raw_headers(key, 0, true, None), MARKER);
        if !matches!(&outcome, Outcome::Invalid(message) if message.starts_with("refused key:")) {
            why.push(format!("write_chunk_raw {outcome:?}"));
        }
        let path = base.join(key);
        plant(&path, MARKER);
        let removed = remove_key_guarded(base, key);
        if !is_refusal(&removed) || !path.exists() {
            why.push(format!("remove {removed:?}"));
        }
        (!why.is_empty()).then(|| why.join("; "))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_native_reply_other_entries_are_refused() {
    let failures = per_cell(&REPLY_KEYS, |_, base, key| {
        let mut why: Vec<String> = Vec::new();
        let made = mkdir_all_key(base, key);
        if !is_outside(&made) || first_segment_exists(base, key) {
            why.push(format!("mkdir_all {made:?}"));
        }
        let path = base.join(key);
        let _ = fs::remove_dir_all(base.join(key.split('/').next().unwrap()));
        plant(&path, MARKER);
        let exists = exists_key(base, key);
        if !is_outside(&exists) {
            why.push(format!("exists {exists:?}"));
        }
        let bytes = read_key_range(base, key, 0, 64);
        if !is_outside(&bytes) {
            why.push(format!("read_range {:?}", bytes.as_ref().map(|_| ())));
        }
        let text = read_key_range_text(base, key, 0, 64);
        if !is_outside(&text) {
            why.push(format!("read_range_text {:?}", text.as_ref().map(|_| ())));
        }
        let temp = path.parent().unwrap().join(TEMP);
        plant(&temp, MARKER);
        let aborted = abort_chunk_key(base, key, ID);
        if !is_outside(&aborted) || !temp.exists() {
            why.push(format!("abort {aborted:?}, temp remains: {}", temp.exists()));
        }
        let swept_temp = path.join(TEMP);
        let _ = fs::remove_file(&path);
        plant(&swept_temp, MARKER);
        let report = sweep_write_temps(base, &[key.to_string()]);
        if !report.failures.iter().any(|message| message == OUTSIDE_MESSAGE) || !swept_temp.exists() {
            why.push(format!("sweep failures {:?}, temp remains: {}", report.failures, swept_temp.exists()));
        }
        (!why.is_empty()).then(|| why.join("; "))
    });
    assert!(failures.is_empty(), "cells not refused: {failures:#?}");
}

#[test]
fn t6_a_backslash_key_is_refused_by_every_command() {
    let key = "assets\\x";
    let root = TempRoot::new();
    let base = root.base();
    let mut why: Vec<String> = Vec::new();
    let durable = write_key_durable(&base, key, MARKER);
    if !is_refusal(&durable) {
        why.push(format!("write_durable {durable:?}"));
    }
    let chunk = write_chunk_key(&base, key, ID, 0, &b64(MARKER), true, false, None);
    if !is_refusal(&chunk) {
        why.push(format!("write_chunk {chunk:?}"));
    }
    let made = mkdir_all_key(&base, key);
    if !is_refusal(&made) {
        why.push(format!("mkdir_all {made:?}"));
    }
    let exists = exists_key(&base, key);
    if !is_refusal(&exists) {
        why.push(format!("exists {exists:?}"));
    }
    let bytes = read_key_range(&base, key, 0, 64);
    if !is_refusal(&bytes) {
        why.push(format!("read_range ok: {}", bytes.is_ok()));
    }
    let text = read_key_range_text(&base, key, 0, 64);
    if !is_refusal(&text) {
        why.push(format!("read_range_text ok: {}", text.is_ok()));
    }
    let raw = write_chunk_raw_with(&RealOps, &base, &raw_headers(key, 0, true, None), MARKER);
    if !matches!(&raw, Outcome::Invalid(message) if message.starts_with("refused key:")) {
        why.push(format!("write_chunk_raw {raw:?}"));
    }
    let removed = remove_key_guarded(&base, key);
    if !is_refusal(&removed) {
        why.push(format!("remove {removed:?}"));
    }
    let aborted = abort_chunk_key(&base, key, ID);
    if !is_refusal(&aborted) {
        why.push(format!("abort {aborted:?}"));
    }
    let report = sweep_write_temps(&base, &[key.to_string()]);
    if report.failures.is_empty() {
        why.push("sweep listed no failure".to_string());
    }
    assert!(why.is_empty(), "backslash cells not refused: {why:#?}");
}

#[test]
fn t6_a_final_key_in_another_folder_is_refused_with_the_final_key_message() {
    let root = TempRoot::new();
    let base = root.base();
    let result = write_chunk_key(&base, "assets/a", ID, 0, &b64(MARKER), true, false, Some("inlays/a"));
    let message = result.expect_err("a cross-folder final key is refused");
    assert!(message.starts_with("refused final key:"), "{message}");
    assert!(!base.join("inlays").exists());
}

// ---------------------------------------------------------------------------
// T6b: a final key that leaves the store set
// ---------------------------------------------------------------------------

#[test]
fn t6b_a_final_key_outside_the_store_set_is_refused_and_leaves_the_owner() {
    let owner = b"owner-bytes".to_vec();
    let mut failures: Vec<String> = Vec::new();
    for (variant, later_last) in [("offset 0", false), ("later last chunk", true)] {
        for raw in [false, true] {
            let root = TempRoot::new();
            let base = root.base();
            plant(&base.join("store2-owner"), &owner);
            let temp = base.join(TEMP);
            let apply = |offset: u64, last: bool, final_key: Option<&str>, bytes: &[u8]| -> Result<(), String> {
                if raw {
                    match write_chunk_raw_with(&RealOps, &base, &raw_headers("store2-owner", offset, last, final_key), bytes) {
                        Outcome::Invalid(message) | Outcome::Error(message) => Err(message),
                        _ => Ok(()),
                    }
                } else {
                    write_chunk_key(&base, "store2-owner", ID, offset, &b64(bytes), last, false, final_key).map(|_| ())
                }
            };
            let result = if later_last {
                if let Err(message) = apply(0, false, None, MARKER) {
                    failures.push(format!("{variant}, raw {raw}: the first chunk failed: {message}"));
                    continue;
                }
                apply(MARKER.len() as u64, true, Some("evil-root"), MARKER)
            } else {
                apply(0, true, Some("evil-root"), MARKER)
            };
            let landed = base.join("evil-root").exists();
            let temp_left = temp.exists();
            let owner_kept = fs::read(base.join("store2-owner")).map(|bytes| bytes == owner).unwrap_or(false);
            let exact = matches!(&result, Err(message) if message == OUTSIDE_MESSAGE);
            if !exact || landed || temp_left || !owner_kept {
                failures.push(format!(
                    "{variant}, raw {raw}: result {result:?}, file landed {landed}, temp left {temp_left}, owner kept {owner_kept}"
                ));
            }
        }
    }
    assert!(failures.is_empty(), "final key cells not refused: {failures:#?}");
}

// ---------------------------------------------------------------------------
// T7: every key a producer uses still works
// ---------------------------------------------------------------------------

fn is_gate_key(key: &str) -> bool {
    key == "store2-commit" || key == "store2-fence"
}

#[test]
fn t7_every_fixture_key_writes_reads_lists_removes_and_sweeps() {
    let mut failures: Vec<String> = Vec::new();
    for key in every_fixture_key() {
        let root = TempRoot::new();
        let base = root.base();
        let gate = Store2Gate::new();
        let path = base.join(&key);

        let written = if is_gate_key(&key) {
            let gen = gate.register(Duration::from_secs(5)).expect("a generation");
            write_top(&gate, &base, gen, &key, MARKER)
        } else {
            write_key_durable(&base, &key, MARKER)
        };
        if written.is_err() || !path.is_file() {
            failures.push(format!("{key}: write {written:?}"));
            continue;
        }
        match read_key_range(&base, &key, 0, 64) {
            Ok(bytes) if bytes.starts_with(MARKER) => {}
            other => failures.push(format!("{key}: read_range {:?}", other.map(|b| b.len()))),
        }
        if read_key_range_text(&base, &key, 0, 64).is_err() {
            failures.push(format!("{key}: read_range_text failed"));
        }
        if exists_key(&base, &key) != Ok(true) {
            failures.push(format!("{key}: exists is not true"));
        }

        let directory = key.rsplit_once('/').map(|(dir, _)| dir.to_string());
        let temp = match &directory {
            Some(dir) => base.join(dir).join(TEMP),
            None => base.join(TEMP),
        };
        plant(&temp, MARKER);
        let swept_directories: Vec<String> = directory.iter().cloned().collect();
        let report = sweep_write_temps(&base, &swept_directories);
        if report.removed != 1 || !report.failures.is_empty() || temp.exists() {
            failures.push(format!("{key}: sweep removed {}, failures {:?}", report.removed, report.failures));
        }

        plant(&temp, MARKER);
        if let Err(message) = abort_chunk_key(&base, &key, ID) {
            failures.push(format!("{key}: abort {message}"));
        }
        if temp.exists() {
            failures.push(format!("{key}: abort left the temp"));
        }

        let removed = if ungated_remove_refusal(&key).is_some() {
            if is_gate_key(&key) {
                remove_key(&base, &key)
            } else {
                let gen = gate.register(Duration::from_secs(5)).expect("a generation");
                match remove_with(&gate, &base, gen, &[key.clone()]) {
                    Ok(report) if report[0]["outcome"] == "removed" => Ok(()),
                    other => Err(format!("{other:?}")),
                }
            }
        } else {
            remove_key_guarded(&base, &key)
        };
        if removed.is_err() || path.exists() {
            failures.push(format!("{key}: remove {removed:?}"));
        }
    }
    assert!(failures.is_empty(), "fixture keys that no longer work: {failures:#?}");
}

#[test]
fn t7_a_plain_write_of_a_gated_key_is_refused_exactly_as_before() {
    let root = TempRoot::new();
    let base = root.base();
    for key in every_fixture_key() {
        let expected = ungated_write_refusal(&key);
        let result = write_key_durable(&base, &key, MARKER);
        match expected {
            Some(reason) => assert_eq!(result, Err(reason.to_string()), "{key}"),
            None => assert!(result.is_ok(), "{key}: {result:?}"),
        }
    }
}

#[test]
fn t7_bare_directories_and_the_empty_key() {
    let root = TempRoot::new();
    let base = root.base();
    for directory in store_directories() {
        assert_eq!(mkdir_all_key(&base, &directory), Ok(()), "mkdir_all {directory}");
        assert_eq!(exists_key(&base, &directory), Ok(true), "exists {directory}");
        assert!(read_key_range(&base, &directory, 0, 8).is_err(), "a directory is not readable: {directory}");
        assert_eq!(remove_key(&base, &directory), Ok(()), "remove {directory}");
    }
    assert_eq!(exists_key(&base, ""), Ok(true));
    assert_eq!(mkdir_all_key(&base, ""), Ok(()));
    assert!(write_key_durable(&base, "", MARKER).is_err());
    assert!(read_key_range(&base, "", 0, 8).is_err());
    assert!(remove_key(&base, "").is_err());
}

#[test]
fn t7_root_files_exist_and_a_root_temp_is_swept() {
    let root = TempRoot::new();
    let base = root.base();
    for file in root_files() {
        plant(&base.join(&file), MARKER);
        assert_eq!(exists_key(&base, &file), Ok(true), "{file}");
    }
    for temp in fixture_strings(&["keys", "temps"]) {
        let path = base.join(&temp);
        plant(&path, MARKER);
        assert_eq!(exists_key(&base, &temp), Ok(true), "exists {temp}");
        assert!(read_key_range(&base, &temp, 0, 8).is_ok(), "read {temp}");
        assert_eq!(remove_key_guarded(&base, &temp), Ok(()), "remove {temp}");
        assert!(!path.exists());
    }
    plant(&base.join(TEMP), MARKER);
    let report = sweep_write_temps(&base, &[]);
    assert_eq!(report.removed, 1);
    assert!(report.failures.is_empty(), "{:?}", report.failures);
}

/// One chunk through the base64 command (`raw` false) or the raw-body command (`raw` true).
fn apply_chunk(raw: bool, base: &Path, key: &str, offset: u64, last: bool, final_key: Option<&str>, bytes: &[u8]) -> Result<(), String> {
    if raw {
        match write_chunk_raw_with(&RealOps, base, &raw_headers(key, offset, last, final_key), bytes) {
            Outcome::Invalid(message) | Outcome::Error(message) => Err(message),
            _ => Ok(()),
        }
    } else {
        write_chunk_key(base, key, ID, offset, &b64(bytes), last, false, final_key).map(|_| ())
    }
}

#[test]
fn t7_every_ungated_fixture_key_takes_chunk_writes_through_both_commands() {
    let first = b"first-half-".to_vec();
    let second = b"second-half".to_vec();
    let whole: Vec<u8> = first.iter().chain(second.iter()).copied().collect();
    let mut failures: Vec<String> = Vec::new();
    for key in every_fixture_key() {
        if ungated_write_refusal(&key).is_some() {
            continue;
        }
        for raw in [false, true] {
            for split in [false, true] {
                let root = TempRoot::new();
                let base = root.base();
                let result = if split {
                    apply_chunk(raw, &base, &key, 0, false, None, &first)
                        .and_then(|_| apply_chunk(raw, &base, &key, first.len() as u64, true, None, &second))
                } else {
                    apply_chunk(raw, &base, &key, 0, true, None, &whole)
                };
                let landed = fs::read(base.join(&key)).map(|bytes| bytes == whole).unwrap_or(false);
                let directory = key.rsplit_once('/').map(|(dir, _)| base.join(dir)).unwrap_or_else(|| base.clone());
                let temp_left = directory.join(TEMP).exists();
                if result.is_err() || !landed || temp_left {
                    failures.push(format!("{key}, raw {raw}, split {split}: {result:?}, landed {landed}, temp left {temp_left}"));
                }
            }
        }
    }
    assert!(failures.is_empty(), "chunk writes that no longer work: {failures:#?}");
}

#[test]
fn t7_an_incoming_asset_is_promoted_to_its_final_key_by_both_commands() {
    let incoming = "assets/incoming-0b1c2d3e-4f50-4162-8394-a5b6c7d8e9f0";
    let final_key = "assets/0123456789abcdef0123456789abcdef.png";
    let first = b"png-first-".to_vec();
    let second = b"png-second".to_vec();
    let whole: Vec<u8> = first.iter().chain(second.iter()).copied().collect();
    let mut failures: Vec<String> = Vec::new();
    for raw in [false, true] {
        for split in [false, true] {
            let root = TempRoot::new();
            let base = root.base();
            let result = if split {
                apply_chunk(raw, &base, incoming, 0, false, None, &first)
                    .and_then(|_| apply_chunk(raw, &base, incoming, first.len() as u64, true, Some(final_key), &second))
            } else {
                apply_chunk(raw, &base, incoming, 0, true, Some(final_key), &whole)
            };
            let promoted = fs::read(base.join(final_key)).map(|bytes| bytes == whole).unwrap_or(false);
            let incoming_left = base.join(incoming).exists();
            let temp_left = base.join("assets").join(TEMP).exists();
            if result.is_err() || !promoted || incoming_left || temp_left {
                failures.push(format!(
                    "raw {raw}, split {split}: {result:?}, promoted {promoted}, incoming left {incoming_left}, temp left {temp_left}"
                ));
            }
        }
    }
    assert!(failures.is_empty(), "promotion cells wrong: {failures:#?}");
}

#[test]
fn t7_a_gated_chunk_write_publishes_and_a_stale_generation_aborts_it() {
    for key in ["store2-commit", "store2-fence"] {
        let root = TempRoot::new();
        let base = root.base();
        let gate = Store2Gate::new();
        let gen = gate.register(Duration::from_secs(5)).expect("a generation");
        assert_eq!(crate::store2_gate::write_top_chunk_bytes(&gate, &base, gen, key, ID, 0, b"ab", false), Ok(true), "{key}");
        assert_eq!(crate::store2_gate::write_top_chunk_bytes(&gate, &base, gen, key, ID, 2, b"cd", true).is_ok(), true, "{key}");
        assert_eq!(fs::read(base.join(key)).unwrap(), b"abcd", "{key}");

        let stale_root = TempRoot::new();
        let stale_base = stale_root.base();
        let old = gate.register(Duration::from_secs(5)).expect("a generation");
        assert_eq!(crate::store2_gate::write_top_chunk_bytes(&gate, &stale_base, old, key, ID, 0, b"ab", false), Ok(true), "{key}");
        let _current = gate.register(Duration::from_secs(5)).expect("a newer generation");
        let refused = crate::store2_gate::write_top_chunk_bytes(&gate, &stale_base, old, key, ID, 2, b"cd", true);
        assert!(matches!(&refused, Err(message) if message.starts_with("stale-generation:")), "{key}: {refused:?}");
        assert!(!stale_base.join(key).exists(), "{key}: a stale write landed");
        assert!(!stale_base.join(TEMP).exists(), "{key}: the stale write left its temp");
    }
}

// ---------------------------------------------------------------------------
// T8, T9: the effective scopes
// ---------------------------------------------------------------------------

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn scope_strings(node: &Value) -> Vec<String> {
    node.as_array()
        .map(|list| {
            list.iter()
                .filter_map(|entry| match entry {
                    Value::String(text) => Some(text.clone()),
                    Value::Object(map) => map.get("path").and_then(Value::as_str).map(str::to_string),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The `fs:scope` entries of every capability file that applies on Android: one with no `platforms` list or
/// one whose list names android.
fn effective_android_fs_scope() -> (Vec<String>, Vec<String>) {
    let mut allow = Vec::new();
    let mut deny = Vec::new();
    let mut files: Vec<PathBuf> = fs::read_dir(manifest_dir().join("capabilities"))
        .expect("the capabilities directory")
        .map(|entry| entry.expect("a capability entry").path())
        .filter(|path| path.extension().map(|extension| extension == "json").unwrap_or(false))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no capability files found");
    for file in files {
        let text = fs::read_to_string(&file).expect("a capability file reads");
        let capability: Value = serde_json::from_str(&text).expect("a capability file is JSON");
        let applies = match capability.get("platforms") {
            None => true,
            Some(list) => list.as_array().map(|platforms| platforms.iter().any(|name| name == "android")).unwrap_or(false),
        };
        if !applies {
            continue;
        }
        for permission in capability["permissions"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
            if permission["identifier"] == "fs:scope" {
                allow.extend(scope_strings(&permission["allow"]));
                deny.extend(scope_strings(&permission["deny"]));
            }
        }
    }
    (allow, deny)
}

fn to_paths(list: Vec<String>) -> Vec<PathBuf> {
    list.into_iter().map(PathBuf::from).collect()
}

fn reachable(scope: &tauri::scope::fs::Scope, path: &Path) -> bool {
    scope.is_allowed(path) && !scope.is_forbidden(path)
}

#[test]
fn t8_the_android_fs_scope_reaches_only_the_store_directories() {
    let h = harness("android", &[]);
    let (allow, deny) = effective_android_fs_scope();
    let scope = tauri::scope::fs::Scope::new(
        &h.app,
        &FsScope::Scope { allow: to_paths(allow), deny: to_paths(deny), require_literal_leading_dot: None },
    )
    .expect("the effective scope resolves");
    let mut failures: Vec<String> = Vec::new();

    for outside in ["shared_prefs", "databases", "cache", "files", "app_webview"] {
        for path in [h.data.join(outside), h.data.join(outside).join("x")] {
            plant(&h.data.join(outside).join("x"), MARKER);
            if reachable(&scope, &path) {
                failures.push(format!("reachable but outside the store: {}", path.display()));
            }
        }
    }
    if reachable(&scope, &h.data) {
        failures.push("the data directory itself is reachable".to_string());
    }
    for relative in [".", "./shared_prefs", "./databases", "./cache"] {
        let joined = h.data.join(relative);
        for path in [joined.clone(), joined.join("x")] {
            if reachable(&scope, &path) {
                failures.push(format!("reachable through a relative form: {}", path.display()));
            }
        }
    }
    for directory in store_directories() {
        for path in [h.data.join(&directory), h.data.join(&directory).join("x"), h.data.join(&directory).join("deep").join("y")] {
            if !reachable(&scope, &path) {
                failures.push(format!("store path not reachable: {}", path.display()));
            }
        }
    }
    assert!(failures.is_empty(), "scope cells wrong: {failures:#?}");
}

#[cfg(unix)]
#[test]
fn t8_a_symlink_inside_a_store_directory_does_not_reach_an_outside_directory() {
    let h = harness("android", &[]);
    let (allow, deny) = effective_android_fs_scope();
    let scope = tauri::scope::fs::Scope::new(
        &h.app,
        &FsScope::Scope { allow: to_paths(allow), deny: to_paths(deny), require_literal_leading_dot: None },
    )
    .expect("the effective scope resolves");
    let outside = h.data.join("shared_prefs");
    plant(&outside.join("x"), MARKER);
    fs::create_dir_all(h.data.join("assets")).unwrap();
    let link = h.data.join("assets").join("link");
    h.root.assert_under(&link);
    std::os::unix::fs::symlink(&outside, &link).unwrap();
    assert!(!reachable(&scope, &link.join("x")), "a link inside assets reaches shared_prefs");
}

#[cfg(unix)]
#[test]
fn t8_the_data_directory_configured_as_a_symlink_keeps_the_same_cells_in_both_spellings() {
    // The configured directories root is a link to the real directory, as `/data/user/0/<id>` is on a device.
    let root = TempRoot::new();
    let real = root.path.join("real");
    fs::create_dir_all(&real).unwrap();
    let link = root.path.join("link");
    root.assert_under(&link);
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let h = harness_in("android", &[], root, link.clone());
    let (allow, deny) = effective_android_fs_scope();
    let scope = tauri::scope::fs::Scope::new(
        &h.app,
        &FsScope::Scope { allow: to_paths(allow), deny: to_paths(deny), require_literal_leading_dot: None },
    )
    .expect("the effective scope resolves");
    assert!(h.data.starts_with(&link), "the data directory is spelled through the link: {}", h.data.display());
    let canonical = real.join(h.data.strip_prefix(&link).expect("the data directory lies under the link"));
    for outside in ["shared_prefs", "databases", "cache"] {
        plant(&h.data.join(outside).join("x"), MARKER);
    }
    for directory in store_directories() {
        fs::create_dir_all(h.data.join(&directory)).unwrap();
    }
    let mut failures: Vec<String> = Vec::new();
    for data in [h.data.clone(), canonical] {
        for outside in ["shared_prefs", "databases", "cache"] {
            for path in [data.join(outside), data.join(outside).join("x")] {
                if reachable(&scope, &path) {
                    failures.push(format!("reachable but outside the store: {}", path.display()));
                }
            }
        }
        if reachable(&scope, &data) {
            failures.push(format!("the data directory itself is reachable: {}", data.display()));
        }
        for directory in store_directories() {
            for path in [data.join(&directory), data.join(&directory).join("x"), data.join(&directory).join("deep").join("y")] {
                if !reachable(&scope, &path) {
                    failures.push(format!("store path not reachable: {}", path.display()));
                }
            }
        }
    }
    assert!(failures.is_empty(), "scope cells wrong with the data directory configured as a symlink:{failures:#?}");
}

#[test]
fn t8_a_deny_beats_a_wide_allow() {
    let h = harness("android", &[]);
    let (_, deny) = effective_android_fs_scope();
    let scope = tauri::scope::fs::Scope::new(
        &h.app,
        &FsScope::Scope {
            allow: vec![PathBuf::from("/data/**/*")],
            deny: to_paths(deny),
            require_literal_leading_dot: None,
        },
    )
    .expect("the scope resolves");
    let mut failures: Vec<String> = Vec::new();
    for path in [
        format!("/data/user/0/{OWN}/cache/app-update/x"),
        format!("/data/data/{OWN}/cache/app-update/x"),
        format!("/data/user/0/{OWN}/cache"),
    ] {
        if reachable(&scope, Path::new(&path)) {
            failures.push(format!("reachable although denied: {path}"));
        }
    }
    assert!(failures.is_empty(), "denies lost to the allow: {failures:#?}");
}

fn merged_asset_scope(target: Target) -> (Vec<String>, Vec<String>) {
    let (config, _) = tauri::utils::config::parse::read_from(target, &manifest_dir()).expect("the merged config");
    let scope = &config["app"]["security"]["assetProtocol"]["scope"];
    match scope {
        Value::Array(_) => (scope_strings(scope), Vec::new()),
        _ => (scope_strings(&scope["allow"]), scope_strings(&scope["deny"])),
    }
}

#[test]
fn t9_the_android_asset_scope_serves_only_assets_and_blob_inlays() {
    let h = harness("android", &[]);
    let (allow, deny) = merged_asset_scope(Target::Android);
    let scope = tauri::scope::fs::Scope::new(
        &h.app,
        &FsScope::Scope { allow: to_paths(allow), deny: to_paths(deny), require_literal_leading_dot: None },
    )
    .expect("the asset scope resolves");
    let mut failures: Vec<String> = Vec::new();
    for outside in ["shared_prefs/x", "databases/x", "cache/x", "files/x", "store2/m-1", "consent/a.json", "inlays/m-1"] {
        let path = h.data.join(outside);
        plant(&path, MARKER);
        if reachable(&scope, &path) {
            failures.push(format!("served: {outside}"));
        }
    }
    for inside in ["assets/a.png", "assets/deep/b.png", "inlays/b-1.0123456789abcdef"] {
        let path = h.data.join(inside);
        plant(&path, MARKER);
        if !reachable(&scope, &path) {
            failures.push(format!("not served: {inside}"));
        }
    }
    let wide = format!("/data/user/0/{OWN}/shared_prefs/x");
    if reachable(&scope, Path::new(&wide)) {
        failures.push(format!("served: {wide}"));
    }
    assert!(failures.is_empty(), "asset scope cells wrong: {failures:#?}");
}

#[test]
fn t9_the_desktop_asset_scope_has_no_data_entry() {
    let mut failures: Vec<String> = Vec::new();
    for target in [Target::Windows, Target::Linux, Target::MacOS] {
        let (allow, deny) = merged_asset_scope(target);
        for entry in allow.iter().chain(deny.iter()) {
            if entry.starts_with("/data") {
                failures.push(format!("{target:?}: {entry}"));
            }
        }
    }
    assert!(failures.is_empty(), "desktop asset scope entries under /data: {failures:#?}");
}

// ---------------------------------------------------------------------------
// T4: the Android policy table, the rule and the request shape
// ---------------------------------------------------------------------------

fn verdict(command: &str, body: Value) -> Result<(), &'static str> {
    android_verdict(command, &InvokeBody::Json(body), OWN)
}

#[test]
fn t4_the_policy_commands_equal_the_fixture_table_and_nothing_else_is_named() {
    let table = fixture()["androidFsCommands"].as_object().expect("a command table").clone();
    for (name, kind) in &table {
        assert_eq!(android_command_kind(name), kind.as_str(), "{name}");
    }
    for name in [
        "write_file", "write_text_file", "read_file", "read_text_file", "remove", "rename", "mkdir", "copy_file",
        "create", "truncate", "stat", "lstat", "exists", "watch", "unwatch", "no_such_command", "", "READ_DIR",
        "read_dir ", "plugin:fs|open",
    ] {
        assert_eq!(android_command_kind(name), None, "{name:?}");
    }
}

#[test]
fn t4_a_handle_command_passes_with_any_body_and_an_unknown_command_never_does() {
    for command in ["read", "seek", "fstat"] {
        assert_eq!(android_verdict(command, &InvokeBody::Json(json!({})), OWN), Ok(()), "{command}");
        assert_eq!(android_verdict(command, &InvokeBody::Raw(vec![1, 2]), OWN), Ok(()), "{command}");
    }
    for command in ["write_file", "remove", "", "nope"] {
        assert!(android_verdict(command, &InvokeBody::Json(json!({ "path": "/x" })), OWN).is_err(), "{command:?}");
    }
}

#[test]
fn t4_read_dir_takes_a_path_and_refuses_a_url_a_missing_path_and_a_foreign_body() {
    assert_eq!(verdict("read_dir", json!({ "path": "/data/user/0/x/assets" })), Ok(()));
    assert_eq!(verdict("read_dir", json!({ "path": "assets", "options": { "baseDir": 14 } })), Ok(()));
    for path in ["file:///x", "content://com.example.provider/x", "http://a/b"] {
        assert!(verdict("read_dir", json!({ "path": path })).is_err(), "{path}");
    }
    for body in [json!({}), json!({ "path": 5 }), json!({ "path": null }), json!([]), json!("a"), json!(null)] {
        assert!(verdict("read_dir", body.clone()).is_err(), "{body}");
    }
    assert!(android_verdict("read_dir", &InvokeBody::Raw(b"/x".to_vec()), OWN).is_err());
}

#[test]
fn t4_the_rule_over_every_uris_row_and_the_open_verdict_agree_with_the_fixture() {
    let mut failures: Vec<String> = Vec::new();
    for row in uri_rows() {
        if foreign_content_uri(&row.text, OWN) != row.accept {
            failures.push(format!("rule: {}", row.text));
        }
        for options in [None, Some(json!({ "read": true })), Some(json!({})), Some(Value::Null)] {
            let mut body = json!({ "path": row.text });
            if let Some(options) = options {
                body["options"] = options;
            }
            if verdict("open", body.clone()).is_ok() != row.accept {
                failures.push(format!("open: {body}"));
            }
        }
    }
    assert!(failures.is_empty(), "rows the policy judged differently from the fixture: {failures:#?}");
    assert!(!foreign_content_uri("content://com.example.provider/x", ""), "an empty own id refuses");
}

/// One string per ASCII code point c, with c inside the authority: `content://com.ex<c>ample/x`.
fn authority_sweep() -> Vec<(char, String)> {
    (0u8..=127).map(|code| (char::from(code), format!("content://com.ex{}ample/x", char::from(code)))).collect()
}

/// The code points whose sweep string the given rule accepts.
fn accepted_by(rule: impl Fn(&str) -> bool) -> String {
    authority_sweep().into_iter().filter(|(_, text)| rule(text)).map(|(c, _)| c).collect()
}

fn expected_authority_set() -> String {
    (0u8..=127).map(char::from).filter(|c| c.is_ascii_alphanumeric() || "._-/?#".contains(*c)).collect()
}

#[test]
fn t4_the_rule_accepts_exactly_the_authority_characters_and_the_three_delimiters() {
    assert_eq!(accepted_by(|text| foreign_content_uri(text, OWN)), expected_authority_set());
}

#[test]
fn t4_the_open_verdict_never_accepts_a_character_outside_the_authority_set() {
    let expected = expected_authority_set();
    for (c, text) in authority_sweep() {
        let ok = verdict("open", json!({ "path": text, "options": { "read": true } })).is_ok();
        assert_eq!(ok, expected.contains(c), "{:?}", c);
    }
}

#[test]
fn t4_the_sweep_helper_reports_a_wider_accepted_set() {
    // This checks the sweep helper, not the rule: also accepting each row that holds one of these characters must
    // change the set it reports. Every row holds ':', so that case accepts every row.
    for extra in [':', '@', '%', '\\'] {
        let widened = accepted_by(|text| foreign_content_uri(text, OWN) || text.contains(extra) && text.starts_with("content://"));
        assert_ne!(widened, expected_authority_set(), "{extra:?}");
    }
}

#[test]
fn t4_an_open_is_read_only_and_nothing_else() {
    let path = "content://com.android.externalstorage.documents/document/primary%3Ax";
    for options in [
        json!({ "write": true }),
        json!({ "read": false }),
        json!({ "read": true, "write": true }),
        json!({ "read": true, "create": true }),
        json!({ "read": true, "baseDir": 14 }),
        json!({ "truncate": true }),
        json!({ "append": true }),
        json!("read"),
        json!([]),
        json!(true),
    ] {
        assert!(verdict("open", json!({ "path": path, "options": options.clone() })).is_err(), "{options}");
    }
}

#[test]
fn t4_an_open_of_a_path_a_file_url_a_parse_error_and_a_foreign_body_is_refused() {
    for path in [
        "/data/user/0/x/assets/a",
        "assets/a",
        "file:///data/x",
        "content://[",
        "content://",
        "content:///x",
        "http://a/b",
        "",
    ] {
        assert!(verdict("open", json!({ "path": path, "options": { "read": true } })).is_err(), "{path:?}");
    }
    for body in [json!({}), json!({ "path": 1 }), json!(null), json!([]), json!("content://a.b/x")] {
        assert!(verdict("open", body.clone()).is_err(), "{body}");
    }
    assert!(android_verdict("open", &InvokeBody::Raw(b"content://a.b/x".to_vec()), OWN).is_err());
}

#[test]
fn t4_a_refused_command_answers_with_a_fixed_reason_that_never_echoes_the_path() {
    let h = harness("android", &["open", "write_file"]);
    let secret = "content://localhost/C:/very-secret-marker/x";
    let answer = invoke_json(&h, "plugin:fs|open", json!({ "path": secret, "options": { "read": true } }));
    assert!(refused_fs(&answer), "{answer:?}");
    if let Err(value) = &answer {
        assert!(!value.as_str().unwrap_or_default().contains("secret"), "the refusal echoes the path: {value}");
    }
}

// ---------------------------------------------------------------------------
// T4e: a guarded plugin is the bare plugin to the app
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct Recorder {
    log: Arc<Mutex<Vec<String>>>,
}

impl Recorder {
    fn note(&self, line: String) {
        self.log.lock().unwrap().push(line);
    }
}

impl<R: Runtime> Plugin<R> for Recorder {
    fn name(&self) -> &'static str {
        "recorder"
    }

    fn initialize(&mut self, _app: &AppHandle<R>, _config: Value) -> Result<(), Box<dyn std::error::Error>> {
        self.note("initialize".into());
        Ok(())
    }

    fn initialization_script(&self) -> Option<String> {
        Some("/* recorder script */".into())
    }

    fn window_created(&mut self, window: Window<R>) {
        self.note(format!("window:{}", window.label()));
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.note(format!("webview:{}", webview.label()));
    }

    fn on_navigation(&mut self, _webview: &Webview<R>, url: &Url) -> bool {
        self.note(format!("navigation:{url}"));
        false
    }

    fn on_event(&mut self, _app: &AppHandle<R>, event: &RunEvent) {
        self.note(format!("event:{}", matches!(event, RunEvent::Ready)));
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        self.note(format!("api:{}", invoke.message.command()));
        invoke.resolver.resolve(());
        true
    }
}

fn script_text<P: Plugin<MockRuntime>>(plugin: &P) -> (String, String, String) {
    (
        plugin.name().to_string(),
        format!("{:?}", plugin.initialization_script()),
        format!("{:?}", plugin.initialization_script_2()),
    )
}

#[test]
fn t4e_a_guarded_fs_and_a_guarded_dialog_report_what_the_bare_plugins_report() {
    for os in ["android", "windows"] {
        let bare_fs = tauri_plugin_fs::init::<MockRuntime>();
        let guarded_fs = Guarded::new(tauri_plugin_fs::init::<MockRuntime>(), for_os(os));
        assert_eq!(script_text(&guarded_fs), script_text(&bare_fs), "fs on {os}");

        let bare_dialog = tauri_plugin_dialog::init::<MockRuntime>();
        let guarded_dialog = Guarded::new(tauri_plugin_dialog::init::<MockRuntime>(), for_os(os));
        let (name, script, script_2) = script_text(&guarded_dialog);
        assert_eq!((name.clone(), script.clone(), script_2.clone()), script_text(&bare_dialog), "dialog on {os}");
        assert!(script.contains("Some("), "the dialog plugin has an init script to compare: {script}");
        assert!(script_2.contains("for_main_frame_only: true"), "{script_2}");
    }
}

#[test]
fn t4e_every_forwarded_hook_reaches_the_inner_plugin() {
    for os in ["android", "windows"] {
        let recorder = Recorder::default();
        let log = recorder.log.clone();
        let mut context = mock_context(noop_assets());
        context.config_mut().identifier = OWN.into();
        context.runtime_authority_mut().__allow_command("plugin:recorder|ping".to_string(), ExecutionContext::Local);
        let app = mock_builder().plugin(Guarded::new(recorder, for_os(os))).build(context).expect("the mock app builds");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .build()
            .expect("a mock webview");

        let direct_recorder = Recorder::default();
        let direct_log = direct_recorder.log.clone();
        let mut direct = Guarded::new(direct_recorder, for_os(os));
        assert_eq!(Plugin::<MockRuntime>::name(&direct), "recorder");
        assert_eq!(Plugin::<MockRuntime>::initialization_script(&direct), Some("/* recorder script */".to_string()));
        let main: &Webview<MockRuntime> = webview.as_ref();
        let url: Url = "http://tauri.localhost/".parse().unwrap();
        assert!(!Plugin::<MockRuntime>::on_navigation(&mut direct, main, &url), "on_navigation is forwarded, including its answer");
        Plugin::<MockRuntime>::on_event(&mut direct, app.handle(), &RunEvent::Ready);
        let direct_seen = direct_log.lock().unwrap().clone();
        assert_eq!(direct_seen, vec!["navigation:http://tauri.localhost/".to_string(), "event:true".to_string()], "{os}");

        let answer = invoke_in(&webview, "plugin:recorder|ping", json!({}));
        let seen = log.lock().unwrap().clone();
        let reached = seen.iter().any(|line| line == "api:ping");
        if os == "android" {
            assert!(refused_fs(&answer) && !reached, "{os}: {answer:?} {seen:?}");
        } else {
            assert!(answer.is_ok() && reached, "{os}: {answer:?} {seen:?}");
        }
        for expected in ["initialize", "window:main", "webview:main"] {
            assert!(seen.iter().any(|line| line == expected), "{os}: {expected} missing from {seen:?}");
        }
    }
}

fn invoke_in(webview: &tauri::WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Answer {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: tauri::http::HeaderMap::new(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
}

// ---------------------------------------------------------------------------
// T12 (Rust half): the predicate and the policy equal the shared fixture
// ---------------------------------------------------------------------------

#[test]
fn t12_the_store_set_equals_the_fixture() {
    assert_eq!(STORE_DIRECTORIES.to_vec(), store_directories());
    assert_eq!(ROOT_FILES.to_vec(), root_files());
    for key in every_fixture_key().into_iter().chain(fixture_strings(&["keys", "temps"])) {
        assert!(inside_store_set(&key), "{key}");
    }
    for directory in store_directories() {
        assert!(inside_store_set(&directory), "{directory}");
        assert!(inside_store_set(&format!("{directory}/x/y")), "{directory}/x/y");
    }
    for segment in fixture_strings(&["outsideStoreFirstSegments"]) {
        assert!(!inside_store_set(&segment), "{segment}");
        assert!(!inside_store_set(&format!("{segment}/x")), "{segment}/x");
        assert!(!inside_store_set(&format!("{segment}/{TEMP}")), "{segment}/{TEMP}");
    }
    for key in ["", "store2-owner/x", "assets\\x", "Assets", "assets ", "STORE2/x"] {
        assert!(!inside_store_set(key), "{key:?}");
    }
}

// ---------------------------------------------------------------------------
// T17: no accepted string converts to a path
// ---------------------------------------------------------------------------

fn generated_uris() -> Vec<String> {
    let authorities = [
        "com.android.externalstorage.documents",
        "com.android.providers.media.documents",
        "0@media",
        "10@a-b_c.d",
        "Com.Example.Provider",
        "localhost",
        "LocalHost",
        "0@localhost",
        "",
        "0@",
        OWN,
        "io.github.yor42.risutanium.files",
    ];
    let suffixes = ["", "/", "/x", "/C:/x", "/a%2Fb", "/document/primary%3AD%2Fx.bin", "?q=1", "#f", "/../x"];
    let mut out = Vec::new();
    for authority in authorities {
        for suffix in suffixes {
            out.push(format!("content://{authority}{suffix}"));
        }
    }
    out.extend(authority_sweep().into_iter().map(|(_, text)| text));
    out
}

#[test]
fn t17_an_accepted_string_is_a_url_that_does_not_convert_and_a_local_seed_does() {
    let mut failures: Vec<String> = Vec::new();
    let mut accepted = 0;
    let strings: Vec<String> = uri_rows().into_iter().map(|row| row.text).chain(generated_uris()).collect();
    for text in &strings {
        if foreign_content_uri(text, OWN) {
            accepted += 1;
            match SafeFilePath::from_str(text) {
                Ok(SafeFilePath::Url(url)) => {
                    if url.as_str() != text.as_str() && !text.is_empty() {
                        // The rule is applied to the exact string handed on, so a rewrite would be a gap.
                        if !foreign_content_uri(url.as_str(), OWN) {
                            failures.push(format!("rewritten into a refused form: {text}"));
                        }
                    }
                    if SafeFilePath::Url(url).into_path().is_ok() {
                        failures.push(format!("converts to a path: {text}"));
                    }
                }
                other => failures.push(format!("not a Url: {text}: {other:?}")),
            }
        }
    }
    assert!(accepted >= 12, "too few accepted strings to mean anything: {accepted}");
    assert!(failures.is_empty(), "accepted strings that reach a path: {failures:#?}");

    for seed in ["content://localhost/C:/dv603/x", "content:///C:/dv603/x"] {
        let parsed = SafeFilePath::from_str(seed).expect("a seed parses");
        assert!(matches!(&parsed, SafeFilePath::Url(_)), "{seed}");
        assert!(parsed.into_path().is_ok(), "the seed must convert, which is why the rule refuses it: {seed}");
        assert!(!foreign_content_uri(seed, OWN), "{seed}");
    }
}
