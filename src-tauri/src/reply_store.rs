//! The native reply store: one versioned record per owned streamed request,
//! under `<app data>/native-reply/r/<key>/`. Rust is the only writer of the
//! record files and, by convention, their only reader: the page uses the typed
//! listings and ranged body reads (the generic range reads are not refused).
//!
//! A record is `ticket.json` (written and flushed before the request is sent),
//! then at the terminal moment `body.bin` followed by `end.json`, and optionally
//! `parked.json`. Each file is written to a synced temp in the record directory
//! and renamed into place; the rename is the durable point. A directory flush
//! that fails after a rename is logged and the step still counts as written,
//! except at open, where nothing has been sent yet and any failure refuses
//! ownership at no cost. A write never creates the record directory, so a write
//! that arrives after the record was consumed fails instead of recreating it.
//!
//! Format v1 (frozen by the committed fixture): readers ignore unknown fields,
//! an additive optional field keeps `v`, any other change bumps `v` and ships a
//! migration tested against the fixture. `outcome` `done` implies a `body.bin`
//! of exactly `bodyBytes`; a `failed` or `stopped` record with a stray body is
//! valid and consume removes it. `part.bin` is the raw response body received so
//! far, appended in place and in received order, so any prefix of it is valid
//! (it may end inside a line or a UTF-8 character). It is never read for a
//! `done` record, is listed as `partialBytes` for a record that did not finish
//! (dead, incomplete, failed or stopped) and goes away with the directory. A
//! record that cannot be read (unknown format or
//! version, unparsable file, `done` without its body, files without a ticket)
//! is listed `unreadable` and is never deleted by this module.
//!
//! The live set holds the keys of records a request is still writing. It is
//! locked for each per-record decision and removal, so a listing, a consume, a
//! park and an open never interleave on one record. A key leaves the set only
//! when its record's last write is done. Nothing from the request URL, its
//! headers or its body is written; the page-supplied blob stays opaque.

use crate::chunked_io::{read_range, TEXT_RANGE_MAX_BYTES};
use crate::durable_write::{is_temp_name, rename_with_retry, FileOps, RealOps};
use crate::reply_notice::{process_notices, NoticeHub, NoticeLink};
use crate::streamed_fetch::{OpenRecord, OwnedReply, ReplyDetail, ReplyEnd, ReplyJournal, ReplyOutcome};
use base64::{engine::general_purpose, Engine as _};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

/// The reserved top-level directory; `store2_gate` refuses it to the page's generic commands.
pub const ROOT_DIR: &str = "native-reply";
const RECORDS_DIR: &str = "r";
const CONSUMED_DIR: &str = "x";
const TICKET_FILE: &str = "ticket.json";
const BODY_FILE: &str = "body.bin";
const END_FILE: &str = "end.json";
const PARKED_FILE: &str = "parked.json";
const PART_FILE: &str = "part.bin";
const TICKET_FORMAT: &str = "risu-native-reply-ticket";
const END_FORMAT: &str = "risu-native-reply-end";
const PARK_FORMAT: &str = "risu-native-reply-park";
const FORMAT_VERSION: u32 = 1;
pub const MAX_BLOB_BYTES: usize = 1024 * 1024;
const MAX_ERROR_BYTES: usize = 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticket {
    format: String,
    v: u32,
    key: String,
    created_ms: u64,
    process: String,
    page_version: u32,
    blob: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EndFile {
    format: String,
    v: u32,
    outcome: ReplyOutcome,
    status: Option<u16>,
    body_bytes: Option<u64>,
    visibility: String,
    detail: Option<ReplyDetail>,
    error: Option<String>,
    ended_ms: u64,
    /// Additive: written only when true, so an unannounced end is byte for byte
    /// a v1 end and a reader that predates it ignores the field.
    #[serde(default, skip_serializing_if = "is_false")]
    announced: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParkFile {
    format: String,
    v: u32,
    parked_ms: u64,
}

/// What the page passes to own a request: the record key (its generation id),
/// the page's own version of the blob's shape and the blob itself.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplyOwnerArg {
    pub key: String,
    pub page_version: u32,
    pub blob: String,
    /// The notice token the page armed for this request. It lives in the
    /// in-memory notice hub only and is never written to the ticket.
    #[serde(default)]
    pub notice_token: Option<i32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReplyState {
    Live,
    Unreadable,
    Terminal,
    Incomplete,
    Dead,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyListing {
    pub key: String,
    pub state: ReplyState,
    pub parked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<ReplyOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<ReplyDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `Some(true)` when the end was announced by a native notice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub announced: Option<bool>,
    /// Why an `unreadable` record cannot be read, so the page can name the item.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
    /// The length of the raw partial body in `part.bin`, present only for a
    /// record that did not finish and whose part is a non-empty regular file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_bytes: Option<u64>,
}

impl ReplyListing {
    fn bare(key: &str, state: ReplyState) -> ReplyListing {
        ReplyListing {
            key: key.to_string(),
            state,
            parked: false,
            created_ms: None,
            page_version: None,
            blob: None,
            outcome: None,
            status: None,
            body_bytes: None,
            visibility: None,
            detail: None,
            error: None,
            announced: None,
            problem: None,
            partial_bytes: None,
        }
    }

    fn unreadable(key: &str, problem: String) -> ReplyListing {
        let mut listing = ReplyListing::bare(key, ReplyState::Unreadable);
        listing.problem = Some(problem);
        listing
    }
}

/// The answer of consume and discard: `removed` or `absent` (nothing to remove),
/// and whether every directory flush that backs the removal succeeded.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RemoveOutcome {
    pub result: &'static str,
    pub flushed: bool,
}

/// A record key is a lowercase canonical UUID: it is a single safe path segment
/// and never a temp file name.
fn is_reply_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            _ => byte.is_ascii_digit() || (b'a'..=b'f').contains(byte),
        })
}

fn require_key(key: &str) -> Result<(), String> {
    if is_reply_key(key) {
        Ok(())
    } else {
        Err("invalid-key: a reply key is a lowercase UUID".to_string())
    }
}

/// `text` cut to at most `MAX_ERROR_BYTES` at a character boundary.
fn truncate_error(text: &str) -> String {
    if text.len() <= MAX_ERROR_BYTES {
        return text.to_string();
    }
    let end = text
        .char_indices()
        .map(|(start, _)| start)
        .take_while(|start| *start <= MAX_ERROR_BYTES)
        .last()
        .unwrap_or(0);
    text[..end].to_string()
}

fn system_clock() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn records_dir(base: &Path) -> PathBuf {
    base.join(ROOT_DIR).join(RECORDS_DIR)
}

fn consumed_dir(base: &Path) -> PathBuf {
    base.join(ROOT_DIR).join(CONSUMED_DIR)
}

/// Writes `bytes` as `dir/name` through a synced temp and a rename. It never
/// creates `dir`, so a record that was consumed meanwhile is not recreated; an
/// existing `name` is replaced. `Ok` is whether the directory flush after the
/// rename succeeded (`false` is logged; the file is in place).
pub(crate) fn write_new_in_existing_dir<O: FileOps>(
    ops: &O,
    dir: &Path,
    name: &str,
    bytes: &[u8],
) -> Result<bool, String> {
    let temp = dir.join(ops.temp_name());
    if let Err(error) = ops.create_synced(&temp, bytes) {
        // An existing temp is not this call's file and is left alone.
        if error.kind() != io::ErrorKind::AlreadyExists {
            let _ = ops.remove(&temp);
        }
        return Err(format!("failed to write {}: {}", temp.display(), error));
    }
    let target = dir.join(name);
    if let Err(error) = rename_with_retry(ops, &temp, &target) {
        let _ = ops.remove(&temp);
        return Err(format!("failed to rename {} to {}: {}", temp.display(), target.display(), error));
    }
    match ops.sync_dir(dir) {
        Ok(()) => Ok(true),
        Err(error) => {
            eprintln!("directory flush after rename failed for {}: {}", dir.display(), error);
            Ok(false)
        }
    }
}

