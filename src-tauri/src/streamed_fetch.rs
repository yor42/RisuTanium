// Native streaming fetch behind the `streamed_fetch` command.
//
// Invariants:
// - Every result string is valid JSON and no request or IO path can panic.
// - Error text never contains a URL or header value.
// - After the response head has been emitted, the terminal event is `error` or
//   `end`, never both; the first terminal signal wins.
// - A cancelled request drops its reqwest future, which closes the socket.

use base64::{engine::general_purpose, Engine as _};
use crate::net_policy::{
    blocked_message, literal_refusal, system_lookup, CheckedResolver, Lookup, NetPolicy,
};
use futures::future::{AbortHandle, AbortRegistration, Abortable};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::error::Error as StdError;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub const TOMBSTONE_CAP: usize = 64;
pub const TOMBSTONE_TTL: Duration = Duration::from_secs(10);
const DEFAULT_TIMEOUT_SECS: u64 = 240;
const MAX_REDIRECTS: usize = 10;

struct RegistryState {
    next_serial: u64,
    live: HashMap<String, (u64, AbortHandle)>,
    tombstones: HashMap<String, Instant>,
}

/// Maps a request id to its abort handle. A cancel that arrives before the
/// request registers leaves a short-lived tombstone so the later registration
/// aborts at once. Registry and tombstones share one mutex.
#[derive(Clone)]
pub struct FetchRegistry {
    state: Arc<Mutex<RegistryState>>,
}

pub enum Registration {
    AlreadyCancelled,
    Live(RegistrationGuard, AbortRegistration),
}

/// Removes the registry entry on every exit path, but only while the entry
/// still belongs to this registration (an id may be reused).
pub struct RegistrationGuard {
    registry: FetchRegistry,
    id: String,
    serial: u64,
}

impl Drop for RegistrationGuard {
    fn drop(&mut self) {
        let mut state = self.registry.lock();
        let owned = matches!(state.live.get(&self.id), Some((serial, _)) if *serial == self.serial);
        if owned {
            state.live.remove(&self.id);
        }
    }
}

impl FetchRegistry {
    pub fn new() -> Self {
        FetchRegistry {
            state: Arc::new(Mutex::new(RegistryState {
                next_serial: 0,
                live: HashMap::new(),
                tombstones: HashMap::new(),
            })),
        }
    }

    fn lock(&self) -> MutexGuard<'_, RegistryState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn purge(state: &mut RegistryState, now: Instant) {
        state
            .tombstones
            .retain(|_, born| now.saturating_duration_since(*born) < TOMBSTONE_TTL);
    }

    pub fn register(&self, id: &str) -> Registration {
        self.register_at(id, Instant::now())
    }

    pub fn register_at(&self, id: &str, now: Instant) -> Registration {
        let mut state = self.lock();
        Self::purge(&mut state, now);
        if state.tombstones.remove(id).is_some() {
            return Registration::AlreadyCancelled;
        }
        state.next_serial += 1;
        let serial = state.next_serial;
        let (handle, registration) = AbortHandle::new_pair();
        state.live.insert(id.to_string(), (serial, handle));
        Registration::Live(
            RegistrationGuard {
                registry: self.clone(),
                id: id.to_string(),
                serial,
            },
            registration,
        )
    }

    pub fn cancel(&self, id: &str) {
        self.cancel_at(id, Instant::now());
    }

    pub fn cancel_at(&self, id: &str, now: Instant) {
        let mut state = self.lock();
        Self::purge(&mut state, now);
        if let Some((_, handle)) = state.live.remove(id) {
            handle.abort();
            return;
        }
        if !state.tombstones.contains_key(id) && state.tombstones.len() >= TOMBSTONE_CAP {
            let oldest = state
                .tombstones
                .iter()
                .min_by_key(|(_, born)| **born)
                .map(|(key, _)| key.clone());
            if let Some(key) = oldest {
                state.tombstones.remove(&key);
            }
        }
        state.tombstones.insert(id.to_string(), now);
    }

    #[cfg(test)]
    fn live_len(&self) -> usize {
        self.lock().live.len()
    }

    #[cfg(test)]
    fn tombstone_len(&self) -> usize {
        self.lock().tombstones.len()
    }
}

