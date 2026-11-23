//! The gate in front of the fs plugin, and the one rule for another app's content links.
//!
//! On Android the page may only list a directory by path, open a link of another app read-only, and use the
//! handles that open made. Anything else, including an unknown command or a malformed body, is answered with a
//! refusal and never reaches the plugin; a refusal returns true, since an unhandled invoke falls through to Kotlin.
//! The rule judges the exact string handed on. It refuses an own, `localhost`, empty or non-plain authority
//! (`localhost` and an empty one convert to a path), so an accepted string never converts to a path.
//! Other targets pass through. fs is registered only through `app_plugins`.

use serde_json::Value;
use std::str::FromStr;
use tauri::ipc::{Invoke, InvokeBody};
use tauri::plugin::Plugin;
use tauri::webview::PageLoadPayload;
use tauri::{AppHandle, Manager, RunEvent, Runtime, Url, Webview, Window};
use tauri_plugin_fs::SafeFilePath;

/// Whether `text` is a content link of another app: `content://`, a plain authority (letters, digits, `.`, `_`,
/// `-`, with an optional numeric user prefix), and neither `localhost` nor the app's own id or a name under it.
pub fn foreign_content_uri(text: &str, own: &str) -> bool {
    if own.is_empty() {
        return false;
    }
    let Some(rest) = text.strip_prefix("content://") else {
        return false;
    };
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let host = match authority.split_once('@') {
        Some((user, host)) => {
            if user.is_empty() || !user.bytes().all(|b| b.is_ascii_digit()) {
                return false;
            }
            host
        }
        None => authority,
    };
    if host.is_empty() || !host.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) {
        return false;
    }
    let bytes = host.as_bytes();
    let own_bytes = own.as_bytes();
    if host.eq_ignore_ascii_case("localhost") || bytes.eq_ignore_ascii_case(own_bytes) {
        return false;
    }
    let under_own = bytes.len() > own_bytes.len()
        && bytes[..own_bytes.len()].eq_ignore_ascii_case(own_bytes)
        && bytes[own_bytes.len()] == b'.';
    !under_own
}

/// How the Android policy treats a command, as the shared fixture names it; `None` is a refused command.
pub fn android_command_kind(command: &str) -> Option<&'static str> {
    match command {
        "read_dir" => Some("path-only"),
        "open" => Some("read-only-content-url"),
        "read" | "seek" | "fstat" => Some("handle"),
        _ => None,
    }
}

const REFUSED_COMMAND: &str = "this command is not available";
const REFUSED_BODY: &str = "the request is not a plain JSON object with a string path";
const REFUSED_LISTING: &str = "a listing names a directory by path";
const REFUSED_LINK: &str = "an open names a content link of another app";
const REFUSED_OPTIONS: &str = "an open is read-only with no other option";

fn path_of(body: &InvokeBody) -> Result<(&serde_json::Map<String, Value>, &str), &'static str> {
    match body {
        InvokeBody::Json(Value::Object(map)) => match map.get("path") {
            Some(Value::String(path)) => Ok((map, path)),
            _ => Err(REFUSED_BODY),
        },
        _ => Err(REFUSED_BODY),
    }
}

/// The Android policy: `Ok` hands the invoke to the plugin, `Err` is the fixed reason it is refused.
pub fn android_verdict(command: &str, body: &InvokeBody, own: &str) -> Result<(), &'static str> {
    match android_command_kind(command) {
        Some("handle") => Ok(()),
        Some("path-only") => {
            let (_, path) = path_of(body)?;
            match SafeFilePath::from_str(path) {
                Ok(SafeFilePath::Path(_)) => Ok(()),
                _ => Err(REFUSED_LISTING),
            }
        }
        Some("read-only-content-url") => {
            let (map, path) = path_of(body)?;
            match SafeFilePath::from_str(path) {
                Ok(SafeFilePath::Url(url)) if foreign_content_uri(path, own) && foreign_content_uri(url.as_str(), own) => {}
                _ => return Err(REFUSED_LINK),
            }
            let read_only = match map.get("options") {
                None | Some(Value::Null) => true,
                Some(Value::Object(options)) => {
                    options.is_empty() || (options.len() == 1 && options.get("read") == Some(&Value::Bool(true)))
                }
                Some(_) => false,
            };
            if read_only {
                Ok(())
            } else {
                Err(REFUSED_OPTIONS)
            }
        }
        _ => Err(REFUSED_COMMAND),
    }
}

/// Decides, before a plugin sees an invoke, whether it may continue.
pub trait Gate: Send + 'static {
    fn verdict(&self, command: &str, body: &InvokeBody, own: &str) -> Result<(), &'static str>;
}

pub enum Policy {
    PassThrough,
    Android,
}

impl Gate for Policy {
    fn verdict(&self, command: &str, body: &InvokeBody, own: &str) -> Result<(), &'static str> {
        match self {
            Policy::PassThrough => Ok(()),
            Policy::Android => android_verdict(command, body, own),
        }
    }
}

/// The policy of a target: Android's for `"android"`, a pass-through for every other.
pub fn for_os(os: &str) -> Policy {
    if os == "android" {
        Policy::Android
    } else {
        Policy::PassThrough
    }
}

/// A plugin whose commands pass the gate first. Every hook but `extend_api` is forwarded unchanged.
pub struct Guarded<P, G> {
    inner: P,
    gate: G,
}

impl<P, G> Guarded<P, G> {
    pub fn new(inner: P, gate: G) -> Self {
        Guarded { inner, gate }
    }
}

impl<R: Runtime, P: Plugin<R>, G: Gate> Plugin<R> for Guarded<P, G> {
    fn name(&self) -> &'static str {
        self.inner.name()
    }

    fn initialize(&mut self, app: &AppHandle<R>, config: Value) -> Result<(), Box<dyn std::error::Error>> {
        self.inner.initialize(app, config)
    }

    fn initialization_script(&self) -> Option<String> {
        self.inner.initialization_script()
    }

    fn window_created(&mut self, window: Window<R>) {
        self.inner.window_created(window)
    }

    fn webview_created(&mut self, webview: Webview<R>) {
        self.inner.webview_created(webview)
    }

    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.inner.on_navigation(webview, url)
    }

    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.inner.on_page_load(webview, payload)
    }

    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.inner.on_event(app, event)
    }

    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        let own = invoke.message.webview_ref().app_handle().config().identifier.clone();
        match self.gate.verdict(invoke.message.command(), invoke.message.payload(), &own) {
            Ok(()) => self.inner.extend_api(invoke),
            Err(reason) => {
                invoke.resolver.reject(format!("refused-fs: {reason}"));
                true
            }
        }
    }
}