struct LiveSet {
    keys: Mutex<HashSet<String>>,
}

impl LiveSet {
    /// A poisoned lock is recovered: the set holds no invariant a panic could break.
    fn lock(&self) -> MutexGuard<'_, HashSet<String>> {
        self.keys.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Membership of one key in the live set; dropping it removes the key. It
/// exists only after a successful insert, so a refused duplicate never removes
/// the other request's membership.
struct LiveGuard {
    set: Arc<LiveSet>,
    key: String,
}

impl LiveGuard {
    fn acquire(set: &Arc<LiveSet>, key: &str) -> Option<LiveGuard> {
        if set.lock().insert(key.to_string()) {
            Some(LiveGuard { set: set.clone(), key: key.to_string() })
        } else {
            None
        }
    }
}

impl Drop for LiveGuard {
    fn drop(&mut self) {
        self.set.lock().remove(&self.key);
    }
}

struct Inner<O> {
    ops: O,
    /// Names this process in every ticket it writes, so a record without an end
    /// is `incomplete` here and `dead` after a restart.
    nonce: String,
    clock: fn() -> u64,
    live: Arc<LiveSet>,
}

/// The managed store state. Clones share one live set.
pub struct ReplyStore<O: FileOps = RealOps> {
    inner: Arc<Inner<O>>,
}

impl<O: FileOps> Clone for ReplyStore<O> {
    fn clone(&self) -> Self {
        ReplyStore { inner: self.inner.clone() }
    }
}

impl ReplyStore<RealOps> {
    pub fn new() -> Self {
        ReplyStore::with_parts(RealOps, uuid::Uuid::new_v4().simple().to_string(), system_clock)
    }
}

fn names_of(dir: &Path) -> io::Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(dir)? {
        names.push(entry?.file_name().to_string_lossy().into_owned());
    }
    Ok(names)
}

fn read_json<T: DeserializeOwned>(path: &Path, what: &str) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read {}: {}", what, e))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("cannot parse {}: {}", what, e))
}

/// The state of one record directory, or `None` when it is absent or holds
/// nothing. The caller holds the live-set lock and has found the key not live.
fn classify(dir: &Path, key: &str, nonce: &str) -> Option<ReplyListing> {
    let names = match names_of(dir) {
        Ok(names) => names,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return None,
        Err(error) => return Some(ReplyListing::unreadable(key, format!("cannot list the record: {}", error))),
    };
    if names.is_empty() {
        return None;
    }
    let has = |name: &str| names.iter().any(|candidate| candidate == name);
    if !has(TICKET_FILE) {
        return Some(ReplyListing::unreadable(key, "the record has files but no ticket".to_string()));
    }
    let ticket: Ticket = match read_json(&dir.join(TICKET_FILE), TICKET_FILE) {
        Ok(ticket) => ticket,
        Err(problem) => return Some(ReplyListing::unreadable(key, problem)),
    };
    if ticket.format != TICKET_FORMAT || ticket.v != FORMAT_VERSION {
        return Some(ReplyListing::unreadable(key, "the ticket has an unknown format or version".to_string()));
    }
    if ticket.key != key {
        return Some(ReplyListing::unreadable(key, "the ticket names another key".to_string()));
    }
    let mut listing = ReplyListing::bare(key, ReplyState::Incomplete);
    listing.created_ms = Some(ticket.created_ms);
    listing.page_version = Some(ticket.page_version);
    listing.blob = Some(ticket.blob);
    if has(END_FILE) {
        let end: EndFile = match read_json(&dir.join(END_FILE), END_FILE) {
            Ok(end) => end,
            Err(problem) => return Some(ReplyListing::unreadable(key, problem)),
        };
        if end.format != END_FORMAT || end.v != FORMAT_VERSION {
            return Some(ReplyListing::unreadable(key, "the end record has an unknown format or version".to_string()));
        }
        if end.outcome == ReplyOutcome::Done {
            let stored = fs::metadata(dir.join(BODY_FILE)).ok().filter(|meta| meta.is_file()).map(|meta| meta.len());
            if stored.is_none() || stored != end.body_bytes {
                return Some(ReplyListing::unreadable(key, "the end record says done but the body is missing or differs".to_string()));
            }
        }
        listing.state = ReplyState::Terminal;
        listing.outcome = Some(end.outcome);
        listing.status = end.status;
        listing.body_bytes = end.body_bytes;
        listing.visibility = Some(end.visibility);
        listing.detail = end.detail;
        listing.error = end.error;
        listing.announced = if end.announced { Some(true) } else { None };
    } else if ticket.process != nonce {
        listing.state = ReplyState::Dead;
    }
    if has(PARKED_FILE) {
        let parked: ParkFile = match read_json(&dir.join(PARKED_FILE), PARKED_FILE) {
            Ok(parked) => parked,
            Err(problem) => return Some(ReplyListing::unreadable(key, problem)),
        };
        if parked.format != PARK_FORMAT || parked.v != FORMAT_VERSION {
            return Some(ReplyListing::unreadable(key, "the park record has an unknown format or version".to_string()));
        }
        listing.parked = true;
    }
    let unfinished = match listing.state {
        ReplyState::Dead | ReplyState::Incomplete => true,
        ReplyState::Terminal => matches!(listing.outcome, Some(ReplyOutcome::Failed) | Some(ReplyOutcome::Stopped)),
        ReplyState::Live | ReplyState::Unreadable => false,
    };
    if unfinished && has(PART_FILE) {
        // The outcome is readable without the part, so a part that cannot be
        // measured only leaves the listing without `partialBytes`.
        match fs::metadata(dir.join(PART_FILE)) {
            Ok(meta) if meta.is_file() && meta.len() > 0 => listing.partial_bytes = Some(meta.len()),
            Ok(_) => {}
            Err(error) => eprintln!("could not measure the partial body of reply {}: {}", key, error),
        }
    }
    Some(listing)
}

/// The open record a request writes through. Its live-set membership ends when
/// it is dropped, which the request's slot does only after the last write.
struct Record<O: FileOps> {
    inner: Arc<Inner<O>>,
    dir: PathBuf,
    _guard: LiveGuard,
}

impl<O: FileOps + Send + Sync + 'static> OpenRecord for Record<O> {
    fn write_body(&mut self, bytes: &[u8]) -> Result<(), String> {
        write_new_in_existing_dir(&self.inner.ops, &self.dir, BODY_FILE, bytes).map(|_| ())
    }

    fn write_end(&mut self, end: &ReplyEnd) -> Result<(), String> {
        let file = EndFile {
            format: END_FORMAT.to_string(),
            v: FORMAT_VERSION,
            outcome: end.outcome,
            status: end.status,
            body_bytes: end.body_bytes,
            visibility: end.visibility.as_str().to_string(),
            detail: end.detail,
            error: end.error.as_deref().map(truncate_error),
            ended_ms: (self.inner.clock)(),
            announced: end.announced,
        };
        let bytes = serde_json::to_vec(&file).map_err(|e| e.to_string())?;
        write_new_in_existing_dir(&self.inner.ops, &self.dir, END_FILE, &bytes).map(|_| ())
    }
}

struct StoreJournal<O: FileOps> {
    store: ReplyStore<O>,
    base: PathBuf,
}

impl<O: FileOps + Send + Sync + 'static> ReplyJournal for StoreJournal<O> {
    fn open(&self, key: &str, page_version: u32, blob: &str) -> Result<Box<dyn OpenRecord>, &'static str> {
        self.store.open_record(&self.base, key, page_version, blob)
    }
}

