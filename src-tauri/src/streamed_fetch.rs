// Native streaming fetch behind the `streamed_fetch` command.
//
// Invariants:
// - Every result string is valid JSON and no request or IO path can panic.
// - Error text never contains a URL or header value.
// - After the response head has been emitted, the terminal event is `error` or
//   `end`, never both; the first terminal signal wins.
// - A cancelled request drops its reqwest future, which closes the socket.
// - A live id never starts a second request; its original abort handle stays registered.
// - Without a requested total limit, only a gap in native activity ends a request.

use base64::{engine::general_purpose, Engine as _};
use crate::net_policy::{
    blocked_message, literal_refusal, system_lookup, CheckedResolver, Lookup, NetPolicy,
};
use crate::reply_notice::{process_notices, NoticeLink, Visibility, CODE_QUIET};
use futures::future::{AbortHandle, AbortRegistration, Abortable};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::error::Error as StdError;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

pub const TOMBSTONE_CAP: usize = 64;
pub const TOMBSTONE_TTL: Duration = Duration::from_secs(10);
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_REDIRECTS: usize = 10;

/// The chat a request belongs to, as the keep-alive notice names it: the
/// owner's id (a group by its own id) and the chat's id. It is carried so a
/// later native count can be matched to the notice (MC-1452). The chat's Stop
/// does not filter by it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatTarget {
    pub cha_id: String,
    pub chat_id: String,
}

/// The page's marks on a request. `chat_stop` means the chat's Stop aborts the
/// request, so a native cancel may end it while the page is frozen (MC-1435).
/// The struct grows with further marks; they can overlap `chat_stop`, which is
/// why it is not an enum. Native reply ownership (MC-1451) is not a tag: it
/// rides on `FetchRequest::owner`, and no cancel path reads it. `chat_target`
/// never decides a cancel.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StreamTags {
    pub chat_stop: bool,
    pub chat_target: Option<ChatTarget>,
}

/// Maps the `streamed_fetch` command's optional arguments to the request's tags.
pub fn stream_tags(chat_stop: Option<bool>, chat_target: Option<ChatTarget>) -> StreamTags {
    StreamTags {
        chat_stop: chat_stop.unwrap_or(false),
        chat_target,
    }
}

struct LiveEntry {
    serial: u64,
    handle: AbortHandle,
    // Read only by the Android keep-alive Stop (`cancel_chat`) and the tests; every
    // target still stores it so a registration keeps its marks.
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    tags: StreamTags,
}

struct RegistryState {
    next_serial: u64,
    live: HashMap<String, LiveEntry>,
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
    Duplicate,
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
        let owned = matches!(state.live.get(&self.id), Some(entry) if entry.serial == self.serial);
        if owned {
            state.live.remove(&self.id);
        }
    }
}

impl FetchRegistry {
    fn new() -> Self {
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

    // The untagged forms are the registry's plain API; the request path registers tagged.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn register(&self, id: &str) -> Registration {
        self.register_at(id, Instant::now())
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn register_at(&self, id: &str, now: Instant) -> Registration {
        self.register_tagged_at(id, StreamTags::default(), now)
    }

    pub fn register_tagged(&self, id: &str, tags: StreamTags) -> Registration {
        self.register_tagged_at(id, tags, Instant::now())
    }

    pub fn register_tagged_at(&self, id: &str, tags: StreamTags, now: Instant) -> Registration {
        let mut state = self.lock();
        Self::purge(&mut state, now);
        if state.tombstones.remove(id).is_some() {
            return Registration::AlreadyCancelled;
        }
        // A live id has one request and keeps its abort handle until it ends or is cancelled.
        if state.live.contains_key(id) {
            return Registration::Duplicate;
        }
        state.next_serial += 1;
        let serial = state.next_serial;
        let (handle, registration) = AbortHandle::new_pair();
        state.live.insert(id.to_string(), LiveEntry { serial, handle, tags });
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

    /// Aborts entries live at this instant; drained ids may register again.
    pub fn cancel_all(&self) {
        let mut state = self.lock();
        for (_, entry) in state.live.drain() {
            entry.handle.abort();
        }
    }

    /// Aborts every live entry the page marked `chat_stop` and returns how many.
    /// It selects on `chat_stop` alone, whatever the entry's target (the tagged
    /// set is a subset of what the page Stop also aborts). It writes no
    /// tombstone and only aborts handles: a cancelled request ends in
    /// `run_registered`'s aborted branch, which owns the request and its tags.
    #[cfg(any(target_os = "android", test))]
    pub fn cancel_chat(&self) -> usize {
        let mut state = self.lock();
        let ids: Vec<String> = state
            .live
            .iter()
            .filter(|(_, entry)| entry.tags.chat_stop)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            if let Some(entry) = state.live.remove(id) {
                entry.handle.abort();
            }
        }
        ids.len()
    }

    pub fn cancel_at(&self, id: &str, now: Instant) {
        let mut state = self.lock();
        Self::purge(&mut state, now);
        if let Some(entry) = state.live.remove(id) {
            entry.handle.abort();
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
    fn live_tags(&self, id: &str) -> Option<StreamTags> {
        self.lock().live.get(id).map(|entry| entry.tags.clone())
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
    pub tags: StreamTags,
    /// `Some` when the page asked the request to be owned by the native reply
    /// store. `None` keeps the request byte-identical to a page-owned one.
    pub owner: Option<OwnedReply>,
}

/// The most response body an owned request keeps for its record.
pub const MAX_REPLY_BODY_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplyOutcome {
    Done,
    Failed,
    Stopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReplyDetail {
    Transport,
    BodyNotStored,
    BodyTooLarge,
}

/// The terminal data of an owned request, as its end record stores it.
#[derive(Clone, Debug)]
pub struct ReplyEnd {
    pub outcome: ReplyOutcome,
    pub status: Option<u16>,
    pub body_bytes: Option<u64>,
    pub detail: Option<ReplyDetail>,
    pub error: Option<String>,
    /// The app's visibility as the host last said, read when the end was decided.
    pub visibility: Visibility,
    /// A native notice announces this end; the record then says so.
    pub announced: bool,
}

/// The open record of an owned request. Dropping it ends the record's live
/// membership, so the request's slot drops it only after the last write.
pub trait OpenRecord: Send {
    fn write_body(&mut self, bytes: &[u8]) -> Result<(), String>;
    fn write_end(&mut self, end: &ReplyEnd) -> Result<(), String>;
}

/// Opens the record of a request that has not been sent. `Err` is the reason
/// ownership is refused (`invalid-key`, `exists`, `blob-too-large`, `store`).
pub trait ReplyJournal: Send + Sync {
    fn open(&self, key: &str, page_version: u32, blob: &str) -> Result<Box<dyn OpenRecord>, &'static str>;
}

/// What the page asked this request to own. This module never touches the disk:
/// the journal does. A missing journal means the store could not be resolved.
pub struct OwnedReply {
    pub key: String,
    pub page_version: u32,
    pub blob: String,
    pub journal: Option<Arc<dyn ReplyJournal>>,
    /// The request's hold on its notice token; dropping it ends the token.
    pub notice: Option<NoticeLink>,
}

impl OwnedReply {
    /// The visibility to record for an end no token decided.
    fn visibility(&self) -> Visibility {
        match self.notice.as_ref() {
            Some(link) => link.visibility(),
            None => process_notices().visibility(),
        }
    }
}

/// The record of one owned request. `run_registered` creates the slot before the
/// abortable future, so the record (and its live membership) outlives that
/// future when an abort drops it, and the abort arm can still write the end.
struct RecordSlot {
    record: Option<Box<dyn OpenRecord>>,
    ended: bool,
}

type SharedSlot = Arc<Mutex<RecordSlot>>;

fn lock_slot(slot: &SharedSlot) -> MutexGuard<'_, RecordSlot> {
    slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl RecordSlot {
    fn write_body(&mut self, bytes: &[u8]) -> Result<(), String> {
        match self.record.as_mut() {
            Some(record) => record.write_body(bytes),
            None => Err("no open record".to_string()),
        }
    }

    /// The first end wins: `None` when the slot has no record or already ended.
    fn write_end(&mut self, end: &ReplyEnd) -> Option<Result<(), String>> {
        if self.ended {
            return None;
        }
        let record = self.record.as_mut()?;
        self.ended = true;
        Some(record.write_end(end))
    }
}

/// Appends `chunk` unless the body already overflowed `cap`; an overflow drops
/// what was kept, so an oversize body is never stored.
fn accumulate(body: &mut Vec<u8>, overflow: &mut bool, chunk: &[u8], cap: usize) {
    if *overflow {
        return;
    }
    if body.len() + chunk.len() > cap {
        *overflow = true;
        *body = Vec::new();
    } else {
        body.extend_from_slice(chunk);
    }
}

/// `{key, outcome, stored}`: `stored` is true only when the reply's body can be
/// read back from the record (an end record of `done` that was written).
fn reply_stamp(key: &str, outcome: ReplyOutcome, stored: bool) -> Value {
    json!({ "key": key, "outcome": outcome, "stored": stored })
}

/// The stamp of an end a native notice announced: the same fields plus
/// `announced` and the HTTP status the page needs to judge finality. It exists
/// only for an announced end, so every other stamp keeps its bytes.
fn announced_stamp(key: &str, outcome: ReplyOutcome, stored: bool, status: Option<u16>) -> Value {
    let mut stamp = reply_stamp(key, outcome, stored);
    stamp["announced"] = json!(true);
    if let Some(status) = status {
        stamp["status"] = json!(status);
    }
    stamp
}

fn log_unwritten(what: &str, result: &Option<Result<(), String>>) {
    if let Some(Err(message)) = result {
        eprintln!("native reply {} was not stored: {}", what, message);
    }
}

/// The owned request's side of the tee: it keeps the body and writes the end.
struct ReplyTee<'a> {
    slot: &'a SharedSlot,
    key: &'a str,
    notice: Option<&'a NoticeLink>,
    body: Vec<u8>,
    overflow: bool,
    status: Option<u16>,
}

impl ReplyTee<'_> {
    /// The terminal step: decide the notice, write the end (the decision's
    /// `announced` and the visibility read with it), then publish the code. The
    /// hub lock is not held while the end is written, and a code is published
    /// only after the end is durable; an end that was not written publishes
    /// quiet and its stamp does not say `announced`.
    fn finish(&self, outcome: ReplyOutcome, detail: Option<ReplyDetail>, body_bytes: Option<u64>, error: Option<String>) -> Value {
        let decision = match self.notice {
            Some(link) => link.decide(outcome, detail, self.status, outcome == ReplyOutcome::Done),
            None => crate::reply_notice::Decision { code: CODE_QUIET, visibility: process_notices().visibility() },
        };
        let end = ReplyEnd {
            outcome,
            status: self.status,
            body_bytes,
            detail,
            error,
            visibility: decision.visibility,
            announced: decision.announced(),
        };
        let written = lock_slot(self.slot).write_end(&end);
        log_unwritten("end", &written);
        let durable = matches!(written, Some(Ok(())));
        if let Some(link) = self.notice {
            link.publish(if durable { decision.code } else { CODE_QUIET });
        }
        let stored = outcome == ReplyOutcome::Done && durable;
        if durable && decision.announced() {
            announced_stamp(self.key, outcome, stored, self.status)
        } else {
            reply_stamp(self.key, outcome, stored)
        }
    }

    fn end_failed(&self, detail: ReplyDetail, error: Option<String>) -> Value {
        self.finish(ReplyOutcome::Failed, Some(detail), None, error)
    }

    /// The body, then the end. A body that overflowed or did not reach the disk
    /// ends the record `failed`, never `done`.
    fn end_done(&self) -> Value {
        if self.overflow {
            return self.end_failed(ReplyDetail::BodyTooLarge, None);
        }
        let body = Some(lock_slot(self.slot).write_body(&self.body));
        log_unwritten("body", &body);
        if matches!(body, Some(Err(_))) {
            return self.end_failed(ReplyDetail::BodyNotStored, None);
        }
        self.finish(ReplyOutcome::Done, None, Some(self.body.len() as u64), None)
    }
}

/// The ownership decision, made after the request is built and before it is
/// sent: refuse for a policy-carrying call (the page owns plugin and untrusted
/// requests), an unresolved store or an open failure; otherwise the record is
/// opened and placed in the slot. The page is told either way with an `owner`
/// event; a refused request then runs exactly as an unowned one.
fn open_owned<'a, F>(
    request: &'a FetchRequest,
    owner: &'a OwnedReply,
    slot: &'a SharedSlot,
    emit: &F,
) -> Option<ReplyTee<'a>>
where
    F: Fn(String) -> Result<(), String>,
{
    let refusal: Option<&'static str> = if request.policy.is_some() {
        Some("policy")
    } else {
        match owner.journal.as_ref() {
            None => Some("store"),
            Some(journal) => match journal.open(&owner.key, owner.page_version, &owner.blob) {
                Ok(record) => {
                    lock_slot(slot).record = Some(record);
                    None
                }
                Err(reason) => Some(reason),
            },
        }
    };
    let event = match refusal {
        None => json!({ "type": "owner", "id": request.id, "key": owner.key, "owned": true }),
        Some(reason) => json!({ "type": "owner", "id": request.id, "key": owner.key, "owned": false, "reason": reason }),
    };
    // The answer is advisory; a dead sink fails the next emit as it would today.
    let _ = emit(event.to_string());
    if refusal.is_some() {
        // An unowned run has no end to announce; its token ends now rather than
        // polling as pending for the whole request.
        if let Some(link) = owner.notice.as_ref() {
            link.publish(CODE_QUIET);
        }
        return None;
    }
    Some(ReplyTee { slot, key: &owner.key, notice: owner.notice.as_ref(), body: Vec::new(), overflow: false, status: None })
}

/// The abort arm's end for an owned request: `stopped`, only when the slot holds
/// a record that has no end yet, followed by the keyed `stopped` event. A stop is
/// never announced; its token ends quiet when the request's link drops.
fn stop_owned<F>(slot: &SharedSlot, owner: &OwnedReply, id: &str, emit: &F)
where
    F: Fn(String) -> Result<(), String>,
{
    let end = ReplyEnd {
        outcome: ReplyOutcome::Stopped,
        status: None,
        body_bytes: None,
        detail: None,
        error: None,
        visibility: owner.visibility(),
        announced: false,
    };
    let written = lock_slot(slot).write_end(&end);
    if written.is_none() {
        return;
    }
    log_unwritten("end", &written);
    let event = json!({ "type": "stopped", "id": id, "reply": reply_stamp(&owner.key, ReplyOutcome::Stopped, false) });
    let _ = emit(event.to_string());
}

fn failure(message: &str) -> String {
    json!({ "success": false, "body": message }).to_string()
}

/// An owned request's failure result: it carries the same stamp as the `error`
/// event, so the page learns the end (and `announced`) from either one.
fn failure_with(message: &str, stamp: &Value) -> String {
    json!({ "success": false, "body": message, "reply": stamp }).to_string()
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
    // Zero and an absent value have no total limit; only absence arms the idle limit.
    Ok(match request.timeout_secs {
        Some(0) => builder,
        Some(secs) => builder.timeout(Duration::from_secs(secs)),
        None => builder,
    })
}

fn idle_for(timeout_secs: Option<u64>, idle: Duration) -> Option<Duration> {
    if timeout_secs.is_none() { Some(idle) } else { None }
}

fn idle_message(is_timeout: bool, since_activity: Duration, idle: Option<Duration>) -> Option<String> {
    idle.filter(|limit| is_timeout && since_activity >= *limit)
        .map(|limit| format!("No data received for {} seconds", limit.as_secs()))
}

fn decode_body(body: &str) -> Result<Vec<u8>, String> {
    general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|e| e.to_string())
}

