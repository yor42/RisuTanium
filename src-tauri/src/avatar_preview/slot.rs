//! The global decode slot, ticket registry and per-job watchdog.
//!
//! One native decode runs per process. The page runs one native call at a time, so a
//! caller that finds the slot held treats the holder as an orphan of an earlier page:
//! it sets the holder's cancel flag and waits a bounded time for the slot, otherwise
//! `Busy` (transient). The watchdog thread counts running time: a step in which the
//! clock jumped (a process freeze or a device sleep) is charged at most twice its
//! length (at most 200 ms per freeze), so frozen time cannot make up the deadline. The same
//! clip discards scheduler delay above twice a step, so a watchdog thread starved of CPU
//! stretches the deadline in wall time; the page's hard timer then ends such a job as a
//! transient result, never as a wrong persisted skip.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::stop::StopToken;
use super::Transient;

/// MC-2178: the native deadline counts running time (MC-2222).
pub const DEADLINE: Duration = Duration::from_secs(10);
pub const WATCHDOG_STEP: Duration = Duration::from_millis(100);
pub const ORPHAN_WAIT: Duration = Duration::from_secs(2);
/// Cancels that overtook their command are remembered up to this many.
pub const PRE_CANCEL_CAP: usize = 64;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

pub struct SlotState {
    holder: Mutex<Option<Arc<AtomicBool>>>,
    cv: Condvar,
}

pub struct SlotGuard<'a> {
    slot: &'a SlotState,
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        *lock(&self.slot.holder) = None;
        self.slot.cv.notify_all();
    }
}

impl SlotState {
    pub const fn new() -> SlotState {
        SlotState { holder: Mutex::new(None), cv: Condvar::new() }
    }

    /// Takes the slot, cancelling an orphaned holder and waiting up to `wait`.
    pub fn acquire(&self, cancel: &Arc<AtomicBool>, wait: Duration) -> Result<SlotGuard<'_>, Transient> {
        let end = Instant::now() + wait;
        let mut g = lock(&self.holder);
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(Transient::Cancelled);
            }
            match g.as_ref() {
                None => {
                    *g = Some(cancel.clone());
                    return Ok(SlotGuard { slot: self });
                }
                Some(holder) => holder.store(true, Ordering::Relaxed),
            }
            let now = Instant::now();
            if now >= end {
                return Err(Transient::Busy);
            }
            let step = (end - now).min(Duration::from_millis(20));
            g = self.cv.wait_timeout(g, step).unwrap_or_else(|p| p.into_inner()).0;
        }
    }
}

pub static GLOBAL_SLOT: SlotState = SlotState::new();

#[derive(Default)]
struct TicketState {
    live: HashMap<u64, Arc<AtomicBool>>,
    pre: VecDeque<u64>,
}

#[derive(Default)]
pub struct Tickets {
    state: Mutex<TicketState>,
}

pub struct TicketGuard<'a> {
    tickets: &'a Tickets,
    ticket: u64,
    pub flag: Arc<AtomicBool>,
}

impl Drop for TicketGuard<'_> {
    fn drop(&mut self) {
        lock(&self.tickets.state).live.remove(&self.ticket);
    }
}

impl Tickets {
    pub fn register(&self, ticket: u64) -> TicketGuard<'_> {
        let flag = Arc::new(AtomicBool::new(false));
        let mut st = lock(&self.state);
        if let Some(pos) = st.pre.iter().position(|&t| t == ticket) {
            st.pre.remove(pos);
            flag.store(true, Ordering::Relaxed);
        }
        st.live.insert(ticket, flag.clone());
        TicketGuard { tickets: self, ticket, flag }
    }

    /// Sets the ticket's flag, or remembers a cancel that arrived before its command.
    pub fn cancel(&self, ticket: u64) {
        let mut st = lock(&self.state);
        if let Some(flag) = st.live.get(&ticket) {
            flag.store(true, Ordering::Relaxed);
        } else {
            if st.pre.len() >= PRE_CANCEL_CAP {
                st.pre.pop_front();
            }
            st.pre.push_back(ticket);
        }
    }

    pub fn pre_cancel_len(&self) -> usize {
        lock(&self.state).pre.len()
    }
}

