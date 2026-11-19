use serde_json::json;
use serde_json::Value;
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use tauri_plugin_fs::FsExt;

mod app_fs;
mod asset_batch;
pub mod avatar_preview;
mod chunked_io;
mod durable_write;
mod env_secret;
mod export_append;
mod free_space;
mod launch_inputs;
mod net_policy;
mod reply_store;
mod store2_batch;
mod store2_gate;
mod streamed_fetch;
use launch_inputs::LaunchInputs;
use std::sync::Mutex;

/// Files and deep links handed in by the operating system that the page has not
/// taken yet.
struct PendingLaunch(Mutex<LaunchInputs>);

fn lock_pending(state: &PendingLaunch) -> std::sync::MutexGuard<'_, LaunchInputs> {
    state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The fs scope grows only by files the operating system handed in as launch inputs.
fn allow_launch_files(app: &AppHandle, files: &[std::path::PathBuf]) {
    if let Some(scope) = app.try_fs_scope() {
        for file in files {
            if let Err(e) = scope.allow_file(file) {
                println!("Failed to allow launch file {}: {}", file.display(), e);
            }
        }
    }
}

/// Queues inputs that arrive while the app runs and tells the page to take them.
#[allow(dead_code)]
fn queue_launch_inputs(app: &AppHandle, inputs: LaunchInputs) {
    if inputs.is_empty() {
        return;
    }
    allow_launch_files(app, &inputs.files);
    if let Some(state) = app.try_state::<PendingLaunch>() {
        lock_pending(&state).extend(inputs);
    }
    let _ = app.emit("risu-launch-inputs", ());
}

/// Reads one process environment variable for a secret reference. Registered on
/// every target; on mobile it reads that process's own environment.
#[tauri::command]
fn read_env_secret(name: String) -> Result<String, String> {
    env_secret::resolve_env_secret(&name, |key| std::env::var_os(key))
}

/// Writes one file under the app data directory durably: the key travels in the
/// `x-risu-key` header (percent-encoded). The bytes are the raw request body on
/// the custom-protocol IPC; a JSON array of byte values is also accepted, which is
/// what the postMessage fallback sends. Any other body is rejected before
/// the disk is touched. The file work runs on a blocking worker thread. The
/// result is `{ "flushed": bool }`: `false` when a directory flush after the
/// rename failed (the write still succeeded).
#[tauri::command]
async fn write_durable(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let raw_key = request
        .headers()
        .get(durable_write::KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "missing key header".to_string())?;
    let key = durable_write::decode_key_header(raw_key)?;
    let bytes = durable_write::decode_body(request.body())?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let flushed = tauri::async_runtime::spawn_blocking(move || durable_write::write_key_durable(&base, &key, &bytes))
        .await
        .map_err(|e| format!("the write task failed: {}", e))??;
    Ok(json!({ "flushed": flushed }))
}

/// One chunk of a file written under the app data directory: the page sends the
/// chunks of one write in order under one write id (see `chunked_io`). `data` is
/// the chunk's bytes as base64 text. The last chunk may carry `final_key`, the key
/// the finished file takes instead of `key` (see `chunked_io::write_chunk_final_with`).
/// The file work runs on a blocking worker thread. The result is
/// `{ "flushed": bool }`: `false` when a directory flush of this chunk failed or,
/// on a last chunk with `final_key`, the file already existed and was kept.
/// A caller combines the answers of all chunks of a durable write with AND.
#[tauri::command]
async fn write_chunk(
    app: AppHandle,
    key: String,
    id: String,
    offset: u64,
    data: String,
    last: bool,
    durable: bool,
    final_key: Option<String>,
) -> Result<Value, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let flushed = tauri::async_runtime::spawn_blocking(move || {
        chunked_io::write_chunk_key(&base, &key, &id, offset, &data, last, durable, final_key.as_deref())
    })
        .await
        .map_err(|e| format!("the write task failed: {}", e))??;
    Ok(json!({ "flushed": flushed }))
}

/// Removes the temp file of a chunked write that did not finish.
#[tauri::command]
async fn abort_chunked(app: AppHandle, key: String, id: String) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || chunked_io::abort_chunk_key(&base, &key, &id))
        .await
        .map_err(|e| format!("the abort task failed: {}", e))?
}