/// With a policy the client ignores system proxies (a proxy would resolve and
/// dial on its own), resolves names through the checking resolver and refuses
/// redirects to disallowed IP literals; without one it is the plain client.
fn build_client(policy: Option<&NetPolicy>, lookup: Lookup, idle: Option<Duration>) -> reqwest::Result<reqwest::Client> {
    let with_idle = |builder: reqwest::ClientBuilder| match idle {
        Some(duration) => builder.read_timeout(duration),
        None => builder,
    };
    let Some(policy) = policy.copied() else {
        return with_idle(reqwest::Client::builder()).build();
    };
    with_idle(reqwest::Client::builder())
        .no_proxy()
        .dns_resolver(Arc::new(CheckedResolver { policy, lookup }))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > MAX_REDIRECTS {
                return attempt.error("too many redirects");
            }
            if let Some(host) = literal_refusal(attempt.url(), &policy) {
                return attempt.error(blocked_message(&host));
            }
            attempt.follow()
        }))
        .build()
}

async fn run_fetch<F>(request: &FetchRequest, emit: &F, slot: Option<&SharedSlot>) -> String
where
    F: Fn(String) -> Result<(), String>,
{
    run_fetch_slotted(request, emit, system_lookup(), IDLE_TIMEOUT, slot).await
}

#[cfg(test)]
async fn run_fetch_with<F>(request: &FetchRequest, emit: &F, lookup: Lookup, idle: Duration) -> String
where
    F: Fn(String) -> Result<(), String>,
{
    run_fetch_slotted(request, emit, lookup, idle, None).await
}

/// Without an owner (or without a slot) nothing below touches the record and
/// every event and result is today's. With one, the ticket is durable before
/// the first request byte, emit errors are ignored (the reply no longer depends
/// on the page), the body is kept, and the end record is written before the
/// terminal event.
async fn run_fetch_slotted<F>(
    request: &FetchRequest,
    emit: &F,
    lookup: Lookup,
    idle: Duration,
    slot: Option<&SharedSlot>,
) -> String
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
    let idle = idle_for(request.timeout_secs, idle);
    let client = match build_client(request.policy.as_ref(), lookup, idle) {
        Ok(client) => client,
        Err(e) => return failure(&error_text(e)),
    };
    let builder = match build_request(&client, request) {
        Ok(builder) => builder,
        Err(message) => return failure(&message),
    };
    let mut tee = match (request.owner.as_ref(), slot) {
        (Some(owner), Some(slot)) => open_owned(request, owner, slot, emit),
        _ => None,
    };
    let mut last_activity = Instant::now();
    let mut response = match builder.send().await {
        Ok(response) => response,
        Err(e) => {
            let message = idle_message(e.is_timeout(), last_activity.elapsed(), idle)
                .unwrap_or_else(|| error_text(e));
            if let Some(tee) = tee.as_ref() {
                let stamp = tee.end_failed(ReplyDetail::Transport, Some(message.clone()));
                return failure_with(&message, &stamp);
            }
            return failure(&message);
        }
    };
    last_activity = Instant::now();

    let status = response.status().as_u16();
    if let Some(tee) = tee.as_mut() {
        tee.status = Some(status);
    }
    let head = json!({
        "type": "headers",
        "body": header_map_to_json(response.headers()),
        "id": request.id,
        "status": status,
    });
    if let Err(message) = emit(head.to_string()) {
        if tee.is_none() {
            return failure(&message);
        }
    }

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                last_activity = Instant::now();
                if let Some(tee) = tee.as_mut() {
                    accumulate(&mut tee.body, &mut tee.overflow, &chunk, MAX_REPLY_BODY_BYTES);
                }
                let event = json!({
                    "type": "chunk",
                    "body": general_purpose::STANDARD.encode(chunk),
                    "id": request.id,
                });
                if let Err(message) = emit(event.to_string()) {
                    if tee.is_none() {
                        return failure(&message);
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                let message = idle_message(e.is_timeout(), last_activity.elapsed(), idle)
                    .unwrap_or_else(|| error_text(e));
                let mut event = json!({ "type": "error", "body": message, "id": request.id });
                let mut stamp = None;
                if let Some(tee) = tee.as_ref() {
                    let made = tee.end_failed(ReplyDetail::Transport, Some(message.clone()));
                    event["reply"] = made.clone();
                    stamp = Some(made);
                }
                // The failure result below carries the same text and stamp if this emit fails.
                let _ = emit(event.to_string());
                return match stamp {
                    Some(stamp) => failure_with(&message, &stamp),
                    None => failure(&message),
                };
            }
        }
    }

    let mut end = json!({ "type": "end", "id": request.id });
    if let Some(tee) = tee.as_ref() {
        end["reply"] = tee.end_done();
    }
    if let Err(message) = emit(end.to_string()) {
        if tee.is_none() {
            return failure(&message);
        }
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
    let (_guard, abort_registration) =
        match registry.register_tagged(&request.id, request.tags.clone()) {
            Registration::AlreadyCancelled => return cancelled(),
            Registration::Duplicate => return cancelled(),
            Registration::Live(guard, abort_registration) => (guard, abort_registration),
        };
    // The slot is created here, outside the abortable future: an abort drops
    // that future, and the record with its live membership must survive until
    // the abort arm has written its end.
    let slot: Option<SharedSlot> = request
        .owner
        .as_ref()
        .map(|_| Arc::new(Mutex::new(RecordSlot { record: None, ended: false })));
    match Abortable::new(run_fetch(&request, &emit, slot.as_ref()), abort_registration).await {
        Ok(result) => result,
        // The one place every abort of a LIVE registration ends (`cancel_chat`,
        // `cancel_all`, and `cancel` of a registered id): a later terminal
        // record for a cancelled request belongs here, where the request and
        // its tags are still owned. A cancel that arrives before registration
        // ends in the `AlreadyCancelled` arm instead. An owned request that had
        // opened its record gets its `stopped` end here; one that had not
        // gives only the `cancelled` result.
        Err(_) => {
            if let (Some(owner), Some(slot)) = (request.owner.as_ref(), slot.as_ref()) {
                stop_owned(slot, owner, &request.id, &emit);
            }
            cancelled()
        }
    }
}

