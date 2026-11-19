//! The in-memory notice hub of an owned reply: the app's visibility and, per
//! token, whether the reply's end may be announced by a native notice.
//!
//! The page arms a token (flags: bit 0 is the notification opt-in) and passes
//! it with the owned request; the request binds it, decides at its terminal
//! moment, writes the end record, then publishes the code. Kotlin polls the
//! token and posts the notice. Nothing here touches the disk or the network.
//!
//! Token life: Unbound (armed, no request yet) or Bound (a request holds it)
//! -> Deciding (the end is being written) -> Published(code) -> removed by the
//! poll that takes the code. The hub lock is only held for one table step, never
//! across I/O. A bound token always reaches a code: the request's `NoticeLink`
//! publishes "quiet" when it drops unpublished. Kotlin can never remove a bound
//! token. Nothing is persisted: a process death ends the tokens and the hub.
//!
//! Codes: 1 done announced, 2 failed announced, 3 quiet. Poll answers add
//! 0 pending, 4 armed but unbound, -1 absent.

use crate::streamed_fetch::{ReplyDetail, ReplyOutcome};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

pub const CODE_DONE: i32 = 1;
pub const CODE_FAILED: i32 = 2;
pub const CODE_QUIET: i32 = 3;
pub const POLL_PENDING: i32 = 0;
pub const POLL_UNBOUND: i32 = 4;
pub const POLL_ABSENT: i32 = -1;
/// Bit 0 of the arm flags: the person has notifications on.
pub const FLAG_OPTED_IN: i32 = 1;
/// The most tokens the hub holds at once.
pub const HUB_CAP: usize = 64;

/// Whether the app was on screen, as the host last said.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Visibility {
    Unknown,
    Visible,
    Hidden,
}

impl Visibility {
    /// The value the end record stores.
    pub fn as_str(self) -> &'static str {
        match self {
            Visibility::Unknown => "unknown",
            Visibility::Visible => "visible",
            Visibility::Hidden => "hidden",
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Visibility::Unknown => 0,
            Visibility::Visible => 1,
            Visibility::Hidden => 2,
        }
    }

    fn from_u8(value: u8) -> Visibility {
        match value {
            1 => Visibility::Visible,
            2 => Visibility::Hidden,
            _ => Visibility::Unknown,
        }
    }
}

/// Whether the end of an owned reply is announced by a native notice: 1 for a
/// stored 2xx done, 2 for a stored non-2xx done or a transport failure, 3
/// (quiet) for everything else. Visibility other than hidden, an unarmed token
/// and an armed token without the opt-in gate every row to quiet.
pub fn announce(
    outcome: ReplyOutcome,
    detail: Option<ReplyDetail>,
    status: Option<u16>,
    stored: bool,
    visibility: Visibility,
    flags: Option<i32>,
) -> i32 {
    let armed = visibility == Visibility::Hidden && matches!(flags, Some(bits) if bits & FLAG_OPTED_IN != 0);
    if !armed {
        return CODE_QUIET;
    }
    match outcome {
        ReplyOutcome::Done if stored => match status {
            Some(200..=299) => CODE_DONE,
            Some(_) => CODE_FAILED,
            None => CODE_QUIET,
        },
        ReplyOutcome::Failed if detail == Some(ReplyDetail::Transport) => CODE_FAILED,
        _ => CODE_QUIET,
    }
}

/// What a request's terminal moment decided, with the visibility it read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Decision {
    pub code: i32,
    pub visibility: Visibility,
}

impl Decision {
    pub fn announced(&self) -> bool {
        self.code == CODE_DONE || self.code == CODE_FAILED
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Unbound,
    Bound,
    Deciding,
    Published(i32),
}

struct Entry {
    flags: Option<i32>,
    phase: Phase,
    seq: u64,
}

impl Entry {
    /// The poll answer without taking the code.
    fn peek(&self) -> i32 {
        match self.phase {
            Phase::Unbound => POLL_UNBOUND,
            Phase::Bound | Phase::Deciding => POLL_PENDING,
            Phase::Published(code) => code,
        }
    }
}

struct HubState {
    entries: HashMap<i32, Entry>,
    next_seq: u64,
}

impl HubState {
    /// Room for one more entry: evicts the oldest unbound entry, else the oldest
    /// published-quiet one. Bound, deciding and announced entries are never
    /// evicted. `false` when nothing can go.
    fn make_room(&mut self) -> bool {
        if self.entries.len() < HUB_CAP {
            return true;
        }
        let oldest = |state: &HubState, wanted: Phase| {
            state
                .entries
                .iter()
                .filter(|(_, entry)| entry.phase == wanted)
                .min_by_key(|(_, entry)| entry.seq)
                .map(|(token, _)| *token)
        };
        let victim = oldest(self, Phase::Unbound).or_else(|| oldest(self, Phase::Published(CODE_QUIET)));
        match victim {
            Some(token) => {
                self.entries.remove(&token);
                true
            }
            None => false,
        }
    }

