// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use base64::{engine::general_purpose, Engine as _};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::json;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Write;
use std::{path::Path, time::Duration};
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri::{AppHandle, Emitter};
use tauri_plugin_fs::FsExt;

mod env_secret;
mod launch_inputs;
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
async fn native_request(url: String, body: String, header: String, method: String) -> String {
    let headers_json: Value = match serde_json::from_str(&header) {
        Ok(h) => h,
        Err(e) => return format!(r#"{{"success":false,"body":"{}"}}"#, e.to_string()),
    };

    let mut headers = HeaderMap::new();
    let method = method.to_string();
    if let Some(obj) = headers_json.as_object() {
        for (key, value) in obj {
            let header_name = match HeaderName::from_bytes(key.as_bytes()) {
                Ok(name) => name,
                Err(e) => return format!(r#"{{"success":false,"body":"{}"}}"#, e.to_string()),
            };
            let header_value = match HeaderValue::from_str(value.as_str().unwrap_or("")) {
                Ok(value) => value,
                Err(e) => return format!(r#"{{"success":false,"body":"{}"}}"#, e.to_string()),
            };
            headers.insert(header_name, header_value);
        }
    } else {
        return format!(r#"{{"success":false,"body":"Invalid header JSON"}}"#);
    }

    let client = reqwest::Client::new();
    let response: Result<reqwest::Response, reqwest::Error>;

    if method == "POST" {
        response = client
            .post(&url)
            .headers(headers)
            .timeout(Duration::from_secs(120))
            .body(body)
            .send()
            .await;
    } else {
        response = client
            .get(&url)
            .headers(headers)
            .timeout(Duration::from_secs(120))
            .send()
            .await;
    }

    match response {
        Ok(resp) => {
            let headers = resp.headers();
            let header_json = header_map_to_json(headers);
            let status = resp.status().as_u16().to_string();
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => return format!(r#"{{"success":false,"body":"{}"}}"#, e.to_string()),
            };
            let encoded = general_purpose::STANDARD.encode(&bytes);

            format!(
                // r#"{{"success":true,"body":"{}","headers":{}}}"#,
                r#"{{"success":true,"body":"{}","headers":{},"status":{}}}"#,
                encoded, header_json, status
            )
        }
        Err(e) => format!(r#"{{"success":false,"body":"{}","status":400}}"#, e.to_string()),
    }
}

#[tauri::command]
fn check_auth(fpath: String, auth: String) -> bool {
    //check file exists
    let path = Path::new(&fpath);
    if !path.exists() {
        println!("File {} does not exist", path.display());
        return false;
    }

    // check file is a file
    if !path.is_file() {
        println!("File {} is not a file", path.display());
        return false;
    }

    // check file size
    let size = std::fs::metadata(&fpath).unwrap().len();

    //check file size is less than 1000 bytes
    if size > 1000 {
        println!("File {} is too large", path.display());
        return false;
    }

    // read file, return false when error
    let got_auth = std::fs::read_to_string(&path);

    // check read error
    if got_auth.is_err() {
        println!("Error reading file {}", path.display());
        return false;
    } else {
        // check auth
        if got_auth.unwrap() != auth {
            println!("Auth does not match");
            return false;
        }
        println!("Auth matches");
        return true;
    }
}

#[cfg(windows)]
fn host_is_arm64() -> bool {
    use windows_sys::Win32::System::SystemInformation::IMAGE_FILE_MACHINE_ARM64;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, IsWow64Process2};

    let mut process_machine = 0u16;
    let mut native_machine = 0u16;
    let ok = unsafe { IsWow64Process2(GetCurrentProcess(), &mut process_machine, &mut native_machine) };
    if ok == 0 {
        println!("IsWow64Process2 failed; assuming host is not ARM64");
        return false;
    }
    native_machine == IMAGE_FILE_MACHINE_ARM64
}

#[cfg(not(windows))]
fn host_is_arm64() -> bool {
    false
}

#[tauri::command]
fn local_inference_unsupported_reason() -> Option<String> {
    let os = std::env::consts::OS;
    if os == "windows" {
        if host_is_arm64() {
            return Some("Local inference is unavailable on Windows on ARM: the bundled Python local-inference server requires a native build of llama-cpp-python, which cannot be performed on this machine.".to_string());
        }
        return None;
    }
    Some(format!("Local inference via the bundled Python server is only supported on Windows (detected OS: {}).", os))
}

#[tauri::command]
async fn install_python(path: String) -> bool {
    //get python embeddable depending on os and CPU architecture
    let os = std::env::consts::OS;
    // std::env::consts::ARCH is compile-time: it describes the build target,
    // not the host CPU, so it cannot detect an emulated ARM64 host. Host
    // detection is done at runtime by host_is_arm64() (via IsWow64Process2)
    // below, which is what actually gates this function. Local inference is
    // refused on ARM64 Windows hosts because a real end user has no Visual
    // Studio or Clang, so the first-run `pip install llama-cpp-python`
    // source build cannot succeed there.
    let url;
    let py_path = Path::new(&path).join("python");
    if !py_path.exists() {
        if let Err(e) = std::fs::create_dir_all(&py_path) {
            println!("Failed to create python directory: {}", e);
            return false;
        }
    }
    let zip_path: std::path::PathBuf = Path::new(&path).join("python.zip");

    println!("Path: {}", path);
    if os == "windows" {
        if host_is_arm64() {
            println!("Host is ARM64 Windows; refusing to install the bundled Python runtime because llama-cpp-python cannot be built natively on this machine");
            return false;
        }
        // Native aarch64 builds are refused above via host_is_arm64(), so
        // only the amd64 embeddable interpreter is ever needed here. Keep
        // the arm64 URL around in case that changes:
        // "https://www.python.org/ftp/python/3.11.7/python-3.11.7-embed-arm64.zip"
        url = "https://www.python.org/ftp/python/3.11.7/python-3.11.7-embed-amd64.zip".to_string();
    } else {
        println!("OS not supported");
        return false;
    }

    //download python embeddable
    let mut resp = match reqwest::get(&url).await {
        Ok(r) => r,
        Err(e) => {
            println!("Failed to download python embeddable: {}", e);
            return false;
        }
    };
    let mut out = match std::fs::File::create(&zip_path) {
        Ok(f) => f,
        Err(e) => {
            println!("Failed to create python.zip: {}", e);
            return false;
        }
    };
    let mut content = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                content.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => {
                println!("Failed to download python embeddable chunk: {}", e);
                return false;
            }
        }
    }
    if let Err(e) = out.write_all(&content) {
        println!("Failed to write python.zip: {}", e);
        return false;
    }

    //extract python embeddable

    use zip::ZipArchive;

    if os == "windows" {
        let zip_file = match std::fs::File::open(&zip_path) {
            Ok(f) => f,
            Err(e) => {
                println!("Failed to open python.zip: {}", e);
                return false;
            }
        };
        let mut zipf = match ZipArchive::new(zip_file) {
            Ok(z) => z,
            Err(e) => {
                println!("Failed to read python.zip archive: {}", e);
                return false;
            }
        };
        if let Err(e) = zipf.extract(&py_path) {
            println!("Failed to extract python.zip: {}", e);
            return false;
        }
    } else if os == "linux" {
        let tar_file = match std::fs::File::open(&zip_path) {
            Ok(f) => f,
            Err(e) => {
                println!("Failed to open python.zip: {}", e);
                return false;
            }
        };
        let mut tarf = tar::Archive::new(tar_file);
        if let Err(e) = tarf.unpack(&py_path) {
            println!("Failed to extract python.zip: {}", e);
            return false;
        }
    } else if os == "macos" {
        let zip_file = match std::fs::File::open(&zip_path) {
            Ok(f) => f,
            Err(e) => {
                println!("Failed to open python.zip: {}", e);
                return false;
            }
        };
        let mut zipf = match zip::ZipArchive::new(zip_file) {
            Ok(z) => z,
            Err(e) => {
                println!("Failed to read python.zip archive: {}", e);
                return false;
            }
        };
        if let Err(e) = zipf.extract(&py_path) {
            println!("Failed to extract python.zip: {}", e);
            return false;
        }
    } else {
        println!("OS not supported");
        return false;
    }

    let py_exec_path = py_path.join("python.exe");

    //check python is installed
    let mut py = Command::new(py_exec_path);
    let output = py.arg("--version").output();
    match output {
        Ok(o) => {
            let res = match String::from_utf8(o.stdout) {
                Ok(s) => s,
                Err(e) => {
                    println!("Failed to parse python --version output: {}", e);
                    return false;
                }
            };
            if !res.starts_with("Python ") {
                return false;
            }
            println!("{}", res);
            return true;
        }
        Err(e) => {
            println!("{}", e);
            return false;
        }
    }
}

#[tauri::command]
async fn install_pip(path: String) -> bool {
    let py_path = Path::new(&path).join("python");
    let py_exec_path = py_path.join("python.exe");
    let get_pip_url = "https://bootstrap.pypa.io/get-pip.py";
    let mut resp = match reqwest::get(get_pip_url).await {
        Ok(r) => r,
        Err(e) => {
            println!("Failed to download get-pip.py: {}", e);
            return false;
        }
    };
    let get_pip_path = Path::new(&path).join("get-pip.py");
    let mut out = match std::fs::File::create(&get_pip_path) {
        Ok(f) => f,
        Err(e) => {
            println!("Failed to create get-pip.py: {}", e);
            return false;
        }
    };
    let mut content = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                content.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => {
                println!("Failed to download get-pip.py chunk: {}", e);
                return false;
            }
        }
    }
    if let Err(e) = out.write_all(&content) {
        println!("Failed to write get-pip.py: {}", e);
        return false;
    }

    let mut py = Command::new(py_exec_path);
    let output = py.arg(get_pip_path).output();
    match output {
        Ok(o) => {
            let res = String::from_utf8_lossy(&o.stdout);
            println!("{}", res);
            if !o.status.success() {
                let stderr = String::from_utf8_lossy(&o.stderr);
                println!("get-pip.py failed with status {}: {}", o.status, stderr);
                return false;
            }
            return true;
        }
        Err(e) => {
            println!("{}", e);
            return false;
        }
    }
}