/// One piece of a file under the app data directory, followed by the file's
/// total size and identity (see `chunked_io::TRAILER_BYTES`). The response is a
/// raw `Response`; the bridge delivers it as bytes, except that it serialises it
/// as a JSON number array when the custom-protocol IPC is blocked.
#[tauri::command]
async fn read_range(app: AppHandle, key: String, offset: u64, len: u64) -> Result<tauri::ipc::Response, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || chunked_io::read_key_range(&base, &key, offset, len))
        .await
        .map_err(|e| format!("the read task failed: {}", e))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A thumbnail-sized RGBA preview of an over-limit avatar, decoded natively by key. The page
/// never passes a path: the key must be under `assets/` and resolves under the app data
/// directory. The reply is `status u8 | w u32 LE | h u32 LE | rgba` (see
/// `avatar_preview::encode_outcome`); a transient failure is an `Err` with a stable prefix
/// (`cancelled`, `busy`, `io:`, `refused key:`). `ticket` names the call for
/// `avatar_preview_cancel`. The decode cannot be aborted from outside, so cancel and the
/// deadline are checked inside the reader stack.
#[tauri::command]
async fn avatar_preview(app: AppHandle, key: String, short_side: u32, ticket: u64) -> Result<tauri::ipc::Response, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || avatar_preview::preview_key(&base, &key, short_side, ticket))
        .await
        .map_err(|e| format!("the preview task failed: {}", e))??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Asks the native preview of `ticket` to stop; a cancel that arrives first is remembered.
#[tauri::command]
fn avatar_preview_cancel(ticket: u64) {
    avatar_preview::slot::global_tickets().cancel(ticket);
}

/// `read_range` with the response as one base64 string of at most `chunked_io::TEXT_RANGE_MAX_BYTES` of
/// piece. Fork-local: the page uses it only while it is hidden on Android, because a frozen page receives
/// a string reply (delivered by script evaluation) but not a raw reply of 1 KiB or more. That depends on
/// Tauri's reply path (`ipc/protocol.rs`, `ipc/channel.rs`) as of Tauri 2.12.1; re-check it whenever Tauri is updated.
#[tauri::command]
async fn read_range_text(app: AppHandle, key: String, offset: u64, len: u64) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || chunked_io::read_key_range_text(&base, &key, offset, len))
        .await
        .map_err(|e| format!("the read task failed: {}", e))?
}

/// Writes many asset files in one call. The body is raw frames
/// `[u32 LE keyLen][key][u32 LE dataLen][bytes]`; the result is one outcome per
/// frame in input order, each `ok` with `flushed` (`false` when a directory
/// flush it depends on failed). A body that is not raw or is malformed is refused
/// before any write. The base directory is the app data directory; the page
/// supplies no path.
#[tauri::command]
async fn put_assets_batch(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let body = asset_batch::raw_body(request.body())?.to_vec();
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || asset_batch::put_assets_batch(&base, &body))
        .await
        .map_err(|e| format!("the write task failed: {}", e))?
}

/// `put_assets_batch` for the Android app, whose bridge sends a byte array as
/// JSON and so cannot deliver a raw body: `body` is the standard base64 of the
/// same frames. Invalid base64, a body above the batch cap and a malformed body
/// are refused before any write; the outcomes, key rules and flushes are those of
/// `put_assets_batch`. The base directory is the app data directory; the page
/// supplies no path.
#[tauri::command]
async fn put_assets_batch_b64(app: AppHandle, body: String) -> Result<Value, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || asset_batch::put_assets_batch_b64(&base, &body))
        .await
        .map_err(|e| format!("the write task failed: {}", e))?
}

/// One chunk of a file written under the app data directory, as a raw body: the
/// chunk bytes are the body, and `x-risu-key` (percent-encoded), `x-risu-id`,
/// `x-risu-offset`, `x-risu-last` and `x-risu-durable` carry the rest, and the
/// last chunk may add `x-risu-final-key` (percent-encoded) (see
/// `asset_batch::write_chunk_raw`). The result is an outcome object, with
/// `flushed` on a durable write (see `asset_batch::Outcome`); a refused
/// key is `invalid`. A body that is not raw is refused with `not-raw:` and a bad
/// header with `malformed:`, both before the disk is touched.
#[tauri::command]
async fn write_chunk_raw(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let (headers, bytes) = asset_batch::parse_raw_chunk(request.headers(), request.body())?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || asset_batch::write_chunk_raw(&base, &headers, &bytes))
        .await
        .map_err(|e| format!("the write task failed: {}", e))
}