    fn insert(&mut self, token: i32, flags: Option<i32>, phase: Phase) -> bool {
        if !self.make_room() {
            return false;
        }
        self.next_seq += 1;
        let seq = self.next_seq;
        self.entries.insert(token, Entry { flags, phase, seq });
        true
    }
}

pub struct NoticeHub {
    visibility: AtomicU8,
    state: Mutex<HubState>,
}

impl NoticeHub {
    pub fn new() -> NoticeHub {
        NoticeHub {
            visibility: AtomicU8::new(Visibility::Unknown.to_u8()),
            state: Mutex::new(HubState { entries: HashMap::new(), next_seq: 0 }),
        }
    }

    /// A poisoned lock is recovered: every step leaves the table consistent.
    fn lock(&self) -> MutexGuard<'_, HubState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn visibility(&self) -> Visibility {
        Visibility::from_u8(self.visibility.load(Ordering::SeqCst))
    }

    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    pub fn set_visibility(&self, visibility: Visibility) {
        self.visibility.store(visibility.to_u8(), Ordering::SeqCst);
    }

    /// Arms a token with `flags >= 0`, or disarms it with -1. Arming creates an
    /// unbound entry or sets the flags of an unbound or bound one; it never
    /// changes a deciding or published entry. Disarming removes only an unbound
    /// entry or a published-quiet one and answers -1; otherwise it answers the
    /// current poll answer and changes nothing, so a token a request holds is
    /// never removed from here. Arming answers the poll answer, or -1 when the
    /// token is invalid or the hub is full of tokens that cannot be evicted.
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    pub fn arm(&self, token: i32, flags: i32) -> i32 {
        if token <= 0 || flags < -1 {
            return POLL_ABSENT;
        }
        let mut state = self.lock();
        if flags == -1 {
            let removable = matches!(
                state.entries.get(&token).map(|entry| entry.phase),
                Some(Phase::Unbound) | Some(Phase::Published(CODE_QUIET))
            );
            if removable {
                state.entries.remove(&token);
                return POLL_ABSENT;
            }
            return state.entries.get(&token).map(Entry::peek).unwrap_or(POLL_ABSENT);
        }
        if let Some(entry) = state.entries.get_mut(&token) {
            if matches!(entry.phase, Phase::Unbound | Phase::Bound) {
                entry.flags = Some(flags);
            }
            return entry.peek();
        }
        if state.insert(token, Some(flags), Phase::Unbound) {
            POLL_UNBOUND
        } else {
            POLL_ABSENT
        }
    }

    /// A request takes the token: creates a bound entry without flags, or turns
    /// an unbound one into a bound one keeping its flags. With a full hub no
    /// entry is created and the request decides quiet.
    pub fn bind(&self, token: i32) {
        let mut state = self.lock();
        match state.entries.get_mut(&token) {
            Some(entry) => {
                if entry.phase == Phase::Unbound {
                    entry.phase = Phase::Bound;
                }
            }
            None => {
                state.insert(token, None, Phase::Bound);
            }
        }
    }

    /// The terminal decision, taken under the lock with the visibility read once
    /// so the record and the decision agree. Only a bound entry can announce;
    /// an absent, unbound, deciding or published one decides quiet and is left
    /// as it is. The caller writes the end, then publishes.
    pub fn decide(
        &self,
        token: i32,
        outcome: ReplyOutcome,
        detail: Option<ReplyDetail>,
        status: Option<u16>,
        stored: bool,
    ) -> Decision {
        let mut state = self.lock();
        let visibility = self.visibility();
        let code = match state.entries.get_mut(&token) {
            Some(entry) if entry.phase == Phase::Bound => {
                let code = announce(outcome, detail, status, stored, visibility, entry.flags);
                entry.phase = Phase::Deciding;
                code
            }
            _ => CODE_QUIET,
        };
        Decision { code, visibility }
    }