use std::process::Command;

#[tauri::command]
fn check_requirements_local() -> String {
    let mut py = Command::new("python");
    let output = py.arg("--version").output();
    match output {
        Ok(o) => {
            let res = String::from_utf8(o.stdout).unwrap();
            if !res.starts_with("Python ") {
                return "Python is not installed".to_string();
            }
            println!("{}", res);
        }
        Err(e) => {
            println!("{}", e);
            return "Python is not installed, or not loadable".to_string();
        }
    }

    let mut git = Command::new("git");
    let output = git.arg("--version").output();
    match output {
        Ok(o) => {
            let res = String::from_utf8(o.stdout).unwrap();
            if !res.starts_with("git version ") {
                return "Git is not installed".to_string();
            }
            println!("{}", res);
        }
        Err(e) => {
            println!("{}", e);
            return "Git is not installed, or not loadable".to_string();
        }
    }

    return "success".to_string();
}

#[tauri::command]
fn post_py_install(path: String) -> bool {
    let py_path = Path::new(&path).join("python");
    let py_pth_path = py_path.join("python311._pth");
    let py_exec_path = py_path.join("python.exe");

    //uncomment python libs
    let mut py_pth = match std::fs::read_to_string(&py_pth_path) {
        Ok(s) => s,
        Err(e) => {
            println!("Failed to read python311._pth: {}", e);
            return false;
        }
    };
    py_pth = py_pth.replace("#import site", "import site");
    if let Err(e) = std::fs::write(&py_pth_path, py_pth) {
        println!("Failed to write python311._pth: {}", e);
        return false;
    }

    //verify pip is actually usable now that site imports are enabled
    let mut py = Command::new(py_exec_path);
    let output = py.arg("-m").arg("pip").arg("--version").output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).to_string();
            let stderr = String::from_utf8_lossy(&o.stderr).to_string();
            println!("{}", stdout);
            if !stderr.is_empty() {
                println!("{}", stderr);
            }
            if !o.status.success() || !stdout.starts_with("pip ") {
                println!("pip verification failed after python311._pth rewrite");
                return false;
            }
        }
        Err(e) => {
            println!("Failed to run pip --version: {}", e);
            return false;
        }
    }

    //create "completed" file
    let completed_path = py_path.join("completed.txt");
    if let Err(e) = std::fs::write(&completed_path, "python311") {
        println!("Failed to write completed.txt: {}", e);
        return false;
    }
    return true;
}