/// Issues the page's store2 generation (see `store2_gate`). The wait for a write in
/// flight is bounded; a timeout is the typed `registration-timeout:` error and
/// issues nothing.
#[tauri::command]
async fn store2_register_page(app: AppHandle) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<store2_gate::Store2Gate>()
            .register(store2_gate::REGISTRATION_DEADLINE)
    })
    .await
    .map_err(|e| format!("the registration task failed: {}", e))?
}

/// A whole `store2-commit` or `store2-fence` write as one raw call: the bytes are
/// the body, `x-risu-key` (percent-encoded) and `x-risu-gen` carry the rest. A body
/// that is not raw is refused with `not-raw:`. See `store2_gate` for the refusals.
#[tauri::command]
async fn store2_write_top_raw(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let bytes = asset_batch::raw_body(request.body())?.to_vec();
    let (gen, key) = store2_gate::top_write_headers(request.headers())?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let flushed = tauri::async_runtime::spawn_blocking(move || {
        store2_gate::write_top(&app.state::<store2_gate::Store2Gate>(), &base, gen, &key, &bytes)
    })
    .await
    .map_err(|e| format!("the write task failed: {}", e))??;
    Ok(json!({ "flushed": flushed }))
}

/// One chunk of a gated `store2-commit` or `store2-fence` write, as `write_chunk`
/// sends it (base64) plus the generation and without a final key. Only the last
/// chunk decides; see `store2_gate::write_top_chunk_with`.
#[tauri::command]
async fn store2_write_top_chunk(
    app: AppHandle,
    gen: u64,
    key: String,
    id: String,
    offset: u64,
    data: String,
    last: bool,
) -> Result<Value, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let flushed = tauri::async_runtime::spawn_blocking(move || {
        store2_gate::write_top_chunk(&app.state::<store2_gate::Store2Gate>(), &base, gen, &key, &id, offset, &data, last)
    })
    .await
    .map_err(|e| format!("the write task failed: {}", e))??;
    Ok(json!({ "flushed": flushed }))
}

/// `store2_write_top_chunk` with a raw body, as `write_chunk_raw` sends a chunk
/// plus `x-risu-gen`. `x-risu-durable` is required by the shared header parser
/// and ignored (a gated write is always durable); a final key is refused.
#[tauri::command]
async fn store2_write_top_chunk_raw(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let (headers, bytes) = asset_batch::parse_raw_chunk(request.headers(), request.body())?;
    if headers.final_key.is_some() {
        return Err("malformed: a gated chunk takes no final key".to_string());
    }
    let gen = store2_gate::generation_from_headers(request.headers())?;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let flushed = tauri::async_runtime::spawn_blocking(move || {
        store2_gate::write_top_chunk_bytes(
            &app.state::<store2_gate::Store2Gate>(),
            &base,
            gen,
            &headers.key,
            &headers.id,
            headers.offset,
            &bytes,
            headers.last,
        )
    })
    .await
    .map_err(|e| format!("the write task failed: {}", e))??;
    Ok(json!({ "flushed": flushed }))
}

/// Removes `store2/` keys and `store2-fence` under one hold of the gate; the
/// result is one `{ key, outcome, error? }` entry per key. `store2-commit` is
/// refused.
#[tauri::command]
async fn store2_remove(app: AppHandle, gen: u64, keys: Vec<String>) -> Result<Value, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        store2_gate::remove_with(&app.state::<store2_gate::Store2Gate>(), &base, gen, &keys)
    })
    .await
    .map_err(|e| format!("the remove task failed: {}", e))?
}

/// Reads many asset files; the response is one frame per key in key order
/// (`[u8 status][u32 LE len][bytes]`).
#[tauri::command]
async fn get_assets_batch(app: AppHandle, keys: Vec<String>) -> Result<tauri::ipc::Response, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let out = tauri::async_runtime::spawn_blocking(move || asset_batch::get_assets_batch(&base, &keys))
        .await
        .map_err(|e| format!("the read task failed: {}", e))?;
    Ok(tauri::ipc::Response::new(out))
}