    /// Makes the code pollable: a deciding or bound entry becomes published. A
    /// quiet code for a token nobody armed is removed at once.
    pub fn publish(&self, token: i32, code: i32) {
        let mut state = self.lock();
        let Some(entry) = state.entries.get_mut(&token) else {
            return;
        };
        if !matches!(entry.phase, Phase::Deciding | Phase::Bound) {
            return;
        }
        entry.phase = Phase::Published(code);
        if code == CODE_QUIET && entry.flags.is_none() {
            state.entries.remove(&token);
        }
    }

    /// 1, 2 or 3 once, removing the entry; 4 armed and unbound; 0 pending; -1 absent.
    #[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
    pub fn poll(&self, token: i32) -> i32 {
        let mut state = self.lock();
        match state.entries.get(&token).map(|entry| (entry.phase, entry.peek())) {
            Some((Phase::Published(code), _)) => {
                state.entries.remove(&token);
                code
            }
            Some((_, answer)) => answer,
            None => POLL_ABSENT,
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lock().entries.len()
    }
}

static PROCESS_NOTICES: OnceLock<Arc<NoticeHub>> = OnceLock::new();

/// The process-wide hub the Android host reaches through JNI.
pub fn process_notices() -> Arc<NoticeHub> {
    PROCESS_NOTICES.get_or_init(|| Arc::new(NoticeHub::new())).clone()
}

/// One request's hold on its token. It binds on creation and publishes quiet
/// when dropped unpublished, so every exit of the request (an early return, a
/// cancel before or after the record opens, an unwind) ends the token.
pub struct NoticeLink {
    token: i32,
    hub: Arc<NoticeHub>,
    published: AtomicBool,
}

impl NoticeLink {
    pub fn bind(hub: Arc<NoticeHub>, token: i32) -> NoticeLink {
        hub.bind(token);
        NoticeLink { token, hub, published: AtomicBool::new(false) }
    }

    pub fn visibility(&self) -> Visibility {
        self.hub.visibility()
    }

    pub fn decide(
        &self,
        outcome: ReplyOutcome,
        detail: Option<ReplyDetail>,
        status: Option<u16>,
        stored: bool,
    ) -> Decision {
        self.hub.decide(self.token, outcome, detail, status, stored)
    }