#[tauri::command]
fn install_py_dependencies(path: String, dependency: String) -> Result<(), String> {
    println!("installing {}", dependency);
    let py_path = Path::new(&path).join("python");
    let py_exec_path = py_path.join("python.exe");
    let mut py = Command::new(py_exec_path);
    let output = py
        .arg("-m")
        .arg("pip")
        .arg("install")
        .arg(&dependency)
        .output();
    match output {
        Ok(o) => {
            let res = String::from_utf8_lossy(&o.stdout).to_string();
            println!("{}", res);
            if !o.status.success() {
                let stderr_full = String::from_utf8_lossy(&o.stderr).to_string();
                const MAX_STDERR_CHARS: usize = 4000;
                let char_count = stderr_full.chars().count();
                let stderr = if char_count > MAX_STDERR_CHARS {
                    let skip = char_count - MAX_STDERR_CHARS;
                    let tail: String = stderr_full.chars().skip(skip).collect();
                    format!("(truncated) ...{}", tail)
                } else {
                    stderr_full
                };
                return Err(format!(
                    "Failed to install {}: {}",
                    dependency, stderr
                ));
            }
            return Ok(());
        }
        Err(e) => {
            println!("{}", e);
            return Err(e.to_string());
        }
    }
}

#[tauri::command]
fn run_py_server(handle: tauri::AppHandle, py_path: String) {
    let py_exec_path = Path::new(&py_path).join("python").join("python.exe");
    let server_path = handle
        .path()
        .resolve("src-python/run.py", BaseDirectory::Resource)
        .expect("failed to resolve resource");

    let mut py_server = Command::new(&py_exec_path);
    //set working directory to server path
    py_server.current_dir(server_path.parent().unwrap());

    println!("server_path: {}", server_path.display());
    println!("py_exec_path: {}", py_exec_path.display());
    let mut _child = py_server
        .arg("-m")
        .arg("uvicorn")
        .arg("--port")
        .arg("10026")
        .arg("main:app")
        .spawn()
        .expect("failed to execute process");
    println!("server started");
    return;
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
) -> String {
    //parse headers
    let headers_json: Value = match serde_json::from_str(&headers) {
        Ok(h) => h,
        Err(e) => return format!(r#"{{"success":false, body:{}}}"#, e.to_string()),
    };

    let mut headers = HeaderMap::new();
    if let Some(obj) = headers_json.as_object() {
        for (key, value) in obj {
            let header_name = match HeaderName::from_bytes(key.as_bytes()) {
                Ok(name) => name,
                Err(e) => return format!(r#"{{"success":false, body:{}}}"#, e.to_string()),
            };
            let header_value = match HeaderValue::from_str(value.as_str().unwrap_or("")) {
                Ok(value) => value,
                Err(e) => return format!(r#"{{"success":false, body:{}}}"#, e.to_string()),
            };
            headers.insert(header_name, header_value);
        }
    } else {
        return format!(r#"{{"success":false,"body":"Invalid header JSON"}}"#);
    }

    let client = reqwest::Client::new();
    let timeout_secs = timeout_secs.unwrap_or(240);
    let builder: reqwest::RequestBuilder;
    if method == "POST" {

        let body_decoded = general_purpose::STANDARD.decode(body.as_bytes()).unwrap();

        builder = client
        .post(&url)
        .headers(headers)
        .timeout(Duration::from_secs(timeout_secs))
        .body(body_decoded)
    }
    else if method == "GET" {
        builder = client
        .get(&url)
        .headers(headers)
        .timeout(Duration::from_secs(timeout_secs));
    }
    else if method == "PUT" {

        let body_decoded = general_purpose::STANDARD.decode(body.as_bytes()).unwrap();

        builder = client
        .put(&url)
        .headers(headers)
        .timeout(Duration::from_secs(timeout_secs))
        .body(body_decoded)
    }
    else if method == "DELETE" {

        let body_decoded = general_purpose::STANDARD.decode(body.as_bytes()).unwrap();

        builder = client
        .delete(&url)
        .headers(headers)
        .timeout(Duration::from_secs(timeout_secs))
        .body(body_decoded)
    }
    else {
        return format!(r#"{{"success":false, body:"Invalid method"}}"#);
    }



    let response = builder
        .send()
        .await;

    match response {
        Ok(mut resp) => {
            let headers = resp.headers();
            let header_json = header_map_to_json(headers);
            app.emit(
                "streamed_fetch",
                &format!(
                    r#"{{"type": "headers", "body": {}, "id": "{}", "status": {}}}"#,
                    header_json,
                    id,
                    resp.status().as_u16()
                ),
            )
            .unwrap();
            loop {
                let byt = resp.chunk().await;
                match byt {
                    Ok(chunk) => {
                        if chunk.is_none() {
                            break;
                        }
                        let chunk = chunk.unwrap();
                        let encoded = general_purpose::STANDARD.encode(chunk);
                        let emited = app.emit(
                            "streamed_fetch",
                            &format!(
                                r#"{{"type": "chunk", "body": "{}", "id": "{}"}}"#,
                                encoded, id
                            ),
                        );

                        match emited {
                            Ok(_) => {}
                            Err(e) => {
                                return format!(r#"{{"success":false, body:{}}}"#, e.to_string())
                            }
                        }
                    }
                    Err(e) => return format!(r#"{{"success":false, body:{}}}"#, e.to_string()),
                }
            }
            app.emit(
                "streamed_fetch",
                &format!(r#"{{"type": "end", "id": "{}"}}"#, id),
            )
            .unwrap();
            return "{\"success\":true}".to_string();
        }
        Err(e) => return format!(r#"{{"success":false, body:{}}}"#, e.to_string()),
    }
}


fn main() {
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

    let mut builder = tauri::Builder::default().manage(PendingLaunch(Mutex::new(cold_launch)));

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_launch_inputs(
                app,
                launch_inputs::classify(args.into_iter().map(Into::into), Some(Path::new(&cwd))),
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Some(state) = app.try_state::<PendingLaunch>() {
                let files = lock_pending(&state).files.clone();
                allow_launch_files(app.handle(), &files);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            take_launch_inputs,
            read_env_secret,
            native_request,
            check_auth,
            check_requirements_local,
            local_inference_unsupported_reason,
            install_python,
            install_pip,
            post_py_install,
            run_py_server,
            install_py_dependencies,
            streamed_fetch
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

fn header_map_to_json(header_map: &HeaderMap) -> serde_json::Value {
    let mut map = HashMap::new();
    for (key, value) in header_map {
        map.insert(
            key.as_str().to_string(),
            value.to_str().unwrap().to_string(),
        );
    }
    json!(map)
}