static PROCESS_REGISTRY: OnceLock<FetchRegistry> = OnceLock::new();

/// The process-wide registry the app manages and the Android keep-alive Stop
/// reaches through JNI. Clones share one state.
pub fn process_registry() -> FetchRegistry {
    PROCESS_REGISTRY.get_or_init(FetchRegistry::new).clone()
}

/// Cancels the chat's tagged requests in the process registry. It returns 0
/// when the registry was never created, so it never creates one.
#[cfg(any(target_os = "android", test))]
pub fn cancel_process_chat_streams() -> usize {
    match PROCESS_REGISTRY.get() {
        Some(registry) => registry.cancel_chat(),
        None => 0,
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
        for port in 6330..=6399u16 {
            if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
                return (listener, port);
            }
        }
        panic!("no free port in 6330-6399");
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
            tags: StreamTags::default(),
            owner: None,
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
    fn missing_timeout_sets_no_total_deadline() {
        assert_eq!(built_timeout(None), None);
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
            Registration::Duplicate => panic!("unexpected duplicate"),
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
            Registration::Duplicate => panic!("expired tombstone id was live"),
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
            Registration::Duplicate => panic!("evicted tombstone id was live"),
        }
        match registry.register_at(&format!("id{}", TOMBSTONE_CAP + 5), now) {
            Registration::AlreadyCancelled => {}
            Registration::Live(..) | Registration::Duplicate => panic!("newest tombstone should remain"),
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
        let result = tauri::async_runtime::block_on(run_fetch_with(&req, &emit, lookup, IDLE_TIMEOUT));
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
    fn loopback_literal_passes_the_literal_check() {
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

    // Serves one redirect per connection for the first `redirects` connections
    // and a 200 afterwards; always accepts exactly MAX_REDIRECTS + 1 connections.
    fn run_redirect_chain(redirects: usize) -> String {
        let (listener, port) = bind_stub();
        let join = thread::spawn(move || {
            for hop in 0..=MAX_REDIRECTS {
                let Some(mut stream) = accept_within(&listener, Duration::from_secs(5)) else {
                    return;
                };
                read_request(&mut stream);
                if hop < redirects {
                    write_redirect(&mut stream, "/next");
                } else {
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    );
                }
            }
        });
        let req = with_policy(false, request("r5", format!("http://127.0.0.1:{}/", port)));
        let (result, _) = run_with_lookup(req, names_lookup());
        join.join().unwrap();
        result
    }

    #[test]
    fn the_tenth_redirect_is_followed() {
        let result = run_redirect_chain(MAX_REDIRECTS);
        assert_eq!(parse(&result), json!({ "success": true }), "got: {}", result);
    }

    #[test]
    fn the_eleventh_redirect_is_refused() {
        let result = run_redirect_chain(MAX_REDIRECTS + 1);
        assert_eq!(parse(&result)["success"], json!(false), "got: {}", result);
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
        assert!(matches!(&first, Registration::Live(..)));
        assert_eq!(registry.live_len(), 1);
        let second = registry.register("reuse");
        assert!(matches!(&second, Registration::Duplicate));
        assert_eq!(registry.live_len(), 1);
        drop(second);
        assert_eq!(registry.live_len(), 1);
        drop(first);
        assert_eq!(registry.live_len(), 0);
        let after = registry.register("reuse");
        assert!(matches!(&after, Registration::Live(..)));
        drop(after);

        let first = registry.register("again");
        assert!(matches!(&first, Registration::Live(..)));
        registry.cancel("again");
        assert_eq!(registry.live_len(), 0);
        assert_eq!(registry.tombstone_len(), 0);
        let second = registry.register("again");
        assert!(matches!(&second, Registration::Live(..)));
        drop(first);
        assert_eq!(registry.live_len(), 1, "stale guard removed the newer entry");
        drop(second);
        assert_eq!(registry.live_len(), 0);
    }

    #[test]
    fn idle_for_table() {
        let idle = Duration::from_secs(1);
        assert_eq!(idle_for(None, idle), Some(idle));
        assert_eq!(idle_for(Some(0), idle), None);
        assert_eq!(idle_for(Some(10), idle), None);
    }

    #[test]
    fn idle_message_table() {
        let idle = Duration::from_secs(1);
        assert_eq!(idle_message(true, idle, Some(idle)).as_deref(), Some("No data received for 1 seconds"));
        assert_eq!(idle_message(true, idle - Duration::from_millis(1), Some(idle)), None);
        assert_eq!(idle_message(true, idle, None), None);
        assert_eq!(idle_message(false, idle, Some(idle)), None);
    }

    fn run_with_idle(req: FetchRequest, idle: Duration) -> (String, Events) {
        let (events, emit) = collector();
        let result = tauri::async_runtime::block_on(run_fetch_with(&req, &emit, system_lookup(), idle));
        (result, events)
    }

    #[test]
    fn idle_gap_before_head_fails_with_the_idle_message() {
        for policy in [false, true] {
            let (port, join) = serve_once(|_stream| thread::sleep(Duration::from_secs(2)));
            let mut req = request("idle-head", format!("http://127.0.0.1:{}/", port));
            req.timeout_secs = None;
            if policy { req = with_policy(true, req); }
            let started = Instant::now();
            let (result, events) = run_with_idle(req, Duration::from_secs(1));
            assert!(started.elapsed() < Duration::from_secs(5));
            assert_eq!(parse(&result)["body"], json!("No data received for 1 seconds"));
            assert!(events.lock().unwrap().is_empty());
            join.join().unwrap();
        }
    }

    #[test]
    fn idle_gap_mid_body_emits_one_error_and_no_end() {
        let (port, join) = serve_once(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"first");
            thread::sleep(Duration::from_secs(2));
        });
        let mut req = request("idle-body", format!("http://127.0.0.1:{}/", port));
        req.timeout_secs = None;
        let (result, events) = run_with_idle(req, Duration::from_secs(1));
        assert_eq!(types(&events), vec!["headers", "chunk", "error"]);
        assert_eq!(parse(&result)["body"], json!("No data received for 1 seconds"));
        assert_eq!(events.lock().unwrap()[2]["body"], parse(&result)["body"]);
        join.join().unwrap();
    }

    fn gapped_stream(timeout_secs: Option<u64>, gap: Duration, count: usize) -> (String, Events) {
        let (port, join) = serve_once(move |mut stream| {
            write_head(&mut stream);
            for _ in 0..count {
                thread::sleep(gap);
                write_chunk(&mut stream, b"x");
            }
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let mut req = request("gaps", format!("http://127.0.0.1:{}/", port));
        req.timeout_secs = timeout_secs;
        let result = run_with_idle(req, Duration::from_secs(1));
        join.join().unwrap();
        result
    }

    #[test]
    fn steady_stream_longer_than_idle_completes() {
        let (result, events) = gapped_stream(None, Duration::from_millis(400), 8);
        assert_eq!(parse(&result), json!({"success": true}));
        assert_eq!(types(&events).last().map(String::as_str), Some("end"));
    }

    #[test]
    fn explicit_total_disables_idle() {
        let (result, _) = gapped_stream(Some(10), Duration::from_secs(2), 2);
        assert_eq!(parse(&result), json!({"success": true}));
    }

    #[test]
    fn zero_stays_unlimited() {
        let (result, _) = gapped_stream(Some(0), Duration::from_secs(2), 1);
        assert_eq!(parse(&result), json!({"success": true}));
    }

    fn spawn_registered(
        registry: FetchRegistry,
        req: FetchRequest,
        first_chunk: mpsc::Sender<()>,
        result: mpsc::Sender<String>,
    ) {
        tauri::async_runtime::spawn(async move {
            let emit = move |payload: String| {
                if payload.contains("\"chunk\"") { let _ = first_chunk.send(()); }
                Ok(())
            };
            let _ = result.send(run_registered(&registry, req, emit).await);
        });
    }

    #[test]
    fn duplicate_of_a_live_id_makes_no_request() {
        let (listener, port) = bind_stub();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let (count_tx, count_rx) = mpsc::channel::<usize>();
        let server = thread::spawn(move || {
            let mut count = 0;
            if let Some(mut stream) = accept_within(&listener, Duration::from_secs(5)) {
                count += 1;
                read_request(&mut stream);
                write_head(&mut stream);
                write_chunk(&mut stream, b"first");
                let _ = release_rx.recv_timeout(Duration::from_secs(5));
                let _ = stream.write_all(b"0\r\n\r\n");
            }
            if accept_within(&listener, Duration::from_millis(500)).is_some() { count += 1; }
            let _ = count_tx.send(count);
        });
        let registry = FetchRegistry::new();
        let url = format!("http://127.0.0.1:{}/", port);
        let (chunk_tx, chunk_rx) = mpsc::channel();
        let (first_tx, first_rx) = mpsc::channel();
        spawn_registered(registry.clone(), request("dup", url.clone()), chunk_tx, first_tx);
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("first chunk missing");
        let (second_tx, second_rx) = mpsc::channel();
        let (unused_tx, _) = mpsc::channel();
        spawn_registered(registry.clone(), request("dup", url), unused_tx, second_tx);
        let second = second_rx.recv_timeout(Duration::from_secs(2)).expect("duplicate waited for a request");
        assert_eq!(parse(&second), json!({"success": true, "cancelled": true}));
        assert_eq!(registry.live_len(), 1);
        release_tx.send(()).unwrap();
        assert_eq!(parse(&first_rx.recv_timeout(Duration::from_secs(5)).unwrap()), json!({"success": true}));
        assert_eq!(count_rx.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        server.join().unwrap();
    }

    #[test]
    fn cancel_after_a_resend_aborts_the_original() {
        let (port, server) = serve_once(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"first");
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut byte = [0u8; 1];
            let closed = match stream.read(&mut byte) {
                Ok(0) => true,
                Err(e) => e.kind() != io::ErrorKind::TimedOut && e.kind() != io::ErrorKind::WouldBlock,
                Ok(_) => false,
            };
            assert!(closed, "socket remained open");
        });
        let registry = FetchRegistry::new();
        let url = format!("http://127.0.0.1:{}/", port);
        let (chunk_tx, chunk_rx) = mpsc::channel();
        let (first_tx, first_rx) = mpsc::channel();
        spawn_registered(registry.clone(), request("dup2", url.clone()), chunk_tx, first_tx);
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("first chunk missing");
        let (second_tx, second_rx) = mpsc::channel();
        let (unused_tx, _) = mpsc::channel();
        spawn_registered(registry.clone(), request("dup2", url), unused_tx, second_tx);
        let second = second_rx.recv_timeout(Duration::from_secs(2)).expect("duplicate waited for a request");
        assert_eq!(parse(&second), json!({"success": true, "cancelled": true}));
        registry.cancel("dup2");
        assert_eq!(parse(&first_rx.recv_timeout(Duration::from_secs(5)).expect("original was not aborted")), json!({"success": true, "cancelled": true}));
        assert_eq!(registry.live_len(), 0);
        server.join().unwrap();
    }

    #[test]
    fn cancel_all_aborts_every_live_request() {
        let (closed_tx, closed_rx) = mpsc::channel();
        let mut servers = Vec::new();
        let mut ports = Vec::new();
        for _ in 0..2 {
            let closed_tx = closed_tx.clone();
            let (port, server) = serve_once(move |mut stream| {
                write_head(&mut stream);
                write_chunk(&mut stream, b"first");
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut byte = [0u8; 1];
                let closed = match stream.read(&mut byte) {
                    Ok(0) => true,
                    Err(e) => e.kind() != io::ErrorKind::TimedOut && e.kind() != io::ErrorKind::WouldBlock,
                    Ok(_) => false,
                };
                let _ = closed_tx.send(closed);
            });
            ports.push(port);
            servers.push(server);
        }
        let registry = FetchRegistry::new();
        let (chunk_tx, chunk_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        for (id, port) in ["a1", "a2"].into_iter().zip(ports) {
            spawn_registered(registry.clone(), request(id, format!("http://127.0.0.1:{}/", port)), chunk_tx.clone(), result_tx.clone());
        }
        for _ in 0..2 { chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start"); }
        registry.cancel_all();
        for _ in 0..2 {
            assert_eq!(parse(&result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted")), json!({"success": true, "cancelled": true}));
            assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        }
        assert_eq!(registry.live_len(), 0);
        assert_eq!(registry.tombstone_len(), 0);
        let drained = registry.register("a1");
        assert!(matches!(drained, Registration::Live(..)));
        let new_id = registry.register("b1");
        assert!(matches!(new_id, Registration::Live(..)));
        for server in servers { server.join().unwrap(); }
    }

    fn chat_stop_tags(target: Option<ChatTarget>) -> StreamTags {
        StreamTags { chat_stop: true, chat_target: target }
    }

    fn target_of(cha_id: &str, chat_id: &str) -> ChatTarget {
        ChatTarget { cha_id: cha_id.to_string(), chat_id: chat_id.to_string() }
    }

    // Sends a head and one chunk, then reports whether the client closed the socket.
    fn serve_until_closed(closed_tx: mpsc::Sender<bool>) -> (u16, thread::JoinHandle<()>) {
        serve_once(move |mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"first");
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut byte = [0u8; 1];
            let closed = match stream.read(&mut byte) {
                Ok(0) => true,
                Err(e) => e.kind() != io::ErrorKind::TimedOut && e.kind() != io::ErrorKind::WouldBlock,
                Ok(_) => false,
            };
            let _ = closed_tx.send(closed);
        })
    }

    fn cancelled_json() -> Value {
        json!({"success": true, "cancelled": true})
    }

    // RT-1, designed reproducer: a Stop that cancels nothing leaves the socket open.
    #[test]
    fn cancel_chat_aborts_a_tagged_live_request_and_closes_its_socket() {
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, server) = serve_until_closed(closed_tx);
        let registry = FetchRegistry::new();
        let mut req = request("c1", format!("http://127.0.0.1:{}/", port));
        req.tags = chat_stop_tags(Some(target_of("g", "c")));
        let (chunk_tx, chunk_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        spawn_registered(registry.clone(), req, chunk_tx, result_tx);
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start");
        assert_eq!(registry.cancel_chat(), 1);
        assert_eq!(parse(&result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted")), cancelled_json());
        assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        assert_eq!(registry.live_len(), 0);
        server.join().unwrap();
    }

    // RT-2, guard: an untagged request survives the chat's Stop.
    #[test]
    fn cancel_chat_leaves_untagged_requests_running() {
        let (closed_tx, closed_rx) = mpsc::channel();
        let (tagged_port, tagged_server) = serve_until_closed(closed_tx);
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let (untagged_port, untagged_server) = serve_once(move |mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"first");
            let _ = release_rx.recv_timeout(Duration::from_secs(5));
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let registry = FetchRegistry::new();
        let (chunk_tx, chunk_rx) = mpsc::channel();
        let (tagged_result_tx, tagged_result_rx) = mpsc::channel();
        let (untagged_result_tx, untagged_result_rx) = mpsc::channel();
        let mut tagged = request("tagged", format!("http://127.0.0.1:{}/", tagged_port));
        tagged.tags = chat_stop_tags(None);
        spawn_registered(registry.clone(), tagged, chunk_tx.clone(), tagged_result_tx);
        spawn_registered(
            registry.clone(),
            request("untagged", format!("http://127.0.0.1:{}/", untagged_port)),
            chunk_tx,
            untagged_result_tx,
        );
        for _ in 0..2 { chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start"); }
        assert_eq!(registry.cancel_chat(), 1);
        assert_eq!(parse(&tagged_result_rx.recv_timeout(Duration::from_secs(5)).expect("tagged fetch was not aborted")), cancelled_json());
        assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        assert_eq!(registry.live_len(), 1);
        release_tx.send(()).unwrap();
        assert_eq!(parse(&untagged_result_rx.recv_timeout(Duration::from_secs(5)).expect("untagged fetch did not finish")), json!({"success": true}));
        assert_eq!(registry.live_len(), 0);
        tagged_server.join().unwrap();
        untagged_server.join().unwrap();
    }

    // RT-3, guard: entries leave the registry and no tombstone is written.
    #[test]
    fn cancel_chat_twice_counts_once_and_writes_no_tombstone() {
        let registry = FetchRegistry::new();
        let _live = registry.register_tagged_at("t3", chat_stop_tags(None), Instant::now());
        assert_eq!(registry.cancel_chat(), 1);
        assert_eq!(registry.cancel_chat(), 0);
        assert_eq!(registry.live_len(), 0);
        assert_eq!(registry.tombstone_len(), 0);
    }

    // RT-4, compatibility guard: an untagged registration is not a chat request.
    #[test]
    fn untagged_register_keeps_old_behaviour() {
        let registry = FetchRegistry::new();
        let _live = registry.register("x");
        assert_eq!(registry.cancel_chat(), 0);
        assert_eq!(registry.live_len(), 1);
        assert_eq!(registry.live_tags("x"), Some(StreamTags::default()));
    }

    // Tests that register in the process-wide registry assert its global live count and
    // cancel every chat-tagged entry in it, so they must not interleave.
    static PROCESS_REGISTRY_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    // RT-5, guard: the registry the Android Stop reaches is the one requests register in.
    #[test]
    fn process_registry_is_shared() {
        let _serial = PROCESS_REGISTRY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _live = process_registry().register_tagged("rt5-process-id", chat_stop_tags(None));
        assert_eq!(cancel_process_chat_streams(), 1);
        assert_eq!(process_registry().live_len(), 0);
    }

    // RT-5b, guard: the Android Stop never reaches an untagged request (no cancel-all).
    #[test]
    fn process_chat_cancel_leaves_untagged_entries_live() {
        let _serial = PROCESS_REGISTRY_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _tagged = process_registry().register_tagged("rt5b-tagged-id", chat_stop_tags(None));
        let _untagged = process_registry().register("rt5b-untagged-id");
        assert_eq!(cancel_process_chat_streams(), 1);
        assert_eq!(process_registry().live_tags("rt5b-untagged-id"), Some(StreamTags::default()));
        assert_eq!(process_registry().live_tags("rt5b-tagged-id"), None);
        assert_eq!(process_registry().live_len(), 1);
        drop(_untagged);
        assert_eq!(process_registry().live_len(), 0);
    }

    // RT-6, guard: a chat-cancelled request ends in the aborted branch and emits no terminal event.
    #[test]
    fn a_cancelled_tagged_request_ends_in_the_aborted_branch_once() {
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, server) = serve_until_closed(closed_tx);
        let registry = FetchRegistry::new();
        let mut req = request("c6", format!("http://127.0.0.1:{}/", port));
        req.tags = chat_stop_tags(None);
        let (events, emit) = collector();
        let (chunk_tx, chunk_rx) = mpsc::channel::<()>();
        let (result_tx, result_rx) = mpsc::channel::<String>();
        let spawn_registry = registry.clone();
        tauri::async_runtime::spawn(async move {
            let tapped = move |payload: String| {
                let sent = emit(payload.clone());
                if payload.contains("\"chunk\"") { let _ = chunk_tx.send(()); }
                sent
            };
            let _ = result_tx.send(run_registered(&spawn_registry, req, tapped).await);
        });
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start");
        assert_eq!(registry.cancel_chat(), 1);
        assert_eq!(parse(&result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted")), cancelled_json());
        assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        assert_eq!(types(&events), vec!["headers".to_string(), "chunk".to_string()]);
        server.join().unwrap();
    }

    // RT-7, guard: the target never decides a cancel; only `chat_stop` does.
    #[test]
    fn cancel_chat_ignores_the_target() {
        let registry = FetchRegistry::new();
        let now = Instant::now();
        let untagged_with_target = StreamTags { chat_stop: false, chat_target: Some(target_of("a", "1")) };
        let _a = registry.register_tagged_at("a", chat_stop_tags(Some(target_of("a", "1"))), now);
        let _b = registry.register_tagged_at("b", chat_stop_tags(Some(target_of("b", "2"))), now);
        let _c = registry.register_tagged_at("c", chat_stop_tags(None), now);
        let _d = registry.register_tagged_at("d", untagged_with_target.clone(), now);
        assert_eq!(registry.cancel_chat(), 3);
        assert_eq!(registry.live_len(), 1);
        assert_eq!(registry.live_tags("d"), Some(untagged_with_target));
    }

    // RT-8, guard: the page's target reaches the live entry and leaves with it.
    #[test]
    fn the_target_reaches_the_live_entry() {
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, server) = serve_until_closed(closed_tx);
        let registry = FetchRegistry::new();
        let tags = chat_stop_tags(Some(target_of("g", "c")));
        let mut req = request("t8", format!("http://127.0.0.1:{}/", port));
        req.tags = tags.clone();
        let (chunk_tx, chunk_rx) = mpsc::channel();
        let (result_tx, result_rx) = mpsc::channel();
        spawn_registered(registry.clone(), req, chunk_tx, result_tx);
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start");
        assert_eq!(registry.live_tags("t8"), Some(tags));
        assert_eq!(registry.cancel_chat(), 1);
        result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted");
        closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open");
        assert_eq!(registry.live_tags("t8"), None);
        server.join().unwrap();
    }

    // RT-9, compatibility guard: the target parses the page's camelCase shape and nothing else.
    #[test]
    fn chat_target_parses_the_page_shape() {
        let parse_target = |value: Value| serde_json::from_value::<ChatTarget>(value);
        assert_eq!(parse_target(json!({"chaId": "g", "chatId": "c"})).unwrap(), target_of("g", "c"));
        let absent: Option<ChatTarget> = serde_json::from_value(Value::Null).unwrap();
        assert_eq!(absent, None);
        assert!(parse_target(json!({"cha_id": "g", "chat_id": "c"})).is_err());
        assert!(parse_target(json!({"chaId": "g"})).is_err());
        assert!(parse_target(json!({"chaId": "g", "chatId": "c", "memberChaId": "m"})).is_err());
        assert!(parse_target(json!({"chaId": 1, "chatId": "c"})).is_err());
    }

    // RT-10, guard: the command arguments map to the request's tags.
    #[test]
    fn stream_tags_maps_the_command_arguments() {
        assert_eq!(stream_tags(None, None), StreamTags::default());
        assert_eq!(
            stream_tags(Some(true), Some(target_of("a", "1"))),
            StreamTags { chat_stop: true, chat_target: Some(target_of("a", "1")) }
        );
        assert_eq!(
            stream_tags(Some(false), Some(target_of("a", "1"))),
            StreamTags { chat_stop: false, chat_target: Some(target_of("a", "1")) }
        );
    }

    // Native reply ownership (stage 1): the tee, the ownership decision and the abort arm.
    use crate::reply_store::test_support::*;
    use crate::reply_store::{owned_reply_for, ReplyOwnerArg, ReplyState, ReplyStore};
    use std::fs;
    use std::path::Path;

    struct PanicJournal;

    impl ReplyJournal for PanicJournal {
        fn open(&self, _: &str, _: u32, _: &str) -> Result<Box<dyn OpenRecord>, &'static str> {
            panic!("the journal must not be opened");
        }
    }

    fn owner_for(store: &ReplyStore<FaultOps>, base: &Path, key: &str) -> OwnedReply {
        let arg = ReplyOwnerArg { key: key.to_string(), page_version: 1, blob: "{}".to_string(), notice_token: None };
        owned_reply_for(store, Some(arg), || Ok(base.to_path_buf())).unwrap()
    }

    fn serve_hello() -> (u16, thread::JoinHandle<()>) {
        serve_bounded(|mut stream| {
            write_head(&mut stream);
            write_chunk(&mut stream, b"hello ");
            write_chunk(&mut stream, b"world");
            let _ = stream.write_all(b"0\r\n\r\n");
        })
    }

    fn run_owned(store: &ReplyStore<FaultOps>, base: &Path, key: &str) -> (String, Events) {
        let (port, join) = serve_hello();
        let mut req = request("o1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(owner_for(store, base, key));
        let (result, events) = run(&FetchRegistry::new(), req);
        join.join().unwrap();
        (result, events)
    }

    fn event_of(events: &Events, kind: &str) -> Value {
        events
            .lock()
            .unwrap()
            .iter()
            .find(|event| event["type"] == json!(kind))
            .cloned()
            .unwrap_or(Value::Null)
    }

    fn assert_unowned_run(result: &str, events: &Events, reason: &str) {
        assert_eq!(parse(result), json!({ "success": true }));
        let kinds = types(events);
        assert_eq!(kinds.first().map(String::as_str), Some("owner"));
        assert_eq!(kinds.last().map(String::as_str), Some("end"));
        let owner = event_of(events, "owner");
        assert_eq!(owner["owned"], json!(false));
        assert_eq!(owner["reason"], json!(reason));
        assert!(event_of(events, "end").get("reply").is_none());
    }

    fn only_listing(store: &ReplyStore<FaultOps>, base: &Path) -> crate::reply_store::ReplyListing {
        let mut listings = store.list(base).unwrap();
        assert_eq!(listings.len(), 1, "{:?}", listings);
        listings.remove(0)
    }

    // T1, guard: the stub sees no request byte before the ticket is durable.
    #[test]
    fn ticket_durable_before_stub_sees_a_byte() {
        let base = scratch("t1");
        let ops = FaultOps::new();
        let log = ops.log.clone();
        let store = store_with(ops);
        let (listener, port) = bind_stub();
        let ticket_path = record_dir(&base, KEY).join("ticket.json");
        let stub_log = log.clone();
        let join = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stub_log.lock().unwrap().push("accept".to_string());
            let ticket: Value = serde_json::from_slice(&fs::read(&ticket_path).unwrap()).unwrap();
            assert_eq!(ticket["key"], json!(KEY));
            read_request(&mut stream);
            write_head(&mut stream);
            write_chunk(&mut stream, b"x");
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        let mut req = request("t1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(owner_for(&store, &base, KEY));

        let (result, _) = run(&FetchRegistry::new(), req);

        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        let log = log.lock().unwrap().clone();
        let accepted = log.iter().position(|entry| entry == "accept").unwrap();
        assert!(log[..accepted].ends_with(&[
            "create_synced".to_string(),
            "rename:ticket.json".to_string(),
            "sync_dir".to_string(),
            "sync_dir".to_string(),
        ]));
        fs::remove_dir_all(&base).unwrap();
    }

    // T2, guard: the body and the end record are on disk before the end event.
    #[test]
    fn owned_success_stores_body_and_end_before_end_event() {
        let base = scratch("t2");
        let store = plain_store();
        let dir = record_dir(&base, KEY);
        let (port, join) = serve_hello();
        let mut req = request("o1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(owner_for(&store, &base, KEY));
        let (events, collect) = collector();
        let on_disk_at_end = Arc::new(Mutex::new(Vec::<bool>::new()));
        let probe = on_disk_at_end.clone();
        let emit = move |payload: String| {
            let parsed: Value = serde_json::from_str(&payload).unwrap();
            if parsed["type"] == json!("end") {
                probe.lock().unwrap().push(dir.join("end.json").exists() && dir.join("body.bin").exists());
            }
            collect(payload)
        };

        let result = tauri::async_runtime::block_on(run_registered(&FetchRegistry::new(), req, emit));

        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        let kinds = types(&events);
        assert_eq!(kinds.first().map(String::as_str), Some("owner"));
        assert_eq!(kinds.get(1).map(String::as_str), Some("headers"));
        assert_eq!(kinds.last().map(String::as_str), Some("end"));
        let owner = event_of(&events, "owner");
        assert_eq!((owner["owned"].clone(), owner["key"].clone()), (json!(true), json!(KEY)));
        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": true })
        );
        assert_eq!(*on_disk_at_end.lock().unwrap(), vec![true]);
        assert_eq!(fs::read(record_dir(&base, KEY).join("body.bin")).unwrap(), b"hello world");
        let listing = only_listing(&store, &base);
        assert_eq!(listing.state, ReplyState::Terminal);
        assert_eq!(listing.outcome, Some(ReplyOutcome::Done));
        assert_eq!(listing.status, Some(200));
        assert_eq!(listing.body_bytes, Some(11));
        fs::remove_dir_all(&base).unwrap();
    }

    // T3, guard: every refusal runs the request exactly as an unowned one.
    #[test]
    fn refusals_run_unowned() {
        let base = scratch("t3");
        let store = plain_store();
        let long = format!("{}0", KEY);
        let upper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA".to_string();
        for key in ["../x", "a/b", "", long.as_str(), upper.as_str()] {
            let (result, events) = run_owned(&store, &base, key);
            assert_unowned_run(&result, &events, "invalid-key");
        }
        assert!(names_in(&base).is_empty());

        // A policy-carrying call is refused before the journal is touched.
        let (port, join) = serve_hello();
        let mut req = with_policy(true, request("o1", format!("http://127.0.0.1:{}/", port)));
        req.owner = Some(OwnedReply {
            key: KEY.to_string(),
            page_version: 1,
            blob: "{}".to_string(),
            journal: Some(Arc::new(PanicJournal)),
            notice: None,
        });
        let (result, events) = run(&FetchRegistry::new(), req);
        join.join().unwrap();
        assert_unowned_run(&result, &events, "policy");

        // An unresolved store is refused as `store`.
        let (port, join) = serve_hello();
        let mut req = request("o1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(OwnedReply { key: KEY.to_string(), page_version: 1, blob: "{}".to_string(), journal: None, notice: None });
        let (result, events) = run(&FetchRegistry::new(), req);
        join.join().unwrap();
        assert_unowned_run(&result, &events, "store");
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    // T4, guard: an existing record is refused and left byte for byte as it was.
    #[test]
    fn existing_key_refused_and_untouched() {
        let base = scratch("t4");
        let store = plain_store();
        produce_done(&store, &base, KEY, b"old body");
        let before = snapshot(&record_dir(&base, KEY));

        let (result, events) = run_owned(&store, &base, KEY);

        assert_unowned_run(&result, &events, "exists");
        assert_eq!(snapshot(&record_dir(&base, KEY)), before);
        fs::remove_dir_all(&base).unwrap();
    }

    // T4b, guard: a key live in this process is refused and stays live.
    #[test]
    fn a_live_key_is_refused_and_stays_live() {
        let base = scratch("t4b");
        let store = plain_store();
        let held = store.open_record(&base, KEY, 1, "{}").unwrap();

        let (result, events) = run_owned(&store, &base, KEY);

        assert_unowned_run(&result, &events, "exists");
        assert_eq!(only_listing(&store, &base).state, ReplyState::Live);
        drop(held);
        fs::remove_dir_all(&base).unwrap();
    }

    // T5, guard: a fault at any open step runs the request unowned and leaves nothing.
    #[test]
    fn open_fault_runs_unowned() {
        let clean_base = scratch("t5-clean");
        let clean = FaultOps::new();
        let log = clean.log.clone();
        let clean_store = store_with(clean);
        let (result, events) = run_owned(&clean_store, &clean_base, KEY);
        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(types(&events).first().map(String::as_str), Some("owner"));
        let log = log.lock().unwrap().clone();
        let body_create = log.iter().enumerate().filter(|(_, e)| *e == "create_synced").nth(1).unwrap().0;
        let open_syncs = log[..body_create].iter().filter(|entry| *entry == "sync_dir").count();
        assert!(open_syncs >= 2);
        fs::remove_dir_all(&clean_base).unwrap();

        let mut faults: Vec<(&str, usize)> = vec![("create_synced", 1), ("rename", 1)];
        faults.extend((1..=open_syncs).map(|n| ("sync_dir", n)));
        for (kind, nth) in faults {
            let base = scratch("t5");
            let store = store_with(FaultOps::new().failing(kind, nth));
            let (result, events) = run_owned(&store, &base, KEY);
            assert_unowned_run(&result, &events, "store");
            assert!(store.list(&base).unwrap().is_empty(), "{} {} left a record", kind, nth);
            assert!(!record_dir(&base, KEY).exists(), "{} {}", kind, nth);
            fs::remove_dir_all(&base).unwrap();
        }
    }

    fn clean_log() -> Vec<String> {
        let base = scratch("clean-log");
        let ops = FaultOps::new();
        let log = ops.log.clone();
        let store = store_with(ops);
        run_owned(&store, &base, KEY);
        fs::remove_dir_all(&base).unwrap();
        let log = log.lock().unwrap().clone();
        log
    }

    // T6, guard: a body that did not reach the disk never ends `done`.
    #[test]
    fn body_fault_never_done() {
        for (kind, nth) in [("create_synced", 2), ("rename", 2)] {
            let base = scratch("t6");
            let store = store_with(FaultOps::new().failing(kind, nth));
            let (result, events) = run_owned(&store, &base, KEY);
            assert_eq!(parse(&result), json!({ "success": true }));
            assert_eq!(
                event_of(&events, "end")["reply"],
                json!({ "key": KEY, "outcome": "failed", "stored": false }),
                "{} {}",
                kind,
                nth
            );
            let listing = only_listing(&store, &base);
            assert_eq!(listing.state, ReplyState::Terminal);
            assert_eq!(listing.outcome, Some(ReplyOutcome::Failed));
            assert_eq!(listing.detail, Some(ReplyDetail::BodyNotStored));
            fs::remove_dir_all(&base).unwrap();
        }

        // The body's directory flush fails after its rename: the body counts as written.
        let nth = sync_dir_after(&clean_log(), "rename:body.bin");
        let base = scratch("t6-flush");
        let store = store_with(FaultOps::new().failing("sync_dir", nth));
        let (_, events) = run_owned(&store, &base, KEY);
        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": true })
        );
        let listing = only_listing(&store, &base);
        assert_eq!((listing.state, listing.outcome), (ReplyState::Terminal, Some(ReplyOutcome::Done)));
        assert_eq!(fs::read(record_dir(&base, KEY).join("body.bin")).unwrap(), b"hello world");
        fs::remove_dir_all(&base).unwrap();
    }

    // T7, guard: a failed end write still emits the terminal event.
    #[test]
    fn end_fault_still_emits() {
        let base = scratch("t7");
        let store = store_with(FaultOps::new().failing("create_synced", 3));
        let (result, events) = run_owned(&store, &base, KEY);
        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(types(&events).last().map(String::as_str), Some("end"));
        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": false })
        );
        assert_eq!(only_listing(&store, &base).state, ReplyState::Incomplete);
        fs::remove_dir_all(&base).unwrap();

        // The end's directory flush fails after its rename: the end counts as written.
        let nth = sync_dir_after(&clean_log(), "rename:end.json");
        let base = scratch("t7-flush");
        let store = store_with(FaultOps::new().failing("sync_dir", nth));
        let (_, events) = run_owned(&store, &base, KEY);
        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": true })
        );
        assert_eq!(only_listing(&store, &base).state, ReplyState::Terminal);
        fs::remove_dir_all(&base).unwrap();
    }

    // T8, guard: an owned request does not depend on its sink.
    #[test]
    fn owned_emit_failure_is_ignored() {
        let base = scratch("t8");
        let store = plain_store();
        let (port, join) = serve_hello();
        let mut req = request("o1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(owner_for(&store, &base, KEY));

        let result = tauri::async_runtime::block_on(run_registered(&FetchRegistry::new(), req, |_| {
            Err("sink closed".to_string())
        }));

        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        let listing = only_listing(&store, &base);
        assert_eq!((listing.state, listing.outcome), (ReplyState::Terminal, Some(ReplyOutcome::Done)));
        assert_eq!(fs::read(record_dir(&base, KEY).join("body.bin")).unwrap(), b"hello world");
        fs::remove_dir_all(&base).unwrap();
    }

    fn spawn_owned_abortable(
        registry: &FetchRegistry,
        store: &ReplyStore<FaultOps>,
        base: &Path,
        port: u16,
    ) -> (Events, mpsc::Receiver<()>, mpsc::Receiver<String>) {
        let mut req = request("ab", format!("http://127.0.0.1:{}/", port));
        req.tags = chat_stop_tags(None);
        req.owner = Some(owner_for(store, base, KEY));
        let (events, collect) = collector();
        let (chunk_tx, chunk_rx) = mpsc::channel::<()>();
        let (result_tx, result_rx) = mpsc::channel::<String>();
        let task_registry = registry.clone();
        tauri::async_runtime::spawn(async move {
            let emit = move |payload: String| {
                let sent = collect(payload.clone());
                if payload.contains("\"chunk\"") {
                    let _ = chunk_tx.send(());
                }
                sent
            };
            let _ = result_tx.send(run_registered(&task_registry, req, emit).await);
        });
        (events, chunk_rx, result_rx)
    }

    fn owned_abort_case(cancel: impl Fn(&FetchRegistry)) {
        let base = scratch("t10");
        let store = plain_store();
        let registry = FetchRegistry::new();
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, server) = serve_until_closed(closed_tx);
        let (events, chunk_rx, result_rx) = spawn_owned_abortable(&registry, &store, &base, port);
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start");

        cancel(&registry);

        assert_eq!(parse(&result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted")), cancelled_json());
        assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        assert_eq!(
            event_of(&events, "stopped")["reply"],
            json!({ "key": KEY, "outcome": "stopped", "stored": false })
        );
        let listing = only_listing(&store, &base);
        assert_eq!((listing.state, listing.outcome), (ReplyState::Terminal, Some(ReplyOutcome::Stopped)));
        server.join().unwrap();
        fs::remove_dir_all(&base).unwrap();
    }

    // T10, guard: every abort of an owned request ends its record `stopped`.
    #[test]
    fn aborts_write_stopped() {
        owned_abort_case(|registry| registry.cancel("ab"));
        owned_abort_case(|registry| registry.cancel_all());
        owned_abort_case(|registry| assert_eq!(registry.cancel_chat(), 1));
    }

    // T18, guard: the record stays live until the abort arm has written `stopped`.
    #[test]
    fn record_stays_live_until_stopped_is_written() {
        let base = scratch("t18");
        let gate = Gate::new();
        let store = store_with(FaultOps::new().blocking("create_synced", 2, gate.clone()));
        let registry = FetchRegistry::new();
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, server) = serve_until_closed(closed_tx);
        let (_events, chunk_rx, result_rx) = spawn_owned_abortable(&registry, &store, &base, port);
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start");

        registry.cancel("ab");
        let reached = gate.wait_reached(Duration::from_secs(5));
        // Listing and consuming run on this OS thread while the abort arm is blocked.
        let during = store.list(&base);
        let consume = store.consume(&base, KEY);
        gate.release();

        assert!(reached, "the abort arm never wrote");
        assert_eq!(during.unwrap().iter().map(|l| l.state).collect::<Vec<_>>(), vec![ReplyState::Live]);
        assert!(consume.unwrap_err().starts_with("live:"));
        assert_eq!(parse(&result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted")), cancelled_json());
        let listing = only_listing(&store, &base);
        assert_eq!((listing.state, listing.outcome), (ReplyState::Terminal, Some(ReplyOutcome::Stopped)));
        assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        server.join().unwrap();
        fs::remove_dir_all(&base).unwrap();
    }

    // T17, guard: without an owner nothing touches the store or the data directory.
    // The panicking resolver and the exact event list are the protection.
    #[test]
    fn no_owner_touches_no_store() {
        let store = plain_store();
        assert!(owned_reply_for(&store, None, || -> Result<std::path::PathBuf, String> { panic!("resolved") }).is_none());
        let (port, join) = serve_hello();
        let req = request("u17", format!("http://127.0.0.1:{}/", port));

        let (result, events) = run(&FetchRegistry::new(), req);

        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        let kinds = types(&events);
        assert_eq!(kinds.first().map(String::as_str), Some("headers"));
        assert!(kinds.iter().all(|kind| kind == "headers" || kind == "chunk" || kind == "end"));
        assert_eq!(event_of(&events, "end"), json!({ "type": "end", "id": "u17" }));
    }

    #[test]
    fn stop_without_a_record_emits_nothing() {
        let slot: SharedSlot = Arc::new(Mutex::new(RecordSlot { record: None, ended: false }));
        let owner = OwnedReply { key: KEY.to_string(), page_version: 1, blob: "{}".to_string(), journal: None, notice: None };
        stop_owned(&slot, &owner, "x", &|_| panic!("a stopped event for a request without a record"));
    }

    // Native reply notices (stage 3): the hub decision, the end record and the token's life.
    use crate::reply_notice::{NoticeHub, CODE_DONE, CODE_FAILED, FLAG_OPTED_IN};
    use crate::reply_store::owned_reply_with_hub;

    const TOKEN: i32 = 4711;

    fn hidden_armed_hub() -> Arc<NoticeHub> {
        let hub = Arc::new(NoticeHub::new());
        hub.set_visibility(Visibility::Hidden);
        hub.arm(TOKEN, FLAG_OPTED_IN);
        hub
    }

    fn noticed_owner(store: &ReplyStore<FaultOps>, base: &Path, hub: &Arc<NoticeHub>) -> OwnedReply {
        let arg = ReplyOwnerArg {
            key: KEY.to_string(),
            page_version: 1,
            blob: "{}".to_string(),
            notice_token: Some(TOKEN),
        };
        owned_reply_with_hub(store, Some(arg), || Ok(base.to_path_buf()), hub.clone()).unwrap()
    }

    fn write_status_head(stream: &mut TcpStream, status: &str) {
        let _ = stream.write_all(
            format!("HTTP/1.1 {}\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n", status)
                .as_bytes(),
        );
    }

    fn run_noticed<H>(store: &ReplyStore<FaultOps>, base: &Path, hub: &Arc<NoticeHub>, handler: H) -> (String, Events)
    where
        H: FnOnce(TcpStream) + Send + 'static,
    {
        let (port, join) = serve_bounded(handler);
        let mut req = request("n1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(noticed_owner(store, base, hub));
        let (result, events) = run(&FetchRegistry::new(), req);
        join.join().unwrap();
        (result, events)
    }

    fn serve_body(mut stream: TcpStream) {
        write_head(&mut stream);
        write_chunk(&mut stream, b"hello");
        let _ = stream.write_all(b"0\r\n\r\n");
    }

    fn serve_reset(mut stream: TcpStream) {
        write_head(&mut stream);
        write_chunk(&mut stream, b"part");
        drop(stream);
    }

    // S1, guard: hidden, armed and opted in, a stored 2xx is announced everywhere.
    #[test]
    fn a_hidden_armed_done_is_announced_in_the_end_listing_and_stamp() {
        let base = scratch("n-done");
        let store = plain_store();
        let hub = hidden_armed_hub();

        let (result, events) = run_noticed(&store, &base, &hub, serve_body);

        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": true, "announced": true, "status": 200 })
        );
        let listing = only_listing(&store, &base);
        assert_eq!((listing.announced, listing.visibility.as_deref()), (Some(true), Some("hidden")));
        let end = fs::read_to_string(record_dir(&base, KEY).join("end.json")).unwrap();
        assert!(end.ends_with(",\"announced\":true}"), "{}", end);
        assert_eq!(hub.poll(TOKEN), CODE_DONE);
        assert_eq!(hub.poll(TOKEN), -1);
        fs::remove_dir_all(&base).unwrap();
    }

    // S3, guard (R12): a stored non-2xx is announced as failed and the stamp carries the status.
    #[test]
    fn a_hidden_armed_non_2xx_done_is_announced_failed_with_its_status() {
        let base = scratch("n-500");
        let store = plain_store();
        let hub = hidden_armed_hub();

        let (_, events) = run_noticed(&store, &base, &hub, |mut stream| {
            write_status_head(&mut stream, "500 Internal Server Error");
            write_chunk(&mut stream, b"{\"error\":1}");
            let _ = stream.write_all(b"0\r\n\r\n");
        });

        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": true, "announced": true, "status": 500 })
        );
        assert_eq!(only_listing(&store, &base).announced, Some(true));
        assert_eq!(hub.poll(TOKEN), CODE_FAILED);
        fs::remove_dir_all(&base).unwrap();
    }

    // S4/S5, guard: visible, unarmed and not-opted-in ends record the real visibility and stay unannounced.
    #[test]
    fn unannounced_ends_keep_the_old_stamp_and_record_the_visibility() {
        for (visibility, flags, shown) in [
            (Visibility::Visible, Some(FLAG_OPTED_IN), "visible"),
            (Visibility::Hidden, None, "hidden"),
            (Visibility::Hidden, Some(0), "hidden"),
            (Visibility::Unknown, Some(FLAG_OPTED_IN), "unknown"),
        ] {
            let base = scratch("n-quiet");
            let store = plain_store();
            let hub = Arc::new(NoticeHub::new());
            hub.set_visibility(visibility);
            if let Some(bits) = flags {
                hub.arm(TOKEN, bits);
            }

            let (_, events) = run_noticed(&store, &base, &hub, serve_body);

            assert_eq!(
                event_of(&events, "end")["reply"],
                json!({ "key": KEY, "outcome": "done", "stored": true }),
                "{:?} {:?}",
                visibility,
                flags
            );
            let listing = only_listing(&store, &base);
            assert_eq!((listing.announced, listing.visibility.as_deref()), (None, Some(shown)));
            let expected = if flags.is_some() { 3 } else { -1 };
            assert_eq!(hub.poll(TOKEN), expected, "{:?} {:?}", visibility, flags);
            fs::remove_dir_all(&base).unwrap();
        }
    }

    // R2, guard: the end is durable before the code is pollable, and a poll
    // during the end write answers pending without waiting on the hub lock.
    #[test]
    fn end_before_publish() {
        let base = scratch("n-order");
        let hub = hidden_armed_hub();
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let workers: Arc<Mutex<Vec<thread::JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));
        let (hook_hub, hook_seen, hook_workers) = (hub.clone(), seen.clone(), workers.clone());
        let hook = Box::new(move || {
            let (tx, rx) = mpsc::channel();
            let poll_hub = hook_hub.clone();
            hook_workers.lock().unwrap().push(thread::spawn(move || {
                let _ = tx.send(poll_hub.poll(TOKEN));
            }));
            let answer = match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(code) => format!("Ok({})", code),
                Err(_) => "Timeout".to_string(),
            };
            hook_seen.lock().unwrap().push(answer);
        });
        let ops = FaultOps::new().hooking("rename", 3, hook);
        let log = ops.log.clone();
        let store = store_with(ops);

        run_noticed(&store, &base, &hub, serve_body);

        let renames: Vec<String> = log.lock().unwrap().iter().filter(|entry| entry.starts_with("rename:")).cloned().collect();
        assert_eq!(renames.get(2).map(String::as_str), Some("rename:end.json"));
        assert_eq!(*seen.lock().unwrap(), vec!["Ok(0)".to_string()]);
        assert_eq!(hub.poll(TOKEN), CODE_DONE);
        for worker in workers.lock().unwrap().drain(..) {
            worker.join().unwrap();
        }
        fs::remove_dir_all(&base).unwrap();
    }

    // R3, guard: an end that did not reach the disk is never announced.
    #[test]
    fn end_fault_quiet() {
        let base = scratch("n-endfault");
        let store = store_with(FaultOps::new().failing("create_synced", 3));
        let hub = hidden_armed_hub();

        let (_, events) = run_noticed(&store, &base, &hub, serve_body);

        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "done", "stored": false })
        );
        assert_eq!(only_listing(&store, &base).announced, None);
        assert_eq!(hub.poll(TOKEN), 3);
        fs::remove_dir_all(&base).unwrap();
    }

    // S6, guard: a body that did not reach the disk is never announced.
    #[test]
    fn a_body_fault_is_quiet() {
        let base = scratch("n-bodyfault");
        let store = store_with(FaultOps::new().failing("create_synced", 2));
        let hub = hidden_armed_hub();

        let (_, events) = run_noticed(&store, &base, &hub, serve_body);

        assert_eq!(
            event_of(&events, "end")["reply"],
            json!({ "key": KEY, "outcome": "failed", "stored": false })
        );
        assert_eq!(hub.poll(TOKEN), 3);
        fs::remove_dir_all(&base).unwrap();
    }

    // R7, guard: both failure results carry the stamp the event carries.
    #[test]
    fn failure_results_carry_stamp() {
        // (a) The send fails (the peer closes before any response): no event
        // exists after `owner`, the result is the only carrier.
        let base = scratch("n-send-error");
        let store = plain_store();
        let hub = hidden_armed_hub();
        let (result, _) = run_noticed(&store, &base, &hub, |stream| drop(stream));
        let parsed = parse(&result);
        assert_eq!(parsed["success"], json!(false));
        assert_eq!(
            parsed["reply"],
            json!({ "key": KEY, "outcome": "failed", "stored": false, "announced": true })
        );
        assert_eq!(hub.poll(TOKEN), CODE_FAILED);
        let listing = only_listing(&store, &base);
        assert_eq!((listing.outcome, listing.detail, listing.announced), (Some(ReplyOutcome::Failed), Some(ReplyDetail::Transport), Some(true)));
        fs::remove_dir_all(&base).unwrap();

        // (b) The body drops mid-stream: the result carries the event's stamp.
        let base = scratch("n-chunk-error");
        let store = plain_store();
        let hub = hidden_armed_hub();
        let (result, events) = run_noticed(&store, &base, &hub, serve_reset);
        let parsed = parse(&result);
        assert_eq!(parsed["success"], json!(false));
        let event_stamp = event_of(&events, "error")["reply"].clone();
        assert_eq!(
            event_stamp,
            json!({ "key": KEY, "outcome": "failed", "stored": false, "announced": true, "status": 200 })
        );
        assert_eq!(parsed["reply"], event_stamp);
        assert_eq!(hub.poll(TOKEN), CODE_FAILED);
        fs::remove_dir_all(&base).unwrap();

        // Unannounced, the result still carries the (plain) stamp; unowned stays bare.
        let base = scratch("n-chunk-plain");
        let store = plain_store();
        let (result, events) = run_noticed(&store, &base, &Arc::new(NoticeHub::new()), serve_reset);
        assert_eq!(parse(&result)["reply"], event_of(&events, "error")["reply"]);
        assert_eq!(parse(&result)["reply"], json!({ "key": KEY, "outcome": "failed", "stored": false }));
        fs::remove_dir_all(&base).unwrap();
        let (port, join) = serve_once(serve_reset);
        let (result, _) = run(&FetchRegistry::new(), request("u1", format!("http://127.0.0.1:{}/", port)));
        join.join().unwrap();
        assert!(parse(&result).get("reply").is_none());
    }

    fn assert_token_ended_quiet(hub: &NoticeHub, what: &str) {
        assert_eq!(hub.poll(TOKEN), 3, "{}", what);
        assert_eq!(hub.poll(TOKEN), -1, "{}", what);
    }

    // R8, guard: every exit of an armed request ends its token quietly.
    #[test]
    fn every_exit_terminates() {
        let base = scratch("n-exits");
        let store = plain_store();

        // A header the client cannot build, and a blocked IP literal, return before the record opens.
        let hub = hidden_armed_hub();
        let mut req = request("e1", "http://127.0.0.1:9/".to_string());
        req.headers = "{\"bad name\":\"x\"}".to_string();
        req.owner = Some(noticed_owner(&store, &base, &hub));
        let (result, _) = run(&FetchRegistry::new(), req);
        assert_eq!(parse(&result)["success"], json!(false));
        assert_token_ended_quiet(&hub, "bad header");

        let hub = hidden_armed_hub();
        let mut req = with_policy(false, request("e2", "http://10.0.0.1/".to_string()));
        req.owner = Some(noticed_owner(&store, &base, &hub));
        let (result, _) = run(&FetchRegistry::new(), req);
        assert_eq!(parse(&result)["success"], json!(false));
        assert_token_ended_quiet(&hub, "ip literal");

        // A cancel that raced ahead and a duplicate live id return before any slot exists.
        let hub = hidden_armed_hub();
        let registry = FetchRegistry::new();
        registry.cancel("e3");
        let mut req = request("e3", "http://127.0.0.1:9/".to_string());
        req.owner = Some(noticed_owner(&store, &base, &hub));
        let (result, _) = run(&registry, req);
        assert_eq!(parse(&result), cancelled_json());
        assert_token_ended_quiet(&hub, "already cancelled");

        let hub = hidden_armed_hub();
        let registry = FetchRegistry::new();
        let _live = registry.register("e4");
        let mut req = request("e4", "http://127.0.0.1:9/".to_string());
        req.owner = Some(noticed_owner(&store, &base, &hub));
        let (result, _) = run(&registry, req);
        assert_eq!(parse(&result), cancelled_json());
        assert_token_ended_quiet(&hub, "duplicate");
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    // R8, guard: a refusal publishes at once, while the unowned request is still running.
    #[test]
    fn a_refusal_publishes_before_the_request_ends() {
        let base = scratch("n-refusal");
        let hub = hidden_armed_hub();
        let (port, join) = serve_hello();
        let mut req = request("r1", format!("http://127.0.0.1:{}/", port));
        req.owner = Some(OwnedReply {
            key: KEY.to_string(),
            page_version: 1,
            blob: "{}".to_string(),
            journal: None,
            notice: Some(NoticeLink::bind(hub.clone(), TOKEN)),
        });
        let seen: Arc<Mutex<Vec<i32>>> = Arc::new(Mutex::new(Vec::new()));
        let (probe_hub, probe) = (hub.clone(), seen.clone());
        let (_, collect) = collector();
        let emit = move |payload: String| {
            let parsed: Value = serde_json::from_str(&payload).unwrap();
            if parsed["type"] == json!("headers") {
                probe.lock().unwrap().push(probe_hub.poll(TOKEN));
            }
            collect(payload)
        };

        let result = tauri::async_runtime::block_on(run_registered(&FetchRegistry::new(), req, emit));

        join.join().unwrap();
        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(*seen.lock().unwrap(), vec![3]);
        fs::remove_dir_all(&base).unwrap();
    }

    // S7/R8, guard: a stop is quiet, the record says stopped, and the token ends.
    #[test]
    fn a_stop_ends_the_token_quietly() {
        let base = scratch("n-stop");
        let store = plain_store();
        let hub = hidden_armed_hub();
        let registry = FetchRegistry::new();
        let (closed_tx, closed_rx) = mpsc::channel();
        let (port, server) = serve_until_closed(closed_tx);
        let mut req = request("ab", format!("http://127.0.0.1:{}/", port));
        req.tags = chat_stop_tags(None);
        req.owner = Some(noticed_owner(&store, &base, &hub));
        let (events, collect) = collector();
        let (chunk_tx, chunk_rx) = mpsc::channel::<()>();
        let (result_tx, result_rx) = mpsc::channel::<String>();
        let task_registry = registry.clone();
        tauri::async_runtime::spawn(async move {
            let emit = move |payload: String| {
                let sent = collect(payload.clone());
                if payload.contains("\"chunk\"") {
                    let _ = chunk_tx.send(());
                }
                sent
            };
            let _ = result_tx.send(run_registered(&task_registry, req, emit).await);
        });
        chunk_rx.recv_timeout(Duration::from_secs(5)).expect("stream did not start");

        assert_eq!(registry.cancel_chat(), 1);

        assert_eq!(parse(&result_rx.recv_timeout(Duration::from_secs(5)).expect("fetch was not aborted")), cancelled_json());
        assert!(closed_rx.recv_timeout(Duration::from_secs(5)).expect("socket stayed open"));
        assert_eq!(
            event_of(&events, "stopped")["reply"],
            json!({ "key": KEY, "outcome": "stopped", "stored": false })
        );
        let listing = only_listing(&store, &base);
        assert_eq!((listing.outcome, listing.announced, listing.visibility.as_deref()), (Some(ReplyOutcome::Stopped), None, Some("hidden")));
        assert_token_ended_quiet(&hub, "stopped");
        server.join().unwrap();
        fs::remove_dir_all(&base).unwrap();
    }

    // S9, compatibility guard: without a token the run is today's, with the real visibility recorded.
    #[test]
    fn no_token_records_the_process_visibility() {
        let base = scratch("n-no-token");
        let store = plain_store();

        let (result, events) = run_owned(&store, &base, KEY);

        assert_eq!(parse(&result), json!({ "success": true }));
        assert_eq!(event_of(&events, "end")["reply"], json!({ "key": KEY, "outcome": "done", "stored": true }));
        let listing = only_listing(&store, &base);
        assert_eq!(listing.visibility.as_deref(), Some(process_notices().visibility().as_str()));
        assert_eq!(listing.announced, None);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_body_over_the_cap_is_dropped_not_kept() {
        let mut body = Vec::new();
        let mut overflow = false;
        accumulate(&mut body, &mut overflow, b"ab", 4);
        accumulate(&mut body, &mut overflow, b"cd", 4);
        assert_eq!((body.as_slice(), overflow), (&b"abcd"[..], false));
        accumulate(&mut body, &mut overflow, b"e", 4);
        assert!(overflow && body.is_empty());
        accumulate(&mut body, &mut overflow, b"f", 4);
        assert!(overflow && body.is_empty());
    }
}