/// Reads the store2 unit files of one `readUnits` call; the response is one frame per key in key order,
/// in the frame format and budgets of `get_assets_batch`. Fork-local. The page takes bytes only from
/// `ok` frames and reads every other key through `read_range`.
#[tauri::command]
async fn read_store2_units(app: AppHandle, keys: Vec<String>) -> Result<tauri::ipc::Response, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let out = tauri::async_runtime::spawn_blocking(move || store2_batch::get_store2_units(&base, &keys))
        .await
        .map_err(|e| format!("the read task failed: {}", e))??;
    Ok(tauri::ipc::Response::new(out))
}

/// Lists `assets/` as `[key, size in bytes]` pairs with the keys and order the
/// per-directory listing of the file store gives.
#[tauri::command]
async fn list_assets_sized(app: AppHandle) -> Result<Vec<(String, u64)>, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || asset_batch::list_assets_sized(&base))
        .await
        .map_err(|e| format!("the list task failed: {}", e))?
}

/// Whether `key` (empty: the app data directory) exists; see `app_fs::exists_key`.
/// Async so that no plugin lock is held while the app data directory is
/// resolved, which waits for the UI thread on Android. The file work runs on a
/// blocking worker thread.
#[tauri::command]
async fn app_fs_exists(app: AppHandle, key: String) -> Result<bool, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || app_fs::exists_key(&base, &key))
        .await
        .map_err(|e| format!("the exists task failed: {}", e))?
}

/// Creates the directory `key` and its missing ancestors; see `app_fs::mkdir_all_key`.
#[tauri::command]
async fn app_fs_mkdir_all(app: AppHandle, key: String) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || app_fs::mkdir_all_key(&base, &key))
        .await
        .map_err(|e| format!("the mkdir task failed: {}", e))?
}

/// Removes the file, link or empty directory at `key`; see `app_fs::remove_key_guarded`,
/// which refuses the keys that only the store2 gate removes.
#[tauri::command]
async fn app_fs_remove(app: AppHandle, key: String) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || app_fs::remove_key_guarded(&base, &key))
        .await
        .map_err(|e| format!("the remove task failed: {}", e))?
}

/// The boot sweep of leftover write temps in the app data directory and in the
/// listed directories; see `app_fs::StartupSweep::take_or_walk`. The walk and the
/// removals run natively on a blocking worker thread, so only the small report
/// crosses to the page. Every walk keeps the temps newer than its trigger minus a
/// margin: the walk that setup starts at process start, and a fresh walk for the
/// moment this call arrived. A call waits while the startup walk runs; that
/// walk's report goes to the boot that waited for it, or else to the first call
/// after it finished.
#[tauri::command]
async fn app_fs_sweep_write_temps(app: AppHandle, directories: Vec<String>) -> Result<app_fs::SweepReport, String> {
    // Taken before anything else: an earlier arrival only keeps more temps.
    let arrival = std::time::SystemTime::now();
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // A `tauri::State` cannot move into the blocking closure, so the closure takes the state from the handle.
    tauri::async_runtime::spawn_blocking(move || app.state::<app_fs::StartupSweep>().take_or_walk(&base, &directories, arrival))
        .await
        .map_err(|e| format!("the sweep task failed: {}", e))
}