/// The ownership of one request as the command builds it. Without an argument
/// nothing is resolved and the store is not touched; with one, an unresolved
/// base leaves the journal out and the request refuses ownership as `store`.
pub fn owned_reply_for<O: FileOps + Send + Sync + 'static>(
    store: &ReplyStore<O>,
    arg: Option<ReplyOwnerArg>,
    base: impl FnOnce() -> Result<PathBuf, String>,
) -> Option<OwnedReply> {
    owned_reply_with_hub(store, arg, base, process_notices())
}

/// `owned_reply_for` with the notice hub named. A positive `notice_token` binds
/// the request to that token; the link ends the token however the request exits.
pub fn owned_reply_with_hub<O: FileOps + Send + Sync + 'static>(
    store: &ReplyStore<O>,
    arg: Option<ReplyOwnerArg>,
    base: impl FnOnce() -> Result<PathBuf, String>,
    hub: Arc<NoticeHub>,
) -> Option<OwnedReply> {
    let arg = arg?;
    let notice = arg.notice_token.filter(|token| *token > 0).map(|token| NoticeLink::bind(hub, token));
    let journal = base().ok().map(|base| {
        let journal: Arc<dyn ReplyJournal> = Arc::new(StoreJournal { store: store.clone(), base });
        journal
    });
    Some(OwnedReply { key: arg.key, page_version: arg.page_version, blob: arg.blob, journal, notice })
}