pub struct FetchRequest {
    pub id: String,
    pub url: String,
    pub headers: String,
    pub body: String,
    pub method: String,
    pub timeout_secs: Option<u64>,
    /// `None` keeps the unrestricted client; only untrusted callers set it.
    pub policy: Option<NetPolicy>,
}

fn failure(message: &str) -> String {
    json!({ "success": false, "body": message }).to_string()
}

fn cancelled() -> String {
    json!({ "success": true, "cancelled": true }).to_string()
}

/// reqwest error text with the URL removed, followed by the source chain.
fn error_text(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

fn header_map_to_json(header_map: &HeaderMap) -> Value {
    let mut map = HashMap::new();
    for (key, value) in header_map {
        map.insert(
            key.as_str().to_string(),
            String::from_utf8_lossy(value.as_bytes()).into_owned(),
        );
    }
    json!(map)
}

fn build_request(
    client: &reqwest::Client,
    request: &FetchRequest,
) -> Result<reqwest::RequestBuilder, String> {
    let headers_json: Value =
        serde_json::from_str(&request.headers).map_err(|e| e.to_string())?;
    let object = headers_json
        .as_object()
        .ok_or_else(|| "Invalid header JSON".to_string())?;
    let mut headers = HeaderMap::new();
    for (key, value) in object {
        let name = HeaderName::from_bytes(key.as_bytes()).map_err(|e| e.to_string())?;
        let value = HeaderValue::from_str(value.as_str().unwrap_or(""))
            .map_err(|e| e.to_string())?;
        headers.insert(name, value);
    }

    let builder = match request.method.as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url).body(decode_body(&request.body)?),
        "PUT" => client.put(&request.url).body(decode_body(&request.body)?),
        "DELETE" => client.delete(&request.url).body(decode_body(&request.body)?),
        _ => return Err("Invalid method".to_string()),
    };
    let builder = builder.headers(headers);
    // Zero is the caller's explicit "no limit"; an absent value keeps the default.
    Ok(match request.timeout_secs {
        Some(0) => builder,
        Some(secs) => builder.timeout(Duration::from_secs(secs)),
        None => builder.timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS)),
    })
}

fn decode_body(body: &str) -> Result<Vec<u8>, String> {
    general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|e| e.to_string())
}

/// With a policy the client ignores system proxies (a proxy would resolve and
/// dial on its own), resolves names through the checking resolver and refuses
/// redirects to disallowed IP literals; without one it is the plain client.
fn build_client(policy: Option<&NetPolicy>, lookup: Lookup) -> reqwest::Result<reqwest::Client> {
    let Some(policy) = policy.copied() else {
        return reqwest::Client::builder().build();
    };
    reqwest::Client::builder()
        .no_proxy()
        .dns_resolver(Arc::new(CheckedResolver { policy, lookup }))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("too many redirects");
            }
            if let Some(host) = literal_refusal(attempt.url(), &policy) {
                return attempt.error(blocked_message(&host));
            }
            attempt.follow()
        }))
        .build()
}

async fn run_fetch<F>(request: &FetchRequest, emit: &F) -> String
where
    F: Fn(String) -> Result<(), String>,
{
    run_fetch_with(request, emit, system_lookup()).await
}

async fn run_fetch_with<F>(request: &FetchRequest, emit: &F, lookup: Lookup) -> String
where
    F: Fn(String) -> Result<(), String>,
{
    // Hyper never consults the resolver for an IP literal, so check it here.
    if let Some(policy) = request.policy.as_ref() {
        if let Ok(url) = url::Url::parse(&request.url) {
            if let Some(host) = literal_refusal(&url, policy) {
                return failure(&blocked_message(&host));
            }
        }
    }
    let client = match build_client(request.policy.as_ref(), lookup) {
        Ok(client) => client,
        Err(e) => return failure(&error_text(e)),
    };
    let builder = match build_request(&client, request) {
        Ok(builder) => builder,
        Err(message) => return failure(&message),
    };
    let mut response = match builder.send().await {
        Ok(response) => response,
        Err(e) => return failure(&error_text(e)),
    };

    let head = json!({
        "type": "headers",
        "body": header_map_to_json(response.headers()),
        "id": request.id,
        "status": response.status().as_u16(),
    });
    if let Err(message) = emit(head.to_string()) {
        return failure(&message);
    }

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let event = json!({
                    "type": "chunk",
                    "body": general_purpose::STANDARD.encode(chunk),
                    "id": request.id,
                });
                if let Err(message) = emit(event.to_string()) {
                    return failure(&message);
                }
            }
            Ok(None) => break,
            Err(e) => {
                let message = error_text(e);
                let event = json!({ "type": "error", "body": message, "id": request.id });
                // The failure result below carries the same text if this emit fails.
                let _ = emit(event.to_string());
                return failure(&message);
            }
        }
    }

    let end = json!({ "type": "end", "id": request.id });
    if let Err(message) = emit(end.to_string()) {
        return failure(&message);
    }
    json!({ "success": true }).to_string()
}