/// The absolute app data directory, for building asset URLs. The page supplies no path.
#[tauri::command]
async fn app_data_dir_path(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn take_launch_inputs(state: tauri::State<'_, PendingLaunch>) -> Value {
    let taken = lock_pending(&state).drain();
    let files: Vec<String> = taken
        .files
        .iter()
        .map(|file| file.to_string_lossy().into_owned())
        .collect();
    json!({ "files": files, "urls": taken.urls })
}

#[tauri::command]
async fn streamed_fetch(
    id: String,
    url: String,
    headers: String,
    body: String,
    app: AppHandle,
    method: String,
    timeout_secs: Option<u64>,
    policy: Option<net_policy::NetPolicy>,
    chat_stop: Option<bool>,
    chat_target: Option<streamed_fetch::ChatTarget>,
    reply_owner: Option<reply_store::ReplyOwnerArg>,
) -> String {
    let registry = app
        .state::<streamed_fetch::FetchRegistry>()
        .inner()
        .clone();
    // Without `reply_owner` the store is not touched and the data directory is not resolved.
    let owner = reply_store::owned_reply_for(
        app.state::<reply_store::ReplyStore>().inner(),
        reply_owner,
        || app.path().app_data_dir().map_err(|e| e.to_string()),
    );
    let request = streamed_fetch::FetchRequest {
        id,
        url,
        headers,
        body,
        method,
        timeout_secs,
        policy,
        tags: streamed_fetch::stream_tags(chat_stop, chat_target),
        owner,
    };
    streamed_fetch::run_registered(&registry, request, |payload| {
        app.emit("streamed_fetch", &payload)
            .map_err(|e| e.to_string())
    })
    .await
}

// The native reply commands. By convention the page reads replies only through these: the
// record files are Rust's (`reply_store`) and the `native-reply` prefix is
// refused to the page's generic file commands. The list is an array that can
// carry blobs of up to 1 MiB, so it is a visible-page call. The body read
// answers one base64 string like `read_range_text`, so a frozen page receives it.
#[tauri::command]
async fn native_reply_list(app: AppHandle) -> Result<Vec<reply_store::ReplyListing>, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = app.state::<reply_store::ReplyStore>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.list(&base))
        .await
        .map_err(|e| format!("the reply task failed: {}", e))?
}

#[tauri::command]
async fn native_reply_read_body(app: AppHandle, key: String, offset: u64, len: u64) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = app.state::<reply_store::ReplyStore>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.read_body(&base, &key, offset, len))
        .await
        .map_err(|e| format!("the reply task failed: {}", e))?
}

#[tauri::command]
async fn native_reply_consume(app: AppHandle, key: String) -> Result<reply_store::RemoveOutcome, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = app.state::<reply_store::ReplyStore>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.consume(&base, &key))
        .await
        .map_err(|e| format!("the reply task failed: {}", e))?
}

#[tauri::command]
async fn native_reply_discard(app: AppHandle, key: String) -> Result<reply_store::RemoveOutcome, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = app.state::<reply_store::ReplyStore>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.discard(&base, &key))
        .await
        .map_err(|e| format!("the reply task failed: {}", e))?
}

#[tauri::command]
async fn native_reply_park(app: AppHandle, key: String) -> Result<(), String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let store = app.state::<reply_store::ReplyStore>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.park(&base, &key))
        .await
        .map_err(|e| format!("the reply task failed: {}", e))?
}

#[tauri::command]
fn cancel_streamed_fetch(id: String, registry: tauri::State<'_, streamed_fetch::FetchRegistry>) {
    registry.cancel(&id);
}

// This app has one window; another webview's load would cancel its live streams.
#[tauri::command]
fn cancel_all_streamed_fetch(registry: tauri::State<'_, streamed_fetch::FetchRegistry>) {
    registry.cancel_all();
}