impl<O: FileOps + Send + Sync + 'static> ReplyStore<O> {
    pub(crate) fn with_parts(ops: O, nonce: String, clock: fn() -> u64) -> Self {
        ReplyStore {
            inner: Arc::new(Inner {
                ops,
                nonce,
                clock,
                live: Arc::new(LiveSet { keys: Mutex::new(HashSet::new()) }),
            }),
        }
    }

    /// Opens the record of a request that has not been sent yet. Strict: any
    /// failure, including a directory flush, refuses ownership with a reason and
    /// the request then runs unowned. The ticket is durable when this returns.
    pub(crate) fn open_record(
        &self,
        base: &Path,
        key: &str,
        page_version: u32,
        blob: &str,
    ) -> Result<Box<dyn OpenRecord>, &'static str> {
        if !is_reply_key(key) {
            return Err("invalid-key");
        }
        if blob.len() > MAX_BLOB_BYTES {
            return Err("blob-too-large");
        }
        let guard = LiveGuard::acquire(&self.inner.live, key).ok_or("exists")?;
        let ops = &self.inner.ops;
        let records = records_dir(base);
        let dir = records.join(key);
        // Directories this call creates, outermost first.
        let mut created: Vec<&Path> = Vec::new();
        for ancestor in records.ancestors() {
            if ancestor.as_os_str().is_empty() || ancestor.exists() {
                break;
            }
            created.push(ancestor);
        }
        created.reverse();
        ops.create_dir_all(&records).map_err(|_| "store")?;
        for new_dir in created {
            if let Some(parent) = new_dir.parent() {
                ops.sync_dir(parent).map_err(|_| "store")?;
            }
        }
        match fs::create_dir(&dir) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Err("exists"),
            Err(_) => return Err("store"),
        }
        let ticket = Ticket {
            format: TICKET_FORMAT.to_string(),
            v: FORMAT_VERSION,
            key: key.to_string(),
            created_ms: (self.inner.clock)(),
            process: self.inner.nonce.clone(),
            page_version,
            blob: blob.to_string(),
        };
        let durable = serde_json::to_vec(&ticket)
            .map_err(|e| e.to_string())
            .and_then(|bytes| write_new_in_existing_dir(ops, &dir, TICKET_FILE, &bytes))
            .map(|flushed| flushed && ops.sync_dir(&records).is_ok());
        if !matches!(durable, Ok(true)) {
            self.discard_partial(&dir);
            return Err("store");
        }
        Ok(Box::new(Record { inner: self.inner.clone(), dir, _guard: guard }))
    }

    /// Best-effort removal of a record directory whose open failed; whatever stays
    /// lists as `incomplete` or `dead` and is removed by consume.
    fn discard_partial(&self, dir: &Path) {
        if let Ok(names) = names_of(dir) {
            for name in names {
                let _ = self.inner.ops.remove(&dir.join(name));
            }
        }
        let _ = fs::remove_dir(dir);
    }

    fn sweep_temps(&self, dir: &Path) {
        if let Ok(names) = names_of(dir) {
            for name in names.iter().filter(|name| is_temp_name(name)) {
                let _ = self.inner.ops.remove(&dir.join(name));
            }
        }
    }

    /// Removes what an earlier consume left in `x/`; a missing entry counts as removed.
    fn sweep_consumed(&self, base: &Path) {
        let Ok(entries) = fs::read_dir(consumed_dir(base)) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let removed = match entry.file_type() {
                Ok(kind) if kind.is_dir() => fs::remove_dir_all(&path),
                _ => fs::remove_file(&path),
            };
            if let Err(error) = removed {
                if error.kind() != io::ErrorKind::NotFound {
                    eprintln!("could not remove a consumed reply {}: {}", path.display(), error);
                }
            }
        }
    }

    /// Every record: its state, and for a readable one its ticket and end data.
    /// Per record, under the live-set lock: a live key is reported as such and
    /// not read; otherwise temps are swept, the record is classified and an
    /// empty directory is removed. An unreadable record is reported and kept.
    pub fn list(&self, base: &Path) -> Result<Vec<ReplyListing>, String> {
        self.sweep_consumed(base);
        let records = records_dir(base);
        let entries = match fs::read_dir(&records) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("failed to list the replies: {}", error)),
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        let mut listings = Vec::new();
        for name in names {
            let live = self.inner.live.lock();
            if live.contains(&name) {
                listings.push(ReplyListing::bare(&name, ReplyState::Live));
                continue;
            }
            let dir = records.join(&name);
            self.sweep_temps(&dir);
            match classify(&dir, &name, &self.inner.nonce) {
                Some(listing) => listings.push(listing),
                None => {
                    let _ = fs::remove_dir(&dir);
                }
            }
        }
        Ok(listings)
    }

    /// The state of a readable, not live record whose end is `done`, or why not.
    fn finished_record(&self, base: &Path, key: &str) -> Result<ReplyListing, String> {
        require_key(key)?;
        let live = self.inner.live.lock();
        if live.contains(key) {
            return Err(format!("live: reply {} is still being received", key));
        }
        match classify(&records_dir(base).join(key), key, &self.inner.nonce) {
            None => Err("state: there is no such reply".to_string()),
            Some(listing) if listing.state == ReplyState::Unreadable => {
                Err(format!("unreadable: {}", listing.problem.unwrap_or_default()))
            }
            Some(listing) if listing.state == ReplyState::Terminal && listing.outcome == Some(ReplyOutcome::Done) => {
                Ok(listing)
            }
            Some(_) => Err("state: only a finished reply has a body".to_string()),
        }
    }

    /// A piece of the body of a finished reply as one base64 string: at most
    /// `TEXT_RANGE_MAX_BYTES` of body followed by the fixed trailer of
    /// `chunked_io::read_range` (the total body length is its first word).
    pub fn read_body(&self, base: &Path, key: &str, offset: u64, len: u64) -> Result<String, String> {
        self.finished_record(base, key)?;
        let path = records_dir(base).join(key).join(BODY_FILE);
        let bytes = read_range(&path, offset, len.min(TEXT_RANGE_MAX_BYTES))?;
        Ok(general_purpose::STANDARD.encode(bytes))
    }

    /// A piece of the raw partial body of a record that did not finish, in the
    /// same reply shape as `read_body`. It is refused for a live record, an
    /// unreadable one and a record with no `partialBytes` (a `done` record
    /// included). The check and the read share one live-set hold.
    pub fn read_partial(&self, base: &Path, key: &str, offset: u64, len: u64) -> Result<String, String> {
        require_key(key)?;
        let live = self.inner.live.lock();
        if live.contains(key) {
            return Err(format!("live: reply {} is still being received", key));
        }
        let dir = records_dir(base).join(key);
        match classify(&dir, key, &self.inner.nonce) {
            None => return Err("state: there is no such reply".to_string()),
            Some(listing) if listing.state == ReplyState::Unreadable => {
                return Err(format!("unreadable: {}", listing.problem.unwrap_or_default()));
            }
            Some(listing) if listing.partial_bytes.is_some() => {}
            Some(_) => return Err("state: the reply has no partial body".to_string()),
        }
        let bytes = read_range(&dir.join(PART_FILE), offset, len.min(TEXT_RANGE_MAX_BYTES))?;
        Ok(general_purpose::STANDARD.encode(bytes))
    }

    /// Marks a finished reply as parked; the page then asks the user what to do with it.
    pub fn park(&self, base: &Path, key: &str) -> Result<(), String> {
        require_key(key)?;
        // The state check and the write share one hold, so no consume or list
        // can move or sweep the record between them.
        let live = self.inner.live.lock();
        if live.contains(key) {
            return Err(format!("live: reply {} is still being received", key));
        }
        let dir = records_dir(base).join(key);
        match classify(&dir, key, &self.inner.nonce) {
            None => return Err("state: there is no such reply".to_string()),
            Some(listing) if listing.state == ReplyState::Unreadable => {
                return Err(format!("unreadable: {}", listing.problem.unwrap_or_default()));
            }
            Some(listing) if listing.state == ReplyState::Terminal && listing.outcome == Some(ReplyOutcome::Done) => {}
            Some(_) => return Err("state: only a finished reply can be parked".to_string()),
        }
        let file = ParkFile {
            format: PARK_FORMAT.to_string(),
            v: FORMAT_VERSION,
            parked_ms: (self.inner.clock)(),
        };
        let bytes = serde_json::to_vec(&file).map_err(|e| e.to_string())?;
        write_new_in_existing_dir(&self.inner.ops, &dir, PARKED_FILE, &bytes).map(|_| ())
    }

    /// Removes a finished (not parked), incomplete or dead record.
    pub fn consume(&self, base: &Path, key: &str) -> Result<RemoveOutcome, String> {
        self.remove(base, key, false)
    }

    /// Removes what `consume` removes and a parked record.
    pub fn discard(&self, base: &Path, key: &str) -> Result<RemoveOutcome, String> {
        self.remove(base, key, true)
    }

    fn remove(&self, base: &Path, key: &str, allow_parked: bool) -> Result<RemoveOutcome, String> {
        require_key(key)?;
        let ops = &self.inner.ops;
        let records = records_dir(base);
        let consumed = consumed_dir(base);
        let dir = records.join(key);
        // The state check and the rename out of `r/` share one hold; the
        // deletion happens after the lock is released.
        let retired = {
            let live = self.inner.live.lock();
            if live.contains(key) {
                return Err(format!("live: reply {} is still being received", key));
            }
            match classify(&dir, key, &self.inner.nonce) {
                None => {
                    let _ = fs::remove_dir(&dir);
                    return Ok(RemoveOutcome { result: "absent", flushed: true });
                }
                Some(listing) if listing.state == ReplyState::Unreadable => {
                    return Err(format!("unreadable: {}", listing.problem.unwrap_or_default()));
                }
                Some(listing) if listing.parked && !allow_parked => {
                    return Err("state: the reply is parked; discard it instead".to_string());
                }
                Some(_) => {}
            }
            fs::create_dir_all(&consumed).map_err(|e| format!("failed to create {}: {}", consumed.display(), e))?;
            let suffix = uuid::Uuid::new_v4().simple().to_string();
            let retired = consumed.join(format!("{}-{}", key, &suffix[..16]));
            match rename_with_retry(ops, &dir, &retired) {
                Ok(()) => retired,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    return Ok(RemoveOutcome { result: "absent", flushed: true });
                }
                Err(error) => return Err(format!("failed to retire the reply: {}", error)),
            }
        };
        let mut flushed = true;
        for directory in [&records, &consumed] {
            if let Err(error) = ops.sync_dir(directory) {
                eprintln!("directory flush after a reply removal failed for {}: {}", directory.display(), error);
                flushed = false;
            }
        }
        match fs::remove_dir_all(&retired) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                eprintln!("could not delete the retired reply {}: {}", retired.display(), error);
                flushed = false;
            }
        }
        if let Err(error) = ops.sync_dir(&consumed) {
            eprintln!("directory flush after a reply removal failed for {}: {}", consumed.display(), error);
            flushed = false;
        }
        Ok(RemoveOutcome { result: "removed", flushed })
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use crate::reply_notice::Visibility;
    use std::collections::HashMap;
    use std::sync::Condvar;
    use std::time::Duration;

    pub const KEY: &str = "00000000-0000-4000-8000-000000000722";
    pub const FIXED_NONCE: &str = "0123456789abcdef0123456789abcdef";
    pub const FIXED_MS: u64 = 1_700_000_000_000;

    pub fn fixed_clock() -> u64 {
        FIXED_MS
    }

    /// A key distinct per `n`, for tests that hold several records.
    pub fn key_n(n: u32) -> String {
        format!("00000000-0000-4000-8000-{:012}", n)
    }

    pub fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("risu-reply-test-{}-{}", name, uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    pub fn record_dir(base: &Path, key: &str) -> PathBuf {
        records_dir(base).join(key)
    }

    /// A rendezvous that blocks one step of the code under test until released.
    pub struct Gate {
        state: Mutex<(bool, bool)>,
        changed: Condvar,
    }

    impl Gate {
        pub fn new() -> Arc<Gate> {
            Arc::new(Gate { state: Mutex::new((false, false)), changed: Condvar::new() })
        }

        fn arrive_and_wait(&self) {
            let mut state = self.state.lock().unwrap();
            state.0 = true;
            self.changed.notify_all();
            while !state.1 {
                state = self.changed.wait(state).unwrap();
            }
        }

        pub fn wait_reached(&self, wait: Duration) -> bool {
            let state = self.state.lock().unwrap();
            let (state, _) = self.changed.wait_timeout_while(state, wait, |state| !state.0).unwrap();
            state.0
        }

        pub fn release(&self) {
            self.state.lock().unwrap().1 = true;
            self.changed.notify_all();
        }
    }

    /// The real file system with a shared step log, faults at the n-th step of a
    /// kind (1-based) and an optional barrier at one step.
    pub struct FaultOps {
        pub log: Arc<Mutex<Vec<String>>>,
        counts: Mutex<HashMap<String, usize>>,
        faults: Vec<(String, usize)>,
        block: Option<(String, usize, Arc<Gate>)>,
        hook: Option<(String, usize, Box<dyn Fn() + Send + Sync>)>,
    }

    impl FaultOps {
        pub fn new() -> FaultOps {
            FaultOps {
                log: Arc::new(Mutex::new(Vec::new())),
                counts: Mutex::new(HashMap::new()),
                faults: Vec::new(),
                block: None,
                hook: None,
            }
        }

        /// Runs `hook` at the n-th step of a kind (1-based), before any fault of that step.
        pub fn hooking(mut self, kind: &str, nth: usize, hook: Box<dyn Fn() + Send + Sync>) -> FaultOps {
            self.hook = Some((kind.to_string(), nth, hook));
            self
        }

        pub fn failing(mut self, kind: &str, nth: usize) -> FaultOps {
            self.faults.push((kind.to_string(), nth));
            self
        }

        pub fn blocking(mut self, kind: &str, nth: usize, gate: Arc<Gate>) -> FaultOps {
            self.block = Some((kind.to_string(), nth, gate));
            self
        }

        fn step(&self, kind: &str, label: String) -> io::Result<()> {
            let nth = {
                let mut counts = self.counts.lock().unwrap();
                let count = counts.entry(kind.to_string()).or_insert(0);
                *count += 1;
                *count
            };
            self.log.lock().unwrap().push(label);
            if let Some((blocked, at, gate)) = &self.block {
                if blocked == kind && *at == nth {
                    gate.arrive_and_wait();
                }
            }
            if let Some((hooked, at, hook)) = &self.hook {
                if hooked == kind && *at == nth {
                    hook();
                }
            }
            if self.faults.iter().any(|(failing, at)| failing == kind && *at == nth) {
                return Err(io::Error::new(io::ErrorKind::Other, "injected fault"));
            }
            Ok(())
        }
    }

    impl FileOps for FaultOps {
        fn create_synced(&self, temp: &Path, bytes: &[u8]) -> io::Result<()> {
            self.step("create_synced", "create_synced".to_string())?;
            RealOps.create_synced(temp, bytes)
        }
        fn create_empty(&self, temp: &Path) -> io::Result<()> {
            RealOps.create_empty(temp)
        }
        fn append(&self, temp: &Path, offset: u64, bytes: &[u8]) -> io::Result<()> {
            RealOps.append(temp, offset, bytes)
        }
        fn sync_file(&self, path: &Path) -> io::Result<()> {
            RealOps.sync_file(path)
        }
        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            let name = to.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
            self.step("rename", format!("rename:{}", name))?;
            RealOps.rename(from, to)
        }
        fn sync_dir(&self, dir: &Path) -> io::Result<()> {
            self.step("sync_dir", "sync_dir".to_string())?;
            RealOps.sync_dir(dir)
        }
        fn remove(&self, path: &Path) -> io::Result<()> {
            self.log.lock().unwrap().push("remove".to_string());
            RealOps.remove(path)
        }
        fn sleep_ms(&self, _ms: u64) {}
        fn temp_name(&self) -> String {
            RealOps.temp_name()
        }
    }

    pub fn store_with(ops: FaultOps) -> ReplyStore<FaultOps> {
        ReplyStore::with_parts(ops, FIXED_NONCE.to_string(), fixed_clock)
    }

    pub fn plain_store() -> ReplyStore<FaultOps> {
        store_with(FaultOps::new())
    }

    /// The 1-based ordinal of the first `sync_dir` after the first `marker` entry in `log`.
    pub fn sync_dir_after(log: &[String], marker: &str) -> usize {
        let at = log.iter().position(|entry| entry == marker).expect("marker missing from the step log");
        let before = log[..at].iter().filter(|entry| *entry == "sync_dir").count();
        before + 1
    }

    pub fn done_end(body_bytes: u64) -> ReplyEnd {
        ReplyEnd {
            outcome: ReplyOutcome::Done,
            status: Some(200),
            body_bytes: Some(body_bytes),
            detail: None,
            error: None,
            visibility: Visibility::Unknown,
            announced: false,
        }
    }

    pub fn failed_end(error: Option<String>) -> ReplyEnd {
        ReplyEnd {
            outcome: ReplyOutcome::Failed,
            status: Some(200),
            body_bytes: None,
            detail: Some(ReplyDetail::Transport),
            error,
            visibility: Visibility::Unknown,
            announced: false,
        }
    }

    /// A finished `done` record written by the real producer.
    pub fn produce_done(store: &ReplyStore<FaultOps>, base: &Path, key: &str, body: &[u8]) {
        let mut record = store.open_record(base, key, 1, "{}").unwrap();
        record.write_body(body).unwrap();
        record.write_end(&done_end(body.len() as u64)).unwrap();
    }

    /// A record that was opened and then dropped without an end.
    pub fn produce_open_only(store: &ReplyStore<FaultOps>, base: &Path, key: &str) {
        drop(store.open_record(base, key, 1, "{}").unwrap());
    }

    pub fn snapshot(dir: &Path) -> Vec<(String, Vec<u8>)> {
        names_in(dir)
            .into_iter()
            .map(|name| {
                let bytes = fs::read(dir.join(&name)).unwrap();
                (name, bytes)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::reply_notice::Visibility;

    const FIXTURE_BLOB: &str = "{\"target\":\"synthetic\"}";
    const FIXTURE_BODY: &[u8] = b"{\"choices\":[{\"message\":{\"content\":\"synthetic reply\"}}]}";

    fn fixture_dir() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("native-reply-v1")
            .join(KEY)
    }

    /// The v1 record exactly as the real writer produces it under the fixed clock and nonce.
    fn produce_v1(base: &Path) -> PathBuf {
        let store = plain_store();
        let mut record = store.open_record(base, KEY, 1, FIXTURE_BLOB).unwrap();
        record.write_body(FIXTURE_BODY).unwrap();
        record.write_end(&done_end(FIXTURE_BODY.len() as u64)).unwrap();
        record_dir(base, KEY)
    }

    fn decode_read(text: &str) -> (Vec<u8>, u64) {
        let bytes = general_purpose::STANDARD.decode(text).unwrap();
        let cut = bytes.len() - crate::chunked_io::TRAILER_BYTES;
        let total = u64::from_le_bytes(bytes[cut..cut + 8].try_into().unwrap());
        (bytes[..cut].to_vec(), total)
    }

    /// Regenerates the committed fixture with the real writer. Run once on purpose:
    /// `cargo test --lib write_v1_fixture -- --ignored`.
    #[test]
    #[ignore]
    fn write_v1_fixture() {
        let base = scratch("fixture-producer");
        let produced = produce_v1(&base);
        let target = fixture_dir();
        fs::create_dir_all(&target).unwrap();
        for name in [TICKET_FILE, BODY_FILE, END_FILE] {
            fs::write(target.join(name), fs::read(produced.join(name)).unwrap()).unwrap();
        }
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn v1_producer_matches_committed_fixture() {
        let base = scratch("fixture-compare");
        let produced = produce_v1(&base);
        let committed = fixture_dir();
        for name in [TICKET_FILE, BODY_FILE, END_FILE] {
            assert_eq!(
                fs::read(produced.join(name)).unwrap(),
                fs::read(committed.join(name)).expect("the committed fixture file is missing"),
                "{} differs from the committed v1 bytes",
                name
            );
        }
        assert_eq!(names_in(&produced), vec![BODY_FILE, END_FILE, TICKET_FILE]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn v1_fixture_lists_terminal_done() {
        let base = scratch("fixture-read");
        let target = record_dir(&base, KEY);
        fs::create_dir_all(&target).unwrap();
        for name in [TICKET_FILE, BODY_FILE, END_FILE] {
            fs::write(target.join(name), fs::read(fixture_dir().join(name)).unwrap()).unwrap();
        }
        // A store with another nonce reads the committed bytes.
        let store = ReplyStore::with_parts(FaultOps::new(), "f".repeat(32), fixed_clock);

        let listings = store.list(&base).unwrap();

        assert_eq!(listings.len(), 1);
        assert_eq!(listings[0].state, ReplyState::Terminal);
        assert_eq!(listings[0].outcome, Some(ReplyOutcome::Done));
        assert_eq!(listings[0].body_bytes, Some(FIXTURE_BODY.len() as u64));
        assert_eq!(listings[0].visibility.as_deref(), Some("unknown"));
        assert_eq!(listings[0].blob.as_deref(), Some(FIXTURE_BLOB));
        let (piece, total) = decode_read(&store.read_body(&base, KEY, 0, 1024).unwrap());
        assert_eq!(piece, FIXTURE_BODY);
        assert_eq!(total, FIXTURE_BODY.len() as u64);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn invalid_keys_and_oversize_blobs_are_refused_before_the_disk() {
        let base = scratch("refusals");
        let store = plain_store();
        let long = format!("{}0", KEY);
        let upper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA".to_string();
        for key in ["../x", "a/b", "", long.as_str(), upper.as_str(), "00000000-0000-4000-8000-00000000072g"] {
            assert_eq!(store.open_record(&base, key, 1, "{}").err(), Some("invalid-key"), "{:?}", key);
        }
        let big = "x".repeat(MAX_BLOB_BYTES + 1);
        assert_eq!(store.open_record(&base, KEY, 1, &big).err(), Some("blob-too-large"));
        assert!(names_in(&base).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn a_key_live_in_this_process_is_refused_without_ending_the_other_membership() {
        let base = scratch("live-twice");
        let store = plain_store();
        let first = store.open_record(&base, KEY, 1, "{}").unwrap();

        assert_eq!(store.open_record(&base, KEY, 1, "{}").err(), Some("exists"));

        let listings = store.list(&base).unwrap();
        assert_eq!(listings.len(), 1);
        assert_eq!(listings[0].state, ReplyState::Live);
        drop(first);
        assert_eq!(store.list(&base).unwrap()[0].state, ReplyState::Incomplete);
        fs::remove_dir_all(&base).unwrap();
    }

    // Covers the shared no-create helper; through the API a consumed record has no
    // writer left, because consume refuses a key that is still live.
    #[test]
    fn late_write_after_consume_does_not_recreate() {
        let base = scratch("late-write");
        let store = plain_store();
        produce_open_only(&store, &base, KEY);
        let dir = record_dir(&base, KEY);
        assert_eq!(store.consume(&base, KEY).unwrap().result, "removed");

        assert!(write_new_in_existing_dir(&RealOps, &dir, END_FILE, b"{}").is_err());

        assert!(!dir.exists());
        assert!(names_in(&records_dir(&base)).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn unreadable_kept() {
        let base = scratch("unreadable");
        let store = plain_store();
        let (k1, k2, k3, k4) = (key_n(1), key_n(2), key_n(3), key_n(4));
        produce_open_only(&store, &base, &k1);
        let ticket = record_dir(&base, &k1).join(TICKET_FILE);
        let text = fs::read_to_string(&ticket).unwrap();
        assert!(text.contains("\"v\":1"));
        fs::write(&ticket, text.replace("\"v\":1", "\"v\":2")).unwrap();
        produce_done(&store, &base, &k2, b"body");
        fs::write(record_dir(&base, &k2).join(END_FILE), b"{nope").unwrap();
        produce_done(&store, &base, &k3, b"body");
        fs::remove_file(record_dir(&base, &k3).join(BODY_FILE)).unwrap();
        fs::create_dir_all(record_dir(&base, &k4)).unwrap();
        fs::write(record_dir(&base, &k4).join("notes.txt"), b"keep me").unwrap();
        let (k5, k6) = (key_n(5), key_n(6));
        produce_open_only(&store, &base, &k5);
        let ticket5 = record_dir(&base, &k5).join(TICKET_FILE);
        let text5 = fs::read_to_string(&ticket5).unwrap();
        assert!(text5.contains(&k5));
        fs::write(&ticket5, text5.replace(&k5, &key_n(9))).unwrap();
        produce_done(&store, &base, &k6, b"body");
        store.park(&base, &k6).unwrap();
        let parked6 = record_dir(&base, &k6).join(PARKED_FILE);
        let text6 = fs::read_to_string(&parked6).unwrap();
        assert!(text6.contains("\"v\":1"));
        fs::write(&parked6, text6.replace("\"v\":1", "\"v\":2")).unwrap();
        let keys = [&k1, &k2, &k3, &k4, &k5, &k6];
        let before: Vec<_> = keys.iter().map(|key| snapshot(&record_dir(&base, key))).collect();

        let listings = store.list(&base).unwrap();

        assert_eq!(listings.len(), 6);
        for listing in &listings {
            assert_eq!(listing.state, ReplyState::Unreadable, "{}", listing.key);
            assert!(listing.problem.is_some());
        }
        for key in keys {
            assert!(store.consume(&base, key).unwrap_err().starts_with("unreadable:"), "{}", key);
            assert!(store.discard(&base, key).unwrap_err().starts_with("unreadable:"), "{}", key);
            assert!(store.park(&base, key).unwrap_err().starts_with("unreadable:"), "{}", key);
            assert!(store.read_body(&base, key, 0, 10).unwrap_err().starts_with("unreadable:"), "{}", key);
        }
        let after: Vec<_> = keys.iter().map(|key| snapshot(&record_dir(&base, key))).collect();
        assert_eq!(before, after);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn stray_body_on_failed_lists_terminal_and_consume_removes_it() {
        let base = scratch("stray-body");
        let store = plain_store();
        let mut record = store.open_record(&base, KEY, 1, "{}").unwrap();
        record.write_body(b"stray").unwrap();
        record.write_end(&failed_end(None)).unwrap();
        drop(record);

        let listings = store.list(&base).unwrap();

        assert_eq!(listings.len(), 1);
        assert_eq!(listings[0].state, ReplyState::Terminal);
        assert_eq!(listings[0].outcome, Some(ReplyOutcome::Failed));
        assert_eq!(store.consume(&base, KEY).unwrap().result, "removed");
        assert!(!record_dir(&base, KEY).exists());
        assert!(names_in(&consumed_dir(&base)).is_empty());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn temp_only_dir_is_swept_not_unreadable() {
        let base = scratch("temp-only");
        let store = plain_store();
        let dir = record_dir(&base, KEY);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("risu-write-0123456789abcdef.tmp"), b"cut").unwrap();
        let other = key_n(9);
        produce_open_only(&store, &base, &other);
        fs::write(record_dir(&base, &other).join("risu-write-fedcba9876543210.tmp"), b"cut").unwrap();

        let listings = store.list(&base).unwrap();

        assert_eq!(listings.len(), 1);
        assert_eq!(listings[0].key, other);
        assert_eq!(listings[0].state, ReplyState::Incomplete);
        assert!(!dir.exists());
        assert_eq!(names_in(&record_dir(&base, &other)), vec![TICKET_FILE]);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn foreign_nonce_without_end_is_dead() {
        let base = scratch("nonce");
        let store_a = plain_store();
        produce_open_only(&store_a, &base, KEY);
        let store_b = ReplyStore::with_parts(FaultOps::new(), "b".repeat(32), fixed_clock);

        assert_eq!(store_b.list(&base).unwrap()[0].state, ReplyState::Dead);
        assert_eq!(store_a.list(&base).unwrap()[0].state, ReplyState::Incomplete);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn command_state_rules() {
        let base = scratch("commands");
        let store = plain_store();
        let (live, failed, parked, absent) = (key_n(1), key_n(2), key_n(3), key_n(4));
        let held = store.open_record(&base, &live, 1, "{}").unwrap();
        assert!(store.consume(&base, &live).unwrap_err().starts_with("live:"));
        assert!(store.discard(&base, &live).unwrap_err().starts_with("live:"));
        assert!(store.park(&base, &live).unwrap_err().starts_with("live:"));
        assert!(store.read_body(&base, &live, 0, 1).unwrap_err().starts_with("live:"));
        assert!(record_dir(&base, &live).join(TICKET_FILE).exists());

        let mut record = store.open_record(&base, &failed, 1, "{}").unwrap();
        record.write_end(&failed_end(Some("boom".to_string()))).unwrap();
        drop(record);
        assert!(store.park(&base, &failed).unwrap_err().starts_with("state:"));
        assert!(store.read_body(&base, &failed, 0, 1).unwrap_err().starts_with("state:"));

        produce_done(&store, &base, &parked, b"body");
        store.park(&base, &parked).unwrap();
        let listing = store.list(&base).unwrap().into_iter().find(|l| l.key == parked).unwrap();
        assert!(listing.parked);
        assert_eq!(listing.state, ReplyState::Terminal);
        assert!(store.consume(&base, &parked).unwrap_err().starts_with("state:"));
        assert!(record_dir(&base, &parked).exists());
        assert!(store.read_body(&base, &parked, 0, 10).is_ok());
        assert_eq!(store.discard(&base, &parked).unwrap().result, "removed");
        assert!(!record_dir(&base, &parked).exists());

        assert_eq!(store.consume(&base, &absent).unwrap(), RemoveOutcome { result: "absent", flushed: true });
        assert_eq!(store.discard(&base, &absent).unwrap().result, "absent");
        assert!(store.park(&base, &absent).unwrap_err().starts_with("state:"));
        assert!(store.consume(&base, "not-a-key").unwrap_err().starts_with("invalid-key:"));

        let leftover = consumed_dir(&base).join("leftover-0000000000000000");
        fs::create_dir_all(&leftover).unwrap();
        fs::write(leftover.join("a"), b"x").unwrap();
        store.list(&base).unwrap();
        assert!(names_in(&consumed_dir(&base)).is_empty());
        drop(held);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn read_body_ranges() {
        let base = scratch("ranges");
        let store = plain_store();
        let body: Vec<u8> = (0..(TEXT_RANGE_MAX_BYTES as usize + 10)).map(|i| (i % 251) as u8).collect();
        produce_done(&store, &base, KEY, &body);

        let (first, total) = decode_read(&store.read_body(&base, KEY, 0, u64::MAX).unwrap());
        assert_eq!(first.len() as u64, TEXT_RANGE_MAX_BYTES);
        assert_eq!(total, body.len() as u64);
        let (rest, total_again) = decode_read(&store.read_body(&base, KEY, first.len() as u64, 100).unwrap());
        assert_eq!(rest.len(), 10);
        assert_eq!(total_again, body.len() as u64);
        assert_eq!([first, rest].concat(), body);
        fs::remove_dir_all(&base).unwrap();
    }

    fn stopped_end() -> ReplyEnd {
        ReplyEnd { outcome: ReplyOutcome::Stopped, ..failed_end(None) }
    }

    fn put_part(base: &Path, key: &str, bytes: &[u8]) {
        fs::write(record_dir(base, key).join(PART_FILE), bytes).unwrap();
    }

    fn listing_of(store: &ReplyStore<FaultOps>, base: &Path, key: &str) -> ReplyListing {
        store.list(base).unwrap().into_iter().find(|listing| listing.key == key).unwrap()
    }

    #[test]
    fn dead_record_lists_partial_bytes() {
        let base = scratch("partial-dead");
        let store_a = plain_store();
        produce_open_only(&store_a, &base, KEY);
        put_part(&base, KEY, b"data: hello");
        let store_b = ReplyStore::with_parts(FaultOps::new(), "b".repeat(32), fixed_clock);

        let listing = listing_of(&store_b, &base, KEY);

        assert_eq!(listing.state, ReplyState::Dead);
        assert_eq!(serde_json::to_value(&listing).unwrap()["partialBytes"], 11);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn partial_bytes_follow_the_unfinished_rule() {
        let base = scratch("partial-rule");
        let store = plain_store();
        let (incomplete, failed, stopped, done, empty, none) = (key_n(1), key_n(2), key_n(3), key_n(4), key_n(5), key_n(6));
        produce_open_only(&store, &base, &incomplete);
        put_part(&base, &incomplete, b"abc");
        for (key, end) in [(&failed, failed_end(None)), (&stopped, stopped_end())] {
            let mut record = store.open_record(&base, key, 1, "{}").unwrap();
            record.write_end(&end).unwrap();
            drop(record);
            put_part(&base, key, b"abcd");
        }
        produce_done(&store, &base, &done, b"body");
        put_part(&base, &done, b"stray");
        produce_open_only(&store, &base, &empty);
        put_part(&base, &empty, b"");
        produce_open_only(&store, &base, &none);

        assert_eq!(listing_of(&store, &base, &incomplete).partial_bytes, Some(3));
        assert_eq!(listing_of(&store, &base, &failed).partial_bytes, Some(4));
        assert_eq!(listing_of(&store, &base, &stopped).partial_bytes, Some(4));
        assert_eq!(listing_of(&store, &base, &done).partial_bytes, None);
        assert_eq!(listing_of(&store, &base, &empty).partial_bytes, None);
        assert_eq!(listing_of(&store, &base, &none).partial_bytes, None);

        let live = key_n(7);
        let held = store.open_record(&base, &live, 1, "{}").unwrap();
        put_part(&base, &live, b"growing");
        assert_eq!(listing_of(&store, &base, &live).state, ReplyState::Live);
        assert_eq!(listing_of(&store, &base, &live).partial_bytes, None);
        drop(held);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn read_partial_ranges_and_refusals() {
        let base = scratch("partial-read");
        let store = plain_store();
        let (part, done, bare, live, broken) = (key_n(1), key_n(2), key_n(3), key_n(4), key_n(5));
        let bytes: Vec<u8> = (0..(TEXT_RANGE_MAX_BYTES as usize + 10)).map(|i| (i % 251) as u8).collect();
        produce_open_only(&store, &base, &part);
        put_part(&base, &part, &bytes);
        produce_done(&store, &base, &done, b"body");
        put_part(&base, &done, b"stray");
        produce_open_only(&store, &base, &bare);

        let (first, total) = decode_read(&store.read_partial(&base, &part, 0, u64::MAX).unwrap());
        assert_eq!(first.len() as u64, TEXT_RANGE_MAX_BYTES);
        assert_eq!(total, bytes.len() as u64);
        let (rest, _) = decode_read(&store.read_partial(&base, &part, first.len() as u64, 100).unwrap());
        assert_eq!([first, rest].concat(), bytes);

        assert!(store.read_partial(&base, &done, 0, 1).unwrap_err().starts_with("state:"));
        assert!(store.read_partial(&base, &bare, 0, 1).unwrap_err().starts_with("state:"));
        assert!(store.read_partial(&base, &key_n(9), 0, 1).unwrap_err().starts_with("state:"));
        assert!(store.read_partial(&base, "not-a-key", 0, 1).unwrap_err().starts_with("invalid-key:"));

        let held = store.open_record(&base, &live, 1, "{}").unwrap();
        put_part(&base, &live, b"growing");
        assert!(store.read_partial(&base, &live, 0, 1).unwrap_err().starts_with("live:"));
        drop(held);

        fs::create_dir_all(record_dir(&base, &broken)).unwrap();
        put_part(&base, &broken, b"orphan");
        assert!(store.read_partial(&base, &broken, 0, 1).unwrap_err().starts_with("unreadable:"));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn v1_fixture_listing_has_no_partial_bytes_key() {
        let base = scratch("fixture-no-partial");
        let target = record_dir(&base, KEY);
        fs::create_dir_all(&target).unwrap();
        for name in [TICKET_FILE, BODY_FILE, END_FILE] {
            fs::write(target.join(name), fs::read(fixture_dir().join(name)).unwrap()).unwrap();
        }
        let store = ReplyStore::with_parts(FaultOps::new(), "f".repeat(32), fixed_clock);

        let listing = listing_of(&store, &base, KEY);

        assert!(serde_json::to_value(&listing).unwrap().get("partialBytes").is_none());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn part_record_is_readable_swept_and_removed_whole() {
        let base = scratch("partial-lifecycle");
        let store = plain_store();
        let (consumed, discarded) = (key_n(1), key_n(2));
        for key in [&consumed, &discarded] {
            produce_open_only(&store, &base, key);
            put_part(&base, key, b"abc");
            fs::write(record_dir(&base, key).join("risu-write-0123456789abcdef.tmp"), b"cut").unwrap();
        }

        for key in [&consumed, &discarded] {
            let listing = listing_of(&store, &base, key);
            assert_eq!(listing.state, ReplyState::Incomplete);
            assert_eq!(listing.partial_bytes, Some(3));
            assert_eq!(names_in(&record_dir(&base, key)), vec![PART_FILE, TICKET_FILE]);
        }
        assert_eq!(store.consume(&base, &consumed).unwrap().result, "removed");
        assert_eq!(store.discard(&base, &discarded).unwrap().result, "removed");
        assert!(!record_dir(&base, &consumed).exists());
        assert!(!record_dir(&base, &discarded).exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn error_text_truncation_is_char_safe() {
        let text = format!("{}{}", "a".repeat(1023), "\u{d55c}\u{d55c}");
        let cut = truncate_error(&text);
        assert_eq!(cut, "a".repeat(1023));
        assert!(truncate_error("short").len() == 5);
        let at_boundary = format!("{}{}", "a".repeat(1024), "\u{d55c}");
        assert_eq!(truncate_error(&at_boundary).len(), 1024);

        let base = scratch("error-cut");
        let store = plain_store();
        let mut record = store.open_record(&base, KEY, 1, "{}").unwrap();
        record.write_end(&failed_end(Some(text))).unwrap();
        drop(record);
        let stored = store.list(&base).unwrap().remove(0).error.unwrap();
        assert!(stored.len() <= MAX_ERROR_BYTES);
        assert_eq!(stored, "a".repeat(1023));
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn owned_reply_resolves_nothing_without_an_argument() {
        let store = plain_store();
        let resolved = owned_reply_for(&store, None, || -> Result<PathBuf, String> { panic!("the base must not be resolved") });
        assert!(resolved.is_none());
        let arg = ReplyOwnerArg { key: KEY.to_string(), page_version: 1, blob: "{}".to_string(), notice_token: None };
        let unresolved = owned_reply_for(&store, Some(arg), || Err("no base".to_string())).unwrap();
        assert!(unresolved.journal.is_none());
    }

    #[test]
    fn the_owner_argument_parses_the_page_shape() {
        let parsed: ReplyOwnerArg = serde_json::from_str(r#"{"key":"k","pageVersion":2,"blob":"b"}"#).unwrap();
        assert_eq!((parsed.key.as_str(), parsed.page_version, parsed.blob.as_str()), ("k", 2, "b"));
        assert!(serde_json::from_str::<ReplyOwnerArg>(r#"{"key":"k","pageVersion":2,"blob":"b","extra":1}"#).is_err());
        assert!(serde_json::from_str::<ReplyOwnerArg>(r#"{"key":"k","page_version":2,"blob":"b"}"#).is_err());
    }

    fn announced_done_end(body_bytes: u64) -> ReplyEnd {
        ReplyEnd { visibility: Visibility::Hidden, announced: true, ..done_end(body_bytes) }
    }

    // R4, guard (producer-built): the announced end as the real writer produces it.
    #[test]
    fn announced_end_golden() {
        let base = scratch("announced-golden");
        let store = plain_store();
        let mut record = store.open_record(&base, KEY, 1, FIXTURE_BLOB).unwrap();
        record.write_body(FIXTURE_BODY).unwrap();
        record.write_end(&announced_done_end(FIXTURE_BODY.len() as u64)).unwrap();
        drop(record);

        let written = fs::read_to_string(record_dir(&base, KEY).join(END_FILE)).unwrap();

        assert_eq!(
            written,
            r#"{"format":"risu-native-reply-end","v":1,"outcome":"done","status":200,"bodyBytes":55,"visibility":"hidden","detail":null,"error":null,"endedMs":1700000000000,"announced":true}"#
        );
        fs::remove_dir_all(&base).unwrap();
    }

    // R4 compatibility half: an unannounced end never names the field, whatever its visibility.
    #[test]
    fn an_unannounced_end_omits_the_field() {
        let base = scratch("unannounced-end");
        let store = plain_store();
        let mut record = store.open_record(&base, KEY, 1, "{}").unwrap();
        record.write_body(b"b").unwrap();
        record.write_end(&ReplyEnd { visibility: Visibility::Visible, ..done_end(1) }).unwrap();
        drop(record);

        let written = fs::read_to_string(record_dir(&base, KEY).join(END_FILE)).unwrap();

        assert!(!written.contains("announced"), "{}", written);
        assert!(written.contains("\"visibility\":\"visible\""));
        fs::remove_dir_all(&base).unwrap();
    }

    // R6, guard: the listing reports an announced end, and the v1 fixture reports none.
    #[test]
    fn listing_announced() {
        let base = scratch("listing-announced");
        let store = plain_store();
        let mut record = store.open_record(&base, KEY, 1, "{}").unwrap();
        record.write_body(b"body").unwrap();
        record.write_end(&announced_done_end(4)).unwrap();
        drop(record);
        let listings = store.list(&base).unwrap();
        assert_eq!(listings[0].announced, Some(true));
        assert_eq!(listings[0].visibility.as_deref(), Some("hidden"));
        let json = serde_json::to_value(&listings[0]).unwrap();
        assert_eq!(json["announced"], serde_json::json!(true));
        fs::remove_dir_all(&base).unwrap();

        let base = scratch("listing-v1");
        let target = record_dir(&base, KEY);
        fs::create_dir_all(&target).unwrap();
        for name in [TICKET_FILE, BODY_FILE, END_FILE] {
            fs::write(target.join(name), fs::read(fixture_dir().join(name)).unwrap()).unwrap();
        }
        let listings = store.list(&base).unwrap();
        assert_eq!(listings[0].announced, None);
        assert!(serde_json::to_value(&listings[0]).unwrap().get("announced").is_none());
        fs::remove_dir_all(&base).unwrap();
    }

    // R6 compatibility half: a reader that predates the field reads an announced end.
    #[test]
    fn an_end_without_the_field_reads_as_unannounced() {
        let parsed: EndFile = serde_json::from_str(
            r#"{"format":"risu-native-reply-end","v":1,"outcome":"done","status":200,"bodyBytes":1,"visibility":"unknown","detail":null,"error":null,"endedMs":1}"#,
        )
        .unwrap();
        assert!(!parsed.announced);
    }

    // R10, guard + compatibility half: the token is read, never stored, and an unknown field is still refused.
    #[test]
    fn owner_arg_token() {
        let parsed: ReplyOwnerArg =
            serde_json::from_str(r#"{"key":"k","pageVersion":2,"blob":"b","noticeToken":77}"#).unwrap();
        assert_eq!(parsed.notice_token, Some(77));
        let without: ReplyOwnerArg = serde_json::from_str(r#"{"key":"k","pageVersion":2,"blob":"b"}"#).unwrap();
        assert_eq!(without.notice_token, None);
        assert!(serde_json::from_str::<ReplyOwnerArg>(r#"{"key":"k","pageVersion":2,"blob":"b","noticeToken":1,"extra":1}"#).is_err());

        let base = scratch("owner-token");
        let store = plain_store();
        let hub = Arc::new(NoticeHub::new());
        let arg = ReplyOwnerArg {
            key: KEY.to_string(),
            page_version: 1,
            blob: "{}".to_string(),
            notice_token: Some(4242),
        };
        let owner = owned_reply_with_hub(&store, Some(arg), || Ok(base.clone()), hub.clone()).unwrap();
        assert_eq!(hub.poll(4242), 0, "a positive token binds");
        let mut record = owner.journal.as_ref().unwrap().open(KEY, 1, "{}").unwrap();
        record.write_end(&failed_end(None)).unwrap();
        drop(record);
        let ticket = fs::read_to_string(record_dir(&base, KEY).join(TICKET_FILE)).unwrap();
        let end = fs::read_to_string(record_dir(&base, KEY).join(END_FILE)).unwrap();
        assert!(!ticket.contains("4242") && !ticket.contains("oticeToken"), "{}", ticket);
        assert!(!end.contains("4242") && !end.contains("oticeToken"), "{}", end);
        drop(owner);

        // A token that is not positive binds nothing.
        let arg = ReplyOwnerArg { key: KEY.to_string(), page_version: 1, blob: "{}".to_string(), notice_token: Some(0) };
        let owner = owned_reply_with_hub(&store, Some(arg), || Ok(base.clone()), hub.clone()).unwrap();
        assert!(owner.notice.is_none());
        fs::remove_dir_all(&base).unwrap();
    }
}