    /// Publishes once; later calls and the drop do nothing.
    pub fn publish(&self, code: i32) {
        if !self.published.swap(true, Ordering::SeqCst) {
            self.hub.publish(self.token, code);
        }
    }
}

impl Drop for NoticeLink {
    fn drop(&mut self) {
        self.publish(CODE_QUIET);
    }
}

/// Runs one JNI body: a panic gives -1 instead of unwinding into the JVM.
#[cfg(any(target_os = "android", test))]
pub fn guarded<F: FnOnce() -> i32 + std::panic::UnwindSafe>(body: F) -> i32 {
    std::panic::catch_unwind(body).unwrap_or(-1)
}

/// `setHostVisibility`: 0 unknown, 1 visible, 2 hidden; anything else is -1.
#[cfg(any(target_os = "android", test))]
pub fn set_host_visibility(hub: &NoticeHub, state: i32) -> i32 {
    let visibility = match state {
        0 => Visibility::Unknown,
        1 => Visibility::Visible,
        2 => Visibility::Hidden,
        _ => return -1,
    };
    hub.set_visibility(visibility);
    state
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    const HIDDEN_OPTED: Option<i32> = Some(FLAG_OPTED_IN);

    fn table(outcome: ReplyOutcome, detail: Option<ReplyDetail>, status: Option<u16>, stored: bool) -> i32 {
        announce(outcome, detail, status, stored, Visibility::Hidden, HIDDEN_OPTED)
    }

    // R1, guard: the decision table, every row behind the visibility/armed gate.
    #[test]
    fn announce_table() {
        use ReplyDetail::*;
        use ReplyOutcome::*;
        assert_eq!(table(Done, None, Some(200), true), CODE_DONE);
        assert_eq!(table(Done, None, Some(299), true), CODE_DONE);
        assert_eq!(table(Done, None, Some(500), true), CODE_FAILED);
        assert_eq!(table(Done, None, Some(404), true), CODE_FAILED);
        assert_eq!(table(Done, None, Some(301), true), CODE_FAILED);
        assert_eq!(table(Done, None, None, true), CODE_QUIET);
        assert_eq!(table(Done, None, Some(200), false), CODE_QUIET);
        assert_eq!(table(Failed, Some(Transport), None, false), CODE_FAILED);
        assert_eq!(table(Failed, Some(Transport), Some(200), false), CODE_FAILED);
        assert_eq!(table(Failed, Some(BodyNotStored), Some(200), false), CODE_QUIET);
        assert_eq!(table(Failed, Some(BodyTooLarge), Some(200), false), CODE_QUIET);
        assert_eq!(table(Failed, None, Some(200), false), CODE_QUIET);
        assert_eq!(table(Stopped, None, None, false), CODE_QUIET);
        // A 200 with a non-JSON stored body is still "done" here (the page judges it on return).
        assert_eq!(table(Done, None, Some(200), true), CODE_DONE);

        // Visible, unknown, unarmed and not opted in: quiet for every announceable row.
        for visibility in [Visibility::Visible, Visibility::Unknown] {
            assert_eq!(announce(Done, None, Some(200), true, visibility, HIDDEN_OPTED), CODE_QUIET);
            assert_eq!(announce(Done, None, Some(500), true, visibility, HIDDEN_OPTED), CODE_QUIET);
            assert_eq!(announce(Failed, Some(Transport), None, false, visibility, HIDDEN_OPTED), CODE_QUIET);
        }
        for flags in [None, Some(0), Some(2)] {
            assert_eq!(announce(Done, None, Some(200), true, Visibility::Hidden, flags), CODE_QUIET);
            assert_eq!(announce(Done, None, Some(500), true, Visibility::Hidden, flags), CODE_QUIET);
            assert_eq!(announce(Failed, Some(Transport), None, false, Visibility::Hidden, flags), CODE_QUIET);
        }
        assert_eq!(announce(Done, None, Some(200), true, Visibility::Hidden, Some(3)), CODE_DONE);
    }

    fn decide_done(hub: &NoticeHub, token: i32) -> Decision {
        hub.decide(token, ReplyOutcome::Done, None, Some(200), true)
    }

    // R9, guard: arm/bind order, polls, disarm, cap.
    #[test]
    fn hub_state_machine() {
        let hub = NoticeHub::new();
        hub.set_visibility(Visibility::Hidden);

        // arm then bind: the flags survive, the entry polls pending, one code is taken once.
        assert_eq!(hub.arm(7, FLAG_OPTED_IN), POLL_UNBOUND);
        assert_eq!(hub.poll(7), POLL_UNBOUND);
        hub.bind(7);
        assert_eq!(hub.poll(7), POLL_PENDING);
        let decision = decide_done(&hub, 7);
        assert_eq!(decision, Decision { code: CODE_DONE, visibility: Visibility::Hidden });
        assert!(decision.announced());
        assert_eq!(hub.poll(7), POLL_PENDING);
        hub.publish(7, decision.code);
        assert_eq!(hub.poll(7), CODE_DONE);
        assert_eq!(hub.poll(7), POLL_ABSENT);

        // bind then arm: the late flags still announce.
        hub.bind(8);
        assert_eq!(hub.arm(8, FLAG_OPTED_IN), POLL_PENDING);
        assert_eq!(decide_done(&hub, 8).code, CODE_DONE);
        hub.publish(8, CODE_DONE);
        assert_eq!(hub.poll(8), CODE_DONE);

        // A second decision for the same token is quiet and changes nothing.
        hub.bind(9);
        hub.arm(9, FLAG_OPTED_IN);
        assert_eq!(decide_done(&hub, 9).code, CODE_DONE);
        assert_eq!(decide_done(&hub, 9).code, CODE_QUIET);
        hub.publish(9, CODE_DONE);
        hub.publish(9, CODE_QUIET);
        assert_eq!(hub.poll(9), CODE_DONE);

        // A decision for an unbound or absent token is quiet.
        hub.arm(10, FLAG_OPTED_IN);
        assert_eq!(decide_done(&hub, 10).code, CODE_QUIET);
        assert_eq!(hub.poll(10), POLL_UNBOUND);
        assert_eq!(decide_done(&hub, 11).code, CODE_QUIET);
        assert_eq!(hub.len(), 1);
    }

    #[test]
    fn disarm_never_removes_a_bound_token() {
        let hub = NoticeHub::new();
        hub.set_visibility(Visibility::Hidden);

        // An unbound entry is removed.
        hub.arm(1, FLAG_OPTED_IN);
        assert_eq!(hub.arm(1, -1), POLL_ABSENT);
        assert_eq!(hub.poll(1), POLL_ABSENT);

        // A bound entry answers pending and stays, keeping its flags.
        hub.arm(2, FLAG_OPTED_IN);
        hub.bind(2);
        assert_eq!(hub.arm(2, -1), POLL_PENDING);
        assert_eq!(decide_done(&hub, 2).code, CODE_DONE);
        assert_eq!(hub.arm(2, -1), POLL_PENDING);
        hub.publish(2, CODE_DONE);
        assert_eq!(hub.arm(2, -1), CODE_DONE);
        assert_eq!(hub.poll(2), CODE_DONE);

        // Disarmed, then bound and terminal: not announced.
        hub.arm(3, FLAG_OPTED_IN);
        assert_eq!(hub.arm(3, -1), POLL_ABSENT);
        hub.bind(3);
        assert_eq!(decide_done(&hub, 3).code, CODE_QUIET);
        hub.publish(3, CODE_QUIET);
        assert_eq!(hub.poll(3), POLL_ABSENT);

        // A published-quiet armed entry is removed by the disarm.
        hub.arm(4, FLAG_OPTED_IN);
        hub.bind(4);
        hub.set_visibility(Visibility::Visible);
        assert_eq!(decide_done(&hub, 4).code, CODE_QUIET);
        hub.publish(4, CODE_QUIET);
        assert_eq!(hub.arm(4, -1), POLL_ABSENT);
        assert_eq!(hub.len(), 0);

        // Invalid tokens and flags change nothing.
        assert_eq!(hub.arm(0, 1), POLL_ABSENT);
        assert_eq!(hub.arm(-5, 1), POLL_ABSENT);
        assert_eq!(hub.arm(6, -2), POLL_ABSENT);
        assert_eq!(hub.len(), 0);
    }

    #[test]
    fn a_quiet_unarmed_publish_is_removed_and_an_armed_one_waits() {
        let hub = NoticeHub::new();
        hub.bind(1);
        let quiet = hub.decide(1, ReplyOutcome::Stopped, None, None, false);
        assert_eq!(quiet.code, CODE_QUIET);
        hub.publish(1, CODE_QUIET);
        assert_eq!(hub.len(), 0);

        hub.arm(2, FLAG_OPTED_IN);
        hub.bind(2);
        hub.decide(2, ReplyOutcome::Stopped, None, None, false);
        hub.publish(2, CODE_QUIET);
        assert_eq!(hub.len(), 1);
        assert_eq!(hub.poll(2), CODE_QUIET);
    }

    #[test]
    fn the_cap_evicts_unbound_then_quiet_and_never_a_pinned_entry() {
        let hub = NoticeHub::new();
        hub.set_visibility(Visibility::Hidden);
        // One announced entry and one deciding entry are pinned among unbound ones.
        hub.arm(1, FLAG_OPTED_IN);
        hub.bind(1);
        decide_done(&hub, 1);
        hub.publish(1, CODE_DONE);
        hub.arm(2, FLAG_OPTED_IN);
        hub.bind(2);
        decide_done(&hub, 2);
        for token in 3..=(HUB_CAP as i32) {
            assert_eq!(hub.arm(token, FLAG_OPTED_IN), POLL_UNBOUND);
        }
        assert_eq!(hub.len(), HUB_CAP);

        // A new token evicts the oldest unbound one (3), not the pinned entries.
        assert_eq!(hub.arm(100, FLAG_OPTED_IN), POLL_UNBOUND);
        assert_eq!(hub.len(), HUB_CAP);
        assert_eq!(hub.poll(3), POLL_ABSENT);
        assert_eq!(hub.poll(4), POLL_UNBOUND);
        assert_eq!(hub.poll(1), CODE_DONE);
        assert_eq!(hub.poll(2), POLL_PENDING);

        // With only pinned entries left, a new arm fails and a bind decides quiet.
        let full = NoticeHub::new();
        full.set_visibility(Visibility::Hidden);
        for token in 1..=(HUB_CAP as i32) {
            full.arm(token, FLAG_OPTED_IN);
            full.bind(token);
        }
        assert_eq!(full.arm(500, FLAG_OPTED_IN), POLL_ABSENT);
        // A deciding entry is pinned too: its end is being written.
        assert_eq!(decide_done(&full, 1).code, CODE_DONE);
        assert_eq!(full.arm(500, FLAG_OPTED_IN), POLL_ABSENT);
        full.publish(1, CODE_DONE);
        assert_eq!(full.poll(1), CODE_DONE);
        full.bind(501);
        assert_eq!(decide_done(&full, 501).code, CODE_QUIET);
        assert_eq!(full.len(), HUB_CAP);

        // A published-quiet armed entry is evictable once no unbound one remains.
        let quiet = NoticeHub::new();
        quiet.set_visibility(Visibility::Hidden);
        for token in 1..=(HUB_CAP as i32) {
            quiet.arm(token, FLAG_OPTED_IN);
            quiet.bind(token);
        }
        quiet.decide(1, ReplyOutcome::Stopped, None, None, false);
        quiet.publish(1, CODE_QUIET);
        assert_eq!(quiet.arm(500, FLAG_OPTED_IN), POLL_UNBOUND);
        assert_eq!(quiet.poll(1), POLL_ABSENT);
    }

    // R8, guard: dropping the link without a publish ends the token quietly.
    #[test]
    fn a_dropped_link_publishes_quiet() {
        let hub = Arc::new(NoticeHub::new());
        hub.arm(5, FLAG_OPTED_IN);
        let link = NoticeLink::bind(hub.clone(), 5);
        assert_eq!(hub.poll(5), POLL_PENDING);
        drop(link);
        assert_eq!(hub.poll(5), CODE_QUIET);

        // After a deciding step (an unwind between decide and publish) too.
        hub.set_visibility(Visibility::Hidden);
        hub.arm(6, FLAG_OPTED_IN);
        let link = NoticeLink::bind(hub.clone(), 6);
        assert_eq!(link.decide(ReplyOutcome::Done, None, Some(200), true).code, CODE_DONE);
        drop(link);
        assert_eq!(hub.poll(6), CODE_QUIET);

        // A publish wins over the drop, and the drop of an unarmed link leaves nothing.
        hub.arm(7, FLAG_OPTED_IN);
        let link = NoticeLink::bind(hub.clone(), 7);
        link.decide(ReplyOutcome::Done, None, Some(200), true);
        link.publish(CODE_DONE);
        drop(link);
        assert_eq!(hub.poll(7), CODE_DONE);
        drop(NoticeLink::bind(hub.clone(), 8));
        assert_eq!(hub.len(), 0);
    }

    #[test]
    fn a_panic_in_a_jni_body_gives_minus_one() {
        assert_eq!(guarded(|| 5), 5);
        assert_eq!(guarded(|| panic!("boom")), -1);
        let hub = NoticeHub::new();
        assert_eq!(set_host_visibility(&hub, 2), 2);
        assert_eq!(hub.visibility(), Visibility::Hidden);
        assert_eq!(set_host_visibility(&hub, 1), 1);
        assert_eq!(hub.visibility(), Visibility::Visible);
        assert_eq!(set_host_visibility(&hub, 9), -1);
        assert_eq!(hub.visibility(), Visibility::Visible);
        assert_eq!(set_host_visibility(&hub, 0), 0);
        assert_eq!(hub.visibility(), Visibility::Unknown);
    }

    #[test]
    fn a_poisoned_hub_lock_is_recovered() {
        let hub = Arc::new(NoticeHub::new());
        let poisoner = hub.clone();
        let _ = thread::spawn(move || {
            let _held = poisoner.state.lock().unwrap();
            panic!("poison the hub lock");
        })
        .join();
        assert_eq!(hub.arm(1, FLAG_OPTED_IN), POLL_UNBOUND);
        assert_eq!(hub.poll(1), POLL_UNBOUND);
    }

    #[test]
    fn the_poll_answers_while_another_thread_holds_no_lock_across_a_step() {
        let hub = Arc::new(NoticeHub::new());
        let (tx, rx) = mpsc::channel();
        let poller = hub.clone();
        hub.bind(3);
        thread::spawn(move || {
            let _ = tx.send(poller.poll(3));
        });
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(POLL_PENDING));
    }
}