pub fn global_tickets() -> &'static Tickets {
    static T: OnceLock<Tickets> = OnceLock::new();
    T.get_or_init(Tickets::default)
}

/// Running-time accounting: a step is charged at most twice its nominal length.
pub fn account(step_elapsed: Duration, step: Duration) -> Duration {
    step_elapsed.min(step * 2)
}

pub enum Wait {
    Timeout,
    Disconnected,
}

/// The watchdog's loop. `true` when the running time reached `deadline`; `false` when
/// the job ended first (the wait reported a disconnect).
pub fn watchdog_loop(
    deadline: Duration,
    step: Duration,
    clock: &dyn Fn() -> Instant,
    wait: &mut dyn FnMut(Duration) -> Wait,
) -> bool {
    let mut ran = Duration::ZERO;
    loop {
        let t0 = clock();
        match wait(step) {
            Wait::Disconnected => return false,
            Wait::Timeout => {
                let t1 = clock();
                ran += account(t1.saturating_duration_since(t0), step);
                if ran >= deadline {
                    return true;
                }
            }
        }
    }
}

pub type FireHook = Arc<dyn Fn() + Send + Sync>;

pub struct JobCfg {
    pub deadline: Duration,
    pub step: Duration,
    pub orphan_wait: Duration,
    pub on_fire: Option<FireHook>,
}

impl JobCfg {
    pub fn production() -> JobCfg {
        JobCfg { deadline: DEADLINE, step: WATCHDOG_STEP, orphan_wait: ORPHAN_WAIT, on_fire: None }
    }
}

/// Created right after the slot is taken. Dropping it drops the sender and joins the
/// thread, on every exit path including an unwind.
pub struct WatchdogGuard {
    tx: Option<Sender<()>>,
    handle: Option<JoinHandle<()>>,
}

impl WatchdogGuard {
    pub fn spawn(flag: Arc<AtomicBool>, cfg: &JobCfg) -> std::io::Result<WatchdogGuard> {
        let (tx, rx) = mpsc::channel::<()>();
        let (deadline, step) = (cfg.deadline, cfg.step);
        let hook = cfg.on_fire.clone();
        let handle = std::thread::Builder::new().name("avatar-preview-deadline".into()).spawn(move || {
            let fired = watchdog_loop(deadline, step, &Instant::now, &mut |d| match rx.recv_timeout(d) {
                Err(RecvTimeoutError::Timeout) => Wait::Timeout,
                _ => Wait::Disconnected,
            });
            if fired {
                if let Some(h) = hook {
                    h();
                }
                flag.store(true, Ordering::Relaxed);
            }
        })?;
        Ok(WatchdogGuard { tx: Some(tx), handle: Some(handle) })
    }

    pub fn is_finished(&self) -> bool {
        self.handle.as_ref().map_or(true, |h| h.is_finished())
    }
}

impl Drop for WatchdogGuard {
    fn drop(&mut self) {
        self.tx.take();
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Runs `f` holding the slot with a watchdog; the watchdog is joined before the slot is released.
pub fn run_job<T>(
    slot: &SlotState,
    cancel: Arc<AtomicBool>,
    cfg: &JobCfg,
    f: impl FnOnce(Arc<StopToken>) -> T,
) -> Result<T, Transient> {
    let _slot = slot.acquire(&cancel, cfg.orphan_wait)?;
    let tok = StopToken::new(cancel);
    let _wd = WatchdogGuard::spawn(tok.deadline_flag(), cfg).map_err(|_| Transient::Io("watchdog".to_string()))?;
    Ok(f(tok))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::sync::atomic::AtomicUsize;

    fn flag() -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(false))
    }

