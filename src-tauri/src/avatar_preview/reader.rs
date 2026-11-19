//! The two guards of the reader stack.
//!
//! `InnerGuard` sits directly over the file, under the `BufReader`: it checks the stop
//! token before every OS read or seek, caps every OS read at `BUF`, retries `Interrupted`
//! itself (each pass checks first), and records any other I/O error as trip 3 at the
//! source. It overrides only `read` and `seek`; every other `Read`/`Seek` method of the
//! standard library defaults to those two, so no unchecked path exists.
//!
//! `OuterGuard` is the only reader a decoder is built on: it checks the token on every
//! `read`, `fill_buf` and `seek` and returns errors from below unchanged (no
//! classification). It overrides only `read`, `fill_buf`, `consume` and `seek`.

use std::io::{self, BufRead, Read, Seek, SeekFrom};
use std::sync::Arc;

use super::stop::StopToken;

/// The `BufReader` capacity and the largest single OS read.
pub const BUF: usize = 64 * 1024;

pub struct InnerGuard<R> {
    inner: R,
    tok: Arc<StopToken>,
}

impl<R> InnerGuard<R> {
    pub fn new(inner: R, tok: Arc<StopToken>) -> InnerGuard<R> {
        InnerGuard { inner, tok }
    }
}

impl<R: Read> Read for InnerGuard<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = buf.len().min(BUF);
        loop {
            self.tok.check()?;
            match self.inner.read(&mut buf[..n]) {
                Ok(k) => return Ok(k),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    self.tok.trip_io();
                    return Err(e);
                }
            }
        }
    }
}

impl<R: Seek> Seek for InnerGuard<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        loop {
            self.tok.check()?;
            match self.inner.seek(pos) {
                Ok(p) => return Ok(p),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => {
                    self.tok.trip_io();
                    return Err(e);
                }
            }
        }
    }
}

pub struct OuterGuard<R> {
    inner: R,
    tok: Arc<StopToken>,
}

impl<R> OuterGuard<R> {
    pub fn new(inner: R, tok: Arc<StopToken>) -> OuterGuard<R> {
        OuterGuard { inner, tok }
    }
}

impl<R: Read> Read for OuterGuard<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.tok.check()?;
        self.inner.read(buf)
    }
}

impl<R: BufRead> BufRead for OuterGuard<R> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        self.tok.check()?;
        self.inner.fill_buf()
    }

    fn consume(&mut self, amt: usize) {
        self.inner.consume(amt)
    }
}