/// Registers the request id, then runs the fetch until it ends or is cancelled.
/// Registration is the first step so a cancel that raced ahead is honoured
/// before any request is made.
pub async fn run_registered<F>(registry: &FetchRegistry, request: FetchRequest, emit: F) -> String
where
    F: Fn(String) -> Result<(), String> + Send + Sync,
{
    let (_guard, abort_registration) = match registry.register(&request.id) {
        Registration::AlreadyCancelled => return cancelled(),
        Registration::Live(guard, abort_registration) => (guard, abort_registration),
    };
    match Abortable::new(run_fetch(&request, &emit), abort_registration).await {
        Ok(result) => result,
        Err(_) => cancelled(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Read, Write};
    use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::thread;

    fn bind_stub() -> (TcpListener, u16) {
        for port in 6330..=6349u16 {
            if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
                return (listener, port);
            }
        }
        panic!("no free port in 6330-6349");
    }

    fn read_request(stream: &mut TcpStream) {
        let mut seen = Vec::new();
        let mut byte = [0u8; 1];
        while !seen.ends_with(b"\r\n\r\n") {
            match stream.read(&mut byte) {
                Ok(1) => seen.push(byte[0]),
                _ => return,
            }
        }
    }

    fn write_head(stream: &mut TcpStream) {
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
        );
    }

    fn write_chunk(stream: &mut TcpStream, data: &[u8]) {
        let _ = stream.write_all(format!("{:x}\r\n", data.len()).as_bytes());
        let _ = stream.write_all(data);
        let _ = stream.write_all(b"\r\n");
        let _ = stream.flush();
    }

    fn serve_once<H>(handler: H) -> (u16, thread::JoinHandle<()>)
    where
        H: FnOnce(TcpStream) + Send + 'static,
    {
        let (listener, port) = bind_stub();
        let join = thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                read_request(&mut stream);
                handler(stream);
            }
        });
        (port, join)
    }

    fn request(id: &str, url: String) -> FetchRequest {
        FetchRequest {
            id: id.to_string(),
            url,
            headers: "{}".to_string(),
            body: String::new(),
            method: "GET".to_string(),
            timeout_secs: Some(20),
            policy: None,
        }
    }

    type Events = Arc<Mutex<Vec<Value>>>;

    fn collector() -> (Events, impl Fn(String) -> Result<(), String> + Send + Sync) {
        let events: Events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let emit = move |payload: String| {
            let parsed: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            sink.lock().unwrap().push(parsed);
            Ok(())
        };
        (events, emit)
    }

    fn types(events: &Events) -> Vec<String> {
        events
            .lock()
            .unwrap()
            .iter()
            .map(|event| event["type"].as_str().unwrap_or("?").to_string())
            .collect()
    }

    fn parse(result: &str) -> Value {
        serde_json::from_str(result).expect("result must be valid JSON")
    }

    fn run(registry: &FetchRegistry, request: FetchRequest) -> (String, Events) {
        let (events, emit) = collector();
        let result =
            tauri::async_runtime::block_on(run_registered(registry, request, emit));
        (result, events)
    }

    #[test]
    fn build_request_bad_base64_returns_err_and_valid_json() {
        let client = reqwest::Client::new();
        let mut req = request("a", "http://127.0.0.1:9/".to_string());
        req.method = "POST".to_string();
        req.body = "***not base64***".to_string();
        let message = build_request(&client, &req).err().expect("decode must fail");
        let parsed = parse(&failure(&message));
        assert_eq!(parsed["success"], json!(false));
        assert!(parsed["body"].as_str().unwrap().len() > 0);

        let registry = FetchRegistry::new();
        let (result, events) = run(&registry, req);
        assert_eq!(parse(&result)["success"], json!(false));
        assert!(events.lock().unwrap().is_empty());
    }

    fn built_timeout(timeout_secs: Option<u64>) -> Option<Duration> {
        let client = reqwest::Client::new();
        let mut req = request("t", "http://127.0.0.1:9/".to_string());
        req.timeout_secs = timeout_secs;
        build_request(&client, &req)
            .ok()
            .expect("request must build")
            .build()
            .expect("request must assemble")
            .timeout()
            .copied()
    }

    #[test]
    fn missing_timeout_keeps_the_default_deadline() {
        assert_eq!(built_timeout(None), Some(Duration::from_secs(DEFAULT_TIMEOUT_SECS)));
    }

    #[test]
    fn zero_timeout_means_no_deadline() {
        assert_eq!(built_timeout(Some(0)), None);
    }

    #[test]
    fn explicit_timeout_is_applied_in_seconds() {
        assert_eq!(built_timeout(Some(600)), Some(Duration::from_secs(600)));
    }

    #[test]
    fn build_request_rejects_bad_method_and_headers() {
        let client = reqwest::Client::new();
        let cases: Vec<(&str, &str)> = vec![
            ("PATCH", "{}"),
            ("GET", "not json"),
            ("GET", "[1,2]"),
            ("GET", r#"{"bad name":"x"}"#),
            ("GET", "{\"X-A\":\"line\\nbreak\"}"),
        ];
        for (method, headers) in cases {
            let mut req = request("a", "http://127.0.0.1:9/".to_string());
            req.method = method.to_string();
            req.headers = headers.to_string();
            let message = build_request(&client, &req)
                .err()
                .unwrap_or_else(|| panic!("{} {} must fail", method, headers));
            let parsed = parse(&failure(&message));
            assert_eq!(parsed["success"], json!(false));
            assert!(parsed["body"].is_string());
        }
    }

    #[test]
    fn failure_text_has_cause_and_excludes_url() {
        let (port, join) = serve_once(|stream| drop(stream));
        let url = format!("http://127.0.0.1:{}/v1/path?key=SECRET", port);
        let registry = FetchRegistry::new();
        let (result, events) = run(&registry, request("f1", url));
        join.join().unwrap();
        let parsed = parse(&result);
        assert_eq!(parsed["success"], json!(false));
        let text = parsed["body"].as_str().unwrap();
        assert!(text.contains("error sending request"), "got: {}", text);
        assert!(text.contains(": "), "cause chain missing: {}", text);
        assert!(!text.contains("SECRET"), "URL leaked: {}", text);
        assert!(!text.contains("http://"), "URL leaked: {}", text);
        assert!(!text.contains("/v1/path"), "URL leaked: {}", text);
        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn mid_body_reset_emits_error_event_and_no_end() {
        let (port, join) = serve_once(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"partial");
            thread::sleep(Duration::from_millis(100));
            drop(stream);
        });
        let url = format!("http://127.0.0.1:{}/?key=SECRET", port);
        let registry = FetchRegistry::new();
        let (result, events) = run(&registry, request("e1", url));
        join.join().unwrap();
        assert_eq!(types(&events), vec!["headers", "chunk", "error"]);
        let events = events.lock().unwrap();
        let message = events[2]["body"].as_str().unwrap();
        assert!(!message.contains("SECRET"), "URL leaked: {}", message);
        let parsed = parse(&result);
        assert_eq!(parsed["success"], json!(false));
        assert_eq!(parsed["body"].as_str().unwrap(), message);
        assert_eq!(registry.live_len(), 0);
    }

    #[test]
    fn success_path_emits_headers_chunks_end() {
        let (port, join) = serve_once(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"hello ");
            write_chunk(&mut stream, b"world");
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let registry = FetchRegistry::new();
        let (result, events) = run(&registry, request("s1", format!("http://127.0.0.1:{}/", port)));
        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        let kinds = types(&events);
        assert_eq!(kinds.first().map(String::as_str), Some("headers"));
        assert_eq!(kinds.last().map(String::as_str), Some("end"));
        let events = events.lock().unwrap();
        assert_eq!(events[0]["status"], json!(200));
        let mut body = Vec::new();
        for event in events.iter().filter(|e| e["type"] == json!("chunk")) {
            body.extend(
                general_purpose::STANDARD
                    .decode(event["body"].as_str().unwrap())
                    .unwrap(),
            );
        }
        assert_eq!(body, b"hello world");
        assert!(events.iter().all(|e| e["id"] == json!("s1")));
        assert_eq!(registry.live_len(), 0);
    }

    #[test]
    fn emit_failure_yields_failure_result_without_panic() {
        let (port, join) = serve_once(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"x");
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let registry = FetchRegistry::new();
        let req = request("m1", format!("http://127.0.0.1:{}/", port));
        let result = tauri::async_runtime::block_on(run_registered(&registry, req, |_| {
            Err("sink closed".to_string())
        }));
        join.join().unwrap();
        let parsed = parse(&result);
        assert_eq!(parsed["success"], json!(false));
        assert_eq!(parsed["body"], json!("sink closed"));
        assert_eq!(registry.live_len(), 0);
    }

    #[test]
    fn abort_closes_socket_and_removes_registry_entry() {
        let closed = Arc::new(AtomicBool::new(false));
        let closed_by_server = closed.clone();
        let (port, join) = serve_once(move |mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"first");
            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
            let mut byte = [0u8; 1];
            // EOF or a reset means the client dropped the connection.
            if matches!(stream.read(&mut byte), Ok(0) | Err(_)) {
                closed_by_server.store(true, Ordering::SeqCst);
            }
        });
        let registry = FetchRegistry::new();
        let (first_chunk_tx, first_chunk_rx) = mpsc::channel::<()>();
        let first_chunk_tx = Mutex::new(first_chunk_tx);
        let (result_tx, result_rx) = mpsc::channel::<String>();
        let task_registry = registry.clone();
        let req = request("c1", format!("http://127.0.0.1:{}/", port));
        tauri::async_runtime::spawn(async move {
            let emit = move |payload: String| {
                if payload.contains("\"chunk\"") {
                    let _ = first_chunk_tx.lock().unwrap().send(());
                }
                Ok(())
            };
            let result = run_registered(&task_registry, req, emit).await;
            let _ = result_tx.send(result);
        });
        first_chunk_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("stream never started");
        registry.cancel("c1");
        let result = result_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("aborted fetch did not return");
        assert_eq!(parse(&result), json!({ "success": true, "cancelled": true }));
        let deadline = Instant::now() + Duration::from_secs(5);
        while !closed.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(closed.load(Ordering::SeqCst), "server never saw the socket close");
        assert_eq!(registry.live_len(), 0);
        join.join().unwrap();
    }

    #[test]
    fn cancel_before_register_aborts_without_a_request() {
        let (listener, port) = bind_stub();
        listener.set_nonblocking(true).unwrap();
        let registry = FetchRegistry::new();
        registry.cancel("early");
        let mut req = request("early", format!("http://127.0.0.1:{}/", port));
        req.timeout_secs = Some(1);
        let (result, events) = run(&registry, req);
        assert_eq!(parse(&result), json!({ "success": true, "cancelled": true }));
        assert!(events.lock().unwrap().is_empty());
        assert!(listener.accept().is_err(), "a request reached the server");
        assert_eq!(registry.live_len(), 0);
        assert_eq!(registry.tombstone_len(), 0);
    }

    #[test]
    fn cancel_after_finish_is_a_noop_for_the_finished_request() {
        let (port, join) = serve_once(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"x");
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let registry = FetchRegistry::new();
        let (result, _events) = run(&registry, request("done", format!("http://127.0.0.1:{}/", port)));
        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(registry.live_len(), 0);
        registry.cancel("done");
        assert_eq!(registry.live_len(), 0);
        assert!(registry.tombstone_len() <= 1);
    }

    #[test]
    fn cancel_of_a_live_entry_aborts_and_removes_it() {
        let registry = FetchRegistry::new();
        let (guard, abort_registration) = match registry.register("live") {
            Registration::Live(guard, abort_registration) => (guard, abort_registration),
            Registration::AlreadyCancelled => panic!("unexpected tombstone"),
        };
        assert_eq!(registry.live_len(), 1);
        registry.cancel("live");
        assert_eq!(registry.live_len(), 0);
        assert_eq!(registry.tombstone_len(), 0);
        let outcome = futures::executor::block_on(Abortable::new(
            futures::future::pending::<()>(),
            abort_registration,
        ));
        assert!(outcome.is_err());
        drop(guard);
    }

    #[test]
    fn tombstone_expires_after_ttl() {
        let registry = FetchRegistry::new();
        let base = Instant::now();
        registry.cancel_at("t", base);
        assert_eq!(registry.tombstone_len(), 1);
        let just_before = base + TOMBSTONE_TTL - Duration::from_millis(1);
        registry.cancel_at("other", just_before);
        assert_eq!(registry.tombstone_len(), 2);
        let after = base + TOMBSTONE_TTL + Duration::from_millis(1);
        match registry.register_at("t", after) {
            Registration::Live(_guard, _) => {}
            Registration::AlreadyCancelled => panic!("expired tombstone was honoured"),
        }
        assert_eq!(registry.tombstone_len(), 1);
        assert!(TOMBSTONE_TTL <= Duration::from_secs(10));
    }

    #[test]
    fn tombstone_cap_evicts_oldest() {
        let registry = FetchRegistry::new();
        let base = Instant::now();
        for i in 0..(TOMBSTONE_CAP + 6) {
            registry.cancel_at(&format!("id{}", i), base + Duration::from_millis(i as u64));
        }
        assert_eq!(registry.tombstone_len(), TOMBSTONE_CAP);
        let now = base + Duration::from_millis(100);
        match registry.register_at("id0", now) {
            Registration::Live(_guard, _) => {}
            Registration::AlreadyCancelled => panic!("oldest tombstone should be evicted"),
        }
        match registry.register_at(&format!("id{}", TOMBSTONE_CAP + 5), now) {
            Registration::AlreadyCancelled => {}
            Registration::Live(..) => panic!("newest tombstone should remain"),
        }
    }

    #[test]
    fn registration_after_cancel_consumes_the_tombstone_once() {
        let registry = FetchRegistry::new();
        let now = Instant::now();
        registry.cancel_at("once", now);
        assert!(matches!(
            registry.register_at("once", now),
            Registration::AlreadyCancelled
        ));
        assert!(matches!(
            registry.register_at("once", now),
            Registration::Live(..)
        ));
    }

    /// Accepts one connection, or gives up so that a refused request cannot
    /// leave the stub thread blocked forever.
    fn accept_within(listener: &TcpListener, wait: Duration) -> Option<TcpStream> {
        listener.set_nonblocking(true).ok()?;
        let deadline = Instant::now() + wait;
        while Instant::now() < deadline {
            if let Ok((stream, _)) = listener.accept() {
                let _ = stream.set_nonblocking(false);
                return Some(stream);
            }
            thread::sleep(Duration::from_millis(20));
        }
        None
    }

    fn serve_bounded<H>(handler: H) -> (u16, thread::JoinHandle<()>)
    where
        H: FnOnce(TcpStream) + Send + 'static,
    {
        let (listener, port) = bind_stub();
        let join = thread::spawn(move || {
            if let Some(mut stream) = accept_within(&listener, Duration::from_secs(5)) {
                read_request(&mut stream);
                handler(stream);
            }
        });
        (port, join)
    }

    fn with_policy(allow_private: bool, mut req: FetchRequest) -> FetchRequest {
        req.policy = Some(NetPolicy { allow_private });
        req
    }

    fn names_lookup() -> Lookup {
        Arc::new(|host: &str, port: u16| match host {
            "private.test" => Ok(vec![SocketAddr::new(
                IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
                port,
            )]),
            "loop.test" => Ok(vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)]),
            _ => Err(io::Error::new(io::ErrorKind::NotFound, "unknown test host")),
        })
    }

    fn run_with_lookup(req: FetchRequest, lookup: Lookup) -> (String, Events) {
        let (events, emit) = collector();
        let result = tauri::async_runtime::block_on(run_fetch_with(&req, &emit, lookup));
        (result, events)
    }

    fn blocked_body(result: &str) -> String {
        let parsed = parse(result);
        assert_eq!(parsed["success"], json!(false), "got: {}", result);
        let text = parsed["body"].as_str().unwrap().to_string();
        assert!(text.contains("NATIVE_DESTINATION_BLOCKED (private)"), "got: {}", text);
        text
    }

    fn write_redirect(stream: &mut TcpStream, location: &str) {
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                location
            )
            .as_bytes(),
        );
    }

    #[test]
    fn private_literal_is_refused_before_connecting() {
        let started = Instant::now();
        let req = with_policy(false, request("p1", "http://10.255.255.1:9/".to_string()));
        let (result, events) = run_with_lookup(req, names_lookup());
        let text = blocked_body(&result);
        assert!(text.contains("10.255.255.1"), "got: {}", text);
        assert!(started.elapsed() < Duration::from_secs(2), "the request waited on a connect");
        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn private_literal_is_allowed_with_the_toggle() {
        let req = with_policy(true, request("p2", "http://127.0.0.1:9/".to_string()));
        let (result, _) = run_with_lookup(req, names_lookup());
        // Loopback is allowed; the connection itself fails on the closed port.
        let parsed = parse(&result);
        assert!(!parsed["body"].as_str().unwrap_or("").contains("NATIVE_DESTINATION_BLOCKED"));
    }

    #[test]
    fn redirect_to_a_private_literal_is_refused() {
        let (port, join) =
            serve_bounded(|mut stream| write_redirect(&mut stream, "http://10.0.0.1/"));
        let req = with_policy(false, request("r3", format!("http://127.0.0.1:{}/", port)));
        let (result, events) = run_with_lookup(req, names_lookup());
        join.join().unwrap();
        blocked_body(&result);
        assert!(events.lock().unwrap().is_empty());
    }

    #[test]
    fn redirect_to_loopback_is_followed() {
        let (listener, port) = bind_stub();
        let join = thread::spawn(move || {
            for hop in 0..2 {
                let Some(mut stream) = accept_within(&listener, Duration::from_secs(5)) else {
                    return;
                };
                read_request(&mut stream);
                if hop == 0 {
                    write_redirect(&mut stream, "/ok");
                } else {
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    );
                }
            }
        });
        let req = with_policy(false, request("r4", format!("http://127.0.0.1:{}/", port)));
        let (result, events) = run_with_lookup(req, names_lookup());
        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(events.lock().unwrap()[0]["status"], json!(200));
    }

    #[test]
    fn private_name_is_refused_without_a_connection() {
        let (listener, port) = bind_stub();
        listener.set_nonblocking(true).unwrap();
        let req = with_policy(false, request("n1", format!("http://private.test:{}/", port)));
        let (result, events) = run_with_lookup(req, names_lookup());
        let text = blocked_body(&result);
        assert!(!text.contains("http://"), "URL leaked: {}", text);
        assert!(events.lock().unwrap().is_empty());
        assert!(listener.accept().is_err(), "the stub saw a connection");
    }

    #[test]
    fn checked_loopback_address_is_the_one_dialled() {
        let (port, join) = serve_bounded(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"hi");
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let req = with_policy(false, request("n2", format!("http://loop.test:{}/", port)));
        let (result, events) = run_with_lookup(req, names_lookup());
        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(types(&events).first().map(String::as_str), Some("headers"));
    }

    #[test]
    fn redirect_to_a_private_name_is_refused() {
        let (port, join) = serve_bounded(move |mut stream| {
            let own_port = port_of(&stream);
            write_redirect(&mut stream, &format!("http://private.test:{}/x", own_port));
        });
        let req = with_policy(false, request("n3", format!("http://loop.test:{}/", port)));
        let (result, _) = run_with_lookup(req, names_lookup());
        join.join().unwrap();
        blocked_body(&result);
    }

    fn port_of(stream: &TcpStream) -> u16 {
        stream.local_addr().unwrap().port()
    }

    #[test]
    fn no_policy_client_is_unrestricted_by_the_lookup() {
        let (port, join) = serve_bounded(|mut stream| {
            write_head(&mut stream);
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let refusing: Lookup = Arc::new(|_: &str, _: u16| {
            Err(io::Error::new(io::ErrorKind::Other, "must not be consulted"))
        });
        let req = request("u1", format!("http://127.0.0.1:{}/", port));
        let (result, _) = run_with_lookup(req, refusing);
        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
    }

    #[test]
    fn guard_removes_only_its_own_registration() {
        let registry = FetchRegistry::new();
        let first = registry.register("reuse");
        assert_eq!(registry.live_len(), 1);
        let second = registry.register("reuse");
        assert_eq!(registry.live_len(), 1);
        drop(first);
        assert_eq!(registry.live_len(), 1, "stale guard removed the newer entry");
        drop(second);
        assert_eq!(registry.live_len(), 0);
    }
}
