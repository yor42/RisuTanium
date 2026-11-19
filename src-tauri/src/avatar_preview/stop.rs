//! The stop token: two atomic flags (cancel, deadline) and the first recorded trip.
//!
//! `check()` never reads the clock. The deadline flag is set by the watchdog thread
//! (see `slot.rs`) at running time; a cancel is set by `avatar_preview_cancel` or by an
//! orphan takeover. Once any trip is recorded every later `check()` fails the same way.
//! The error kind is `Other`, never `Interrupted`: `read_exact` and `io::copy` retry
//! `Interrupted` for ever, so a stop reported that way would never end a decoder's loop.

use std::io;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;

pub const TRIP_NONE: u8 = 0;
pub const TRIP_CANCEL: u8 = 1;
pub const TRIP_DEADLINE: u8 = 2;
pub const TRIP_IO: u8 = 3;

pub struct StopToken {
    cancel: Arc<AtomicBool>,
    deadline: Arc<AtomicBool>,
    tripped: AtomicU8,
    /// Test seam: sets the deadline flag at the n-th `check()` (0 = off).
    #[cfg(test)]
    pub fire_at: std::sync::atomic::AtomicUsize,
    #[cfg(test)]
    pub checks: std::sync::atomic::AtomicUsize,
}

impl StopToken {
    pub fn new(cancel: Arc<AtomicBool>) -> Arc<StopToken> {
        Arc::new(StopToken {
            cancel,
            deadline: Arc::new(AtomicBool::new(false)),
            tripped: AtomicU8::new(TRIP_NONE),
            #[cfg(test)]
            fire_at: std::sync::atomic::AtomicUsize::new(0),
            #[cfg(test)]
            checks: std::sync::atomic::AtomicUsize::new(0),
        })
    }

    /// The flag the watchdog (or a test) sets to report the deadline.
    pub fn deadline_flag(&self) -> Arc<AtomicBool> {
        self.deadline.clone()
    }

    fn record(&self, code: u8) {
        let _ = self
            .tripped
            .compare_exchange(TRIP_NONE, code, Ordering::Relaxed, Ordering::Relaxed);
    }

    /// Fails when a flag is set or a trip was recorded. Deadline is reported before
    /// cancel, so a job that ran past its deadline is reported as a deadline.
    pub fn check(&self) -> io::Result<()> {
        #[cfg(test)]
        {
            let n = self.checks.fetch_add(1, Ordering::Relaxed) + 1;
            if n == self.fire_at.load(Ordering::Relaxed) {
                self.deadline.store(true, Ordering::Relaxed);
            }
        }
        if self.deadline.load(Ordering::Relaxed) {
            self.record(TRIP_DEADLINE);
        } else if self.cancel.load(Ordering::Relaxed) {
            self.record(TRIP_CANCEL);
        }
        if self.tripped.load(Ordering::Relaxed) != TRIP_NONE {
            return Err(io::Error::new(io::ErrorKind::Other, "avatar-preview stop"));
        }
        Ok(())
    }

    /// Records a source I/O failure (only the inner guard calls this).
    pub fn trip_io(&self) {
        self.record(TRIP_IO);
    }

    pub fn tripped(&self) -> u8 {
        self.tripped.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_beats_cancel_and_first_trip_wins() {
        let cancel = Arc::new(AtomicBool::new(true));
        let tok = StopToken::new(cancel);
        tok.deadline_flag().store(true, Ordering::Relaxed);
        assert!(tok.check().is_err());
        assert_eq!(tok.tripped(), TRIP_DEADLINE);
        tok.trip_io();
        assert_eq!(tok.tripped(), TRIP_DEADLINE);
    }

    #[test]
    fn io_trip_keeps_failing_and_is_not_interrupted() {
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        assert!(tok.check().is_ok());
        tok.trip_io();
        let e = tok.check().unwrap_err();
        assert_ne!(e.kind(), io::ErrorKind::Interrupted);
        assert_eq!(tok.tripped(), TRIP_IO);
        assert!(tok.check().is_err());
    }
}