impl<R: Seek> Seek for OuterGuard<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.tok.check()?;
        self.inner.seek(pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    struct Counting<R> {
        inner: R,
        calls: Arc<AtomicUsize>,
        max_req: Arc<AtomicUsize>,
    }
    impl<R: Read> Read for Counting<R> {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            self.max_req.fetch_max(buf.len(), Ordering::Relaxed);
            self.inner.read(buf)
        }
    }

    #[test]
    fn inner_read_is_capped_at_buf() {
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        let calls = Arc::new(AtomicUsize::new(0));
        let max_req = Arc::new(AtomicUsize::new(0));
        let src = Counting { inner: Cursor::new(vec![7u8; 4 << 20]), calls: calls.clone(), max_req: max_req.clone() };
        let mut g = InnerGuard::new(src, tok);
        let mut big = vec![0u8; 1 << 20];
        let n = g.read(&mut big).unwrap();
        assert_eq!(n, BUF);
        assert_eq!(max_req.load(Ordering::Relaxed), BUF);
    }

    #[test]
    fn std_bufreader_large_read_reaches_the_source_capped() {
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        let max_req = Arc::new(AtomicUsize::new(0));
        let src = Counting { inner: Cursor::new(vec![1u8; 4 << 20]), calls: Arc::new(AtomicUsize::new(0)), max_req: max_req.clone() };
        let mut br = io::BufReader::with_capacity(61, InnerGuard::new(src, tok));
        let mut big = vec![0u8; 1 << 20];
        let _ = br.read(&mut big).unwrap();
        assert!(max_req.load(Ordering::Relaxed) <= BUF);
    }

    struct Flaky {
        interrupts: usize,
        data: Cursor<Vec<u8>>,
    }
    impl Read for Flaky {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.interrupts > 0 {
                self.interrupts -= 1;
                return Err(io::ErrorKind::Interrupted.into());
            }
            self.data.read(buf)
        }
    }

    #[test]
    fn interrupted_is_retried_and_not_recorded() {
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        let mut g = InnerGuard::new(Flaky { interrupts: 3, data: Cursor::new(vec![9, 9]) }, tok.clone());
        let mut b = [0u8; 2];
        assert_eq!(g.read(&mut b).unwrap(), 2);
        assert_eq!(tok.tripped(), 0);
    }

    #[test]
    fn interrupted_retry_still_checks_the_flag() {
        let cancel = Arc::new(AtomicBool::new(false));
        let tok = StopToken::new(cancel.clone());
        struct AlwaysIntr(Arc<AtomicBool>, usize);
        impl Read for AlwaysIntr {
            fn read(&mut self, _b: &mut [u8]) -> io::Result<usize> {
                self.1 += 1;
                if self.1 == 5 {
                    self.0.store(true, Ordering::Relaxed);
                }
                Err(io::ErrorKind::Interrupted.into())
            }
        }
        let mut g = InnerGuard::new(AlwaysIntr(cancel, 0), tok.clone());
        let mut b = [0u8; 4];
        assert!(g.read(&mut b).is_err());
        assert_eq!(tok.tripped(), super::super::stop::TRIP_CANCEL);
    }

    #[test]
    fn other_errors_are_recorded_as_io() {
        struct Bad;
        impl Read for Bad {
            fn read(&mut self, _b: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::Other, "disk"))
            }
        }
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        let mut g = InnerGuard::new(Bad, tok.clone());
        assert!(g.read(&mut [0u8; 4]).is_err());
        assert_eq!(tok.tripped(), super::super::stop::TRIP_IO);
    }

    #[test]
    fn outer_guard_after_trip_makes_one_call_and_no_inner_call() {
        let cancel = Arc::new(AtomicBool::new(true));
        let tok = StopToken::new(cancel);
        let calls = Arc::new(AtomicUsize::new(0));
        let src = Counting { inner: Cursor::new(vec![0u8; 100]), calls: calls.clone(), max_req: Arc::new(AtomicUsize::new(0)) };
        let mut outer = OuterGuard::new(src, tok);
        let mut b = [0u8; 8];
        // The cap lives in this caller-side wrapper: an `Interrupted` stop would loop in
        // read_exact and trip it instead of hanging.
        let mut wrapper_calls = 0usize;
        struct Wrap<'a, R> { r: &'a mut R, n: &'a mut usize }
        impl<R: Read> Read for Wrap<'_, R> {
            fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
                *self.n += 1;
                assert!(*self.n < 1000, "stop error was retried");
                self.r.read(buf)
            }
        }
        let mut w = Wrap { r: &mut outer, n: &mut wrapper_calls };
        let e = w.read_exact(&mut b).unwrap_err();
        assert_ne!(e.kind(), io::ErrorKind::Interrupted);
        assert_eq!(wrapper_calls, 1);
        assert_eq!(calls.load(Ordering::Relaxed), 0);
    }

    // The decoders pull through `fill_buf`, so it must check the token itself: a source that
    // never fails would otherwise hand out bytes after a stop.
    #[test]
    fn outer_guard_fill_buf_checks_the_token() {
        let tok = StopToken::new(Arc::new(AtomicBool::new(true)));
        let mut outer = OuterGuard::new(Cursor::new(vec![1u8, 2, 3]), tok.clone());
        let e = outer.fill_buf().unwrap_err();
        assert_ne!(e.kind(), io::ErrorKind::Interrupted);
        assert_eq!(tok.tripped(), super::super::stop::TRIP_CANCEL);
    }
}