// Called on the Android main thread by the keep-alive Stop (MC-1435): it aborts
// only the requests the page marked as the chat's, takes one mutex and does no
// I/O. It does not touch the JNI environment. A panic gives -1.
#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_io_github_yor42_risutanium_NativeStreams_cancelChatStreams(
    _env: *mut std::ffi::c_void,
    _class: *mut std::ffi::c_void,
) -> i32 {
    match std::panic::catch_unwind(streamed_fetch::cancel_process_chat_streams) {
        Ok(count) => i32::try_from(count).unwrap_or(i32::MAX),
        Err(_) => -1,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The command line is consumed once per process chain: a relaunch finds the
    // marker and starts with an empty queue. This runs before any thread starts.
    #[cfg(desktop)]
    let cold_launch = {
        let relaunched = launch_inputs::argv_gate(|name| std::env::var_os(name));
        // Only a process started by this app's own restart sees the marker;
        // nothing else this process spawns carries it.
        std::env::remove_var(launch_inputs::LAUNCH_CONSUMED_ENV);
        if relaunched {
            LaunchInputs::default()
        } else {
            let cwd = std::env::current_dir().ok();
            launch_inputs::classify(std::env::args_os(), cwd.as_deref())
        }
    };
    #[cfg(not(desktop))]
    let cold_launch = LaunchInputs::default();

    let mut builder = tauri::Builder::default()
        .manage(PendingLaunch(Mutex::new(cold_launch)))
        .manage(store2_gate::Store2Gate::new())
        .manage(streamed_fetch::process_registry())
        .manage(reply_store::ReplyStore::new())
        .manage(app_fs::StartupSweep::new());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_launch_inputs(
                app,
                launch_inputs::classify(args.into_iter().map(Into::into), Some(std::path::Path::new(&cwd))),
            );
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }));
        // tauri-plugin-deep-link and tauri-plugin-updater are excluded for Android/iOS
        // at the Cargo.toml dependency level (`cfg(not(any(target_os = "android", target_os = "ios")))`
        // / the macos/windows/linux-only cfg on deep-link) — registering them unconditionally
        // below would fail to compile on those targets, since the crates aren't even pulled in.
        builder = builder
            .plugin(tauri_plugin_deep_link::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // The write-temp walk starts with the process so that the boot does not wait on it.
            // The base is resolved on the worker: on Android that waits for the UI thread.
            #[cfg(any(desktop, target_os = "android"))]
            {
                let handle = app.handle().clone();
                let spawned = std::thread::Builder::new().name("risu-startup-sweep".into()).spawn(move || {
                    handle
                        .state::<app_fs::StartupSweep>()
                        .run(|| handle.path().app_data_dir().map_err(|e| e.to_string()));
                });
                if let Err(e) = spawned {
                    app.state::<app_fs::StartupSweep>().fail(format!("could not start the startup sweep thread: {}", e));
                }
            }
            // No startup walk runs on another target: end the wait so calls walk fresh.
            #[cfg(not(any(desktop, target_os = "android")))]
            app.state::<app_fs::StartupSweep>().fail("no startup sweep on this target".to_string());
            if let Some(state) = app.try_state::<PendingLaunch>() {
                let files = lock_pending(&state).files.clone();
                allow_launch_files(app.handle(), &files);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_launch_inputs,
            read_env_secret,
            write_durable,
            put_assets_batch,
            put_assets_batch_b64,
            write_chunk_raw,
            store2_register_page,
            store2_write_top_raw,
            store2_write_top_chunk,
            store2_write_top_chunk_raw,
            store2_remove,
            get_assets_batch,
            read_store2_units,
            list_assets_sized,
            app_fs_exists,
            app_fs_mkdir_all,
            app_fs_remove,
            app_fs_sweep_write_temps,
            app_data_dir_path,
            free_space::app_data_free_bytes,
            write_chunk,
            abort_chunked,
            read_range,
            read_range_text,
            avatar_preview,
            avatar_preview_cancel,
            export_append::export_append_b64,
            streamed_fetch,
            cancel_streamed_fetch,
            cancel_all_streamed_fetch,
            native_reply_list,
            native_reply_read_body,
            native_reply_consume,
            native_reply_discard,
            native_reply_park
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // Set at exit so a restart child inherits it and a plain exit spawns
            // nothing afterwards. If request_exit fails, tauri restarts without
            // running this callback and the argv file may import once more. Runtime
            // threads exist here; accepted because only the restart child starts after.
            #[cfg(desktop)]
            if let tauri::RunEvent::Exit = _event {
                std::env::set_var(launch_inputs::LAUNCH_CONSUMED_ENV, "1");
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let cwd = std::env::current_dir().ok();
                let mut inputs = LaunchInputs::default();
                for url in urls {
                    if url.scheme() == "file" {
                        if let Some(file) = url
                            .to_file_path()
                            .ok()
                            .and_then(|path| launch_inputs::file_input(&path, cwd.as_deref()))
                        {
                            inputs.files.push(file);
                        }
                    } else if launch_inputs::is_deep_link(url.as_str()) {
                        inputs.urls.push(url.to_string());
                    }
                }
                queue_launch_inputs(_app, inputs);
            }
        });
}

#[cfg(test)]
mod dependency_guard_tests {
    // Desktop must stay on the platform-native TLS backend even though tauri-plugin-http also enables
    // rustls for reqwest. The builder prints its backend choice only while both TLS features are on,
    // so a failure here also appears if a dependency stops enabling rustls; check the real cause with
    // `cargo tree -e features -i reqwest` before changing this test.
    #[cfg(not(target_os = "android"))]
    #[test]
    fn desktop_reqwest_keeps_native_tls_backend() {
        let shown = format!("{:?}", reqwest::Client::builder());
        assert!(shown.contains("tls_backend: Default"), "unexpected reqwest builder: {}", shown);
    }
}