    #[test]
    fn orphan_holder_is_cancelled_and_new_job_acquires() {
        let slot = SlotState::new();
        let holder_cancel = flag();
        let g = slot.acquire(&holder_cancel, Duration::from_millis(100)).unwrap();
        std::thread::scope(|s| {
            let hc = holder_cancel.clone();
            s.spawn(move || {
                while !hc.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                drop(g);
            });
            let got = slot.acquire(&flag(), Duration::from_secs(5));
            assert!(got.is_ok());
            assert!(holder_cancel.load(Ordering::Relaxed));
        });
    }

    #[test]
    fn holder_that_ignores_its_flag_gives_busy() {
        let slot = SlotState::new();
        let _g = slot.acquire(&flag(), Duration::from_millis(10)).unwrap();
        let t0 = Instant::now();
        assert!(matches!(slot.acquire(&flag(), Duration::from_millis(100)), Err(Transient::Busy)));
        assert!(t0.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn own_cancel_during_the_wait_returns_cancelled() {
        let slot = SlotState::new();
        let _g = slot.acquire(&flag(), Duration::from_millis(10)).unwrap();
        let mine = flag();
        mine.store(true, Ordering::Relaxed);
        assert!(matches!(slot.acquire(&mine, Duration::from_secs(5)), Err(Transient::Cancelled)));
    }

    #[test]
    fn cancel_before_its_command_is_remembered() {
        let t = Tickets::default();
        t.cancel(7);
        let g = t.register(7);
        assert!(g.flag.load(Ordering::Relaxed));
        assert_eq!(t.pre_cancel_len(), 0);
        let g2 = t.register(8);
        t.cancel(8);
        assert!(g2.flag.load(Ordering::Relaxed));
        drop(g2);
        // A finished ticket is gone: cancelling it again is only remembered.
        t.cancel(8);
        assert_eq!(t.pre_cancel_len(), 1);
    }

    #[test]
    fn pre_cancel_queue_is_capped() {
        let t = Tickets::default();
        for i in 0..(PRE_CANCEL_CAP as u64 + 10) {
            t.cancel(i);
        }
        assert_eq!(t.pre_cancel_len(), PRE_CANCEL_CAP);
        // The oldest were dropped.
        let g = t.register(0);
        assert!(!g.flag.load(Ordering::Relaxed));
        let g = t.register(PRE_CANCEL_CAP as u64 + 9);
        assert!(g.flag.load(Ordering::Relaxed));
    }

    // RS-W: the injected clock jumps a whole minute in one step.
    fn drive(script: &[Duration], step: Duration, deadline: Duration) -> (bool, usize) {
        let base = Instant::now();
        let now = Cell::new(Duration::ZERO);
        let idx = Cell::new(0usize);
        let clock = || base + now.get();
        let mut wait = |_d: Duration| {
            let i = idx.get();
            if i >= script.len() {
                return Wait::Disconnected;
            }
            idx.set(i + 1);
            now.set(now.get() + script[i]);
            Wait::Timeout
        };
        let fired = watchdog_loop(deadline, step, &clock, &mut wait);
        (fired, idx.get())
    }

    #[test]
    fn running_time_ticks_fire_at_the_deadline_and_not_before() {
        let step = Duration::from_millis(100);
        let script = vec![step; 200];
        let (fired, n) = drive(&script, step, Duration::from_secs(10));
        assert!(fired);
        assert_eq!(n, 100, "100 steps of 100 ms reach 10 s");
        let (fired, _) = drive(&script[..99], step, Duration::from_secs(10));
        assert!(!fired, "99 steps stay under 10 s");
    }

    #[test]
    fn a_frozen_step_is_not_charged_more_than_twice_its_length() {
        let step = Duration::from_millis(100);
        let mut script = vec![step; 50];
        script.push(Duration::from_secs(60)); // a 60 s freeze inside one step
        script.extend(vec![step; 100]);
        let (fired, n) = drive(&script[..51], step, Duration::from_secs(10));
        assert!(!fired, "the freeze step alone must not fire");
        assert_eq!(n, 51);
        let (fired, n) = drive(&script, step, Duration::from_secs(10));
        assert!(fired);
        // 50 steps (5.0 s) + 0.2 s for the frozen step, then 48 more steps of 0.1 s: 98 steps after the freeze
        assert_eq!(n, 50 + 1 + 48);
    }

    #[test]
    fn watchdog_is_joined_and_never_fires_when_the_job_ends_first() {
        let cfg = JobCfg { deadline: Duration::from_millis(500), step: Duration::from_millis(10), orphan_wait: Duration::from_millis(10), on_fire: None };
        let f = flag();
        let wd = WatchdogGuard::spawn(f.clone(), &cfg).unwrap();
        std::thread::sleep(Duration::from_millis(20));
        drop(wd);
        assert!(!f.load(Ordering::Relaxed));
    }

    #[test]
    fn watchdog_sets_the_flag_after_the_deadline() {
        let cfg = JobCfg { deadline: Duration::from_millis(100), step: Duration::from_millis(10), orphan_wait: Duration::from_millis(10), on_fire: None };
        let f = flag();
        let wd = WatchdogGuard::spawn(f.clone(), &cfg).unwrap();
        let t0 = Instant::now();
        while !f.load(Ordering::Relaxed) {
            assert!(t0.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(5));
        }
        drop(wd);
    }

    #[test]
    fn watchdog_is_joined_after_a_panic() {
        let cfg = JobCfg { deadline: Duration::from_secs(5), step: Duration::from_millis(10), orphan_wait: Duration::from_millis(10), on_fire: None };
        let f = flag();
        let seen = Arc::new(AtomicUsize::new(0));
        let s2 = seen.clone();
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let wd = WatchdogGuard::spawn(f.clone(), &cfg).unwrap();
            let _ = &wd;
            s2.store(1, Ordering::Relaxed);
            panic!("injected");
        }));
        assert!(r.is_err());
        assert_eq!(seen.load(Ordering::Relaxed), 1);
        // The thread was joined during the unwind; the flag was never set.
        assert!(!f.load(Ordering::Relaxed));
    }

    // Dropping the guard joins the thread: the closure's last hook reference is released by
    // the watchdog thread itself, and its slow drop must have finished when `drop(wd)` returns.
    #[test]
    fn dropping_the_guard_waits_for_the_watchdog_thread() {
        struct SlowDrop(Arc<AtomicBool>);
        impl Drop for SlowDrop {
            fn drop(&mut self) {
                std::thread::sleep(Duration::from_millis(150));
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let released = flag();
        let sentinel = SlowDrop(released.clone());
        let hook: FireHook = Arc::new(move || {
            let _ = &sentinel;
        });
        let cfg = JobCfg { deadline: Duration::from_secs(60), step: Duration::from_millis(10), orphan_wait: Duration::from_millis(10), on_fire: Some(hook) };
        let wd = WatchdogGuard::spawn(flag(), &cfg).unwrap();
        // The thread now holds the only reference to the hook.
        drop(cfg);
        assert!(!released.load(Ordering::SeqCst));
        drop(wd);
        assert!(released.load(Ordering::SeqCst), "the guard returned before the thread ended");
    }

    #[test]
    fn run_job_releases_the_slot() {
        let slot = SlotState::new();
        let cfg = JobCfg { deadline: Duration::from_secs(5), step: Duration::from_millis(10), orphan_wait: Duration::from_millis(50), on_fire: None };
        let out = run_job(&slot, flag(), &cfg, |tok| tok.check().is_ok()).unwrap();
        assert!(out);
        assert!(slot.acquire(&flag(), Duration::from_millis(10)).is_ok());
    }
}
