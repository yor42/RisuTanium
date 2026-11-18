//! Canonicalising allowlist filter between the file and `jpeg-decoder`.
//!
//! The decoder only ever sees bytes this filter validated and re-emitted as whole units:
//! SOI, one validated SOF0/1/2, complete DHT/DQT/DRI segments, validated SOS headers
//! followed by entropy bytes (with `FF 00` and `FF D0-D7` kept as pairs), a canonical
//! JFIF and AVI1 APP0 (first of each) and canonical Adobe APP14 segments (they decide
//! the colour transform), and EOI. Fill bytes, garbage between segments, lone `FF`,
//! `FF 00` outside entropy data and every other segment (APP1-APP13, APP15, COM, ...)
//! are consumed and never emitted, so the decoder never holds Exif, ICC or XMP payloads.
//!
//! The filter has no stop token and no check sites: errors from the reader below are
//! returned unchanged. Every iteration of its input loop consumes at least one input
//! byte or returns. All state lives in the struct, so any `fill_buf`/`read` split
//! resumes where it stopped. After a verdict every `read` fails without reading input.

use std::cell::Cell;
use std::io::{self, BufRead, Read};
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use super::peak::{SofComponent, SofInfo, MAX_SCANS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterVerdict {
    Unsupported(&'static str),
    Malformed(&'static str),
    ScanCap,
}

/// What the filter tells the rest of the job.
pub struct FilterShared {
    pub verdict: Cell<Option<FilterVerdict>>,
    pub sof: Cell<Option<SofInfo>>,
    /// SOS headers emitted so far; readable from the watchdog thread.
    pub emitted_scans: Arc<AtomicU32>,
}

impl FilterShared {
    pub fn new() -> Rc<FilterShared> {
        Rc::new(FilterShared {
            verdict: Cell::new(None),
            sof: Cell::new(None),
            emitted_scans: Arc::new(AtomicU32::new(0)),
        })
    }
}

#[derive(Clone, Copy, Debug)]
enum St {
    Start0,
    Start1,
    Marker,
    MarkerFF,
    LenHi(u8),
    LenLo(u8, u8),
    Stage { m: u8, left: usize, tail: usize },
    Skip(usize),
    Entropy,
    EntropyFF,
    Done,
}

const STAGE_LEN: usize = 65_537;

pub struct JpegFilter<R: BufRead> {
    inner: R,
    st: St,
    out: [u8; 16],
    out_len: usize,
    out_pos: usize,
    stage: Box<[u8]>,
    stage_fill: usize,
    stage_out_len: usize,
    stage_out_pos: usize,
    failed: bool,
    jfif_done: bool,
    avi_done: bool,
    scans: u32,
    shared: Rc<FilterShared>,
    #[cfg(test)]
    pub steps: u64,
    #[cfg(test)]
    pub on_sos: Option<Box<dyn FnMut(u32)>>,
}

fn verdict_error() -> io::Error {
    io::Error::new(io::ErrorKind::Other, "jpeg filter verdict")
}

impl<R: BufRead> JpegFilter<R> {
    pub fn new(inner: R, shared: Rc<FilterShared>) -> JpegFilter<R> {
        JpegFilter {
            inner,
            st: St::Start0,
            out: [0; 16],
            out_len: 0,
            out_pos: 0,
            stage: vec![0u8; STAGE_LEN].into_boxed_slice(),
            stage_fill: 0,
            stage_out_len: 0,
            stage_out_pos: 0,
            failed: false,
            jfif_done: false,
            avi_done: false,
            scans: 0,
            shared,
            #[cfg(test)]
            steps: 0,
            #[cfg(test)]
            on_sos: None,
        }
    }

    fn fail(&mut self, v: FilterVerdict) -> io::Error {
        self.failed = true;
        if self.shared.verdict.get().is_none() {
            self.shared.verdict.set(Some(v));
        }
        verdict_error()
    }

    fn pull(&mut self) -> io::Result<Option<u8>> {
        let b = self.inner.fill_buf()?;
        match b.first() {
            None => Ok(None),
            Some(&x) => {
                self.inner.consume(1);
                Ok(Some(x))
            }
        }
    }

    fn queue_out(&mut self, bytes: &[u8]) {
        self.out[..bytes.len()].copy_from_slice(bytes);
        self.out_len = bytes.len();
        self.out_pos = 0;
    }

    fn begin_stage(&mut self, m: u8, len: usize, need: usize, tail: usize) {
        self.stage[0] = 0xFF;
        self.stage[1] = m;
        self.stage[2] = (len >> 8) as u8;
        self.stage[3] = (len & 0xFF) as u8;
        self.stage_fill = 4;
        self.st = St::Stage { m, left: need, tail };
    }

    fn on_code(&mut self, m: u8) -> io::Result<()> {
        match m {
            0xFF => self.st = St::MarkerFF,
            0x00 | 0xD0..=0xD7 => self.st = St::Marker,
            0xD8 => return Err(self.fail(FilterVerdict::Malformed("second SOI"))),
            0xD9 => {
                self.queue_out(&[0xFF, 0xD9]);
                self.st = St::Done;
            }
            0x01..=0xBF => return Err(self.fail(FilterVerdict::Malformed("reserved marker"))),
            0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCC..=0xCF | 0xDE | 0xDF => {
                return Err(self.fail(FilterVerdict::Unsupported("frame type")))
            }
            _ => self.st = St::LenHi(m),
        }
        Ok(())
    }

    fn on_length(&mut self, m: u8, len: usize) -> io::Result<()> {
        if len < 2 {
            return Err(self.fail(FilterVerdict::Malformed("segment length")));
        }
        let payload = len - 2;
        match m {
            0xC0..=0xC2 => {
                if self.shared.sof.get().is_some() {
                    return Err(self.fail(FilterVerdict::Malformed("second SOF")));
                }
                if payload < 6 {
                    return Err(self.fail(FilterVerdict::Malformed("SOF length")));
                }
                self.begin_stage(m, len, payload, 0);
            }
            0xC4 | 0xDB => self.begin_stage(m, len, payload, 0),
            0xDD => {
                if len != 4 {
                    return Err(self.fail(FilterVerdict::Malformed("DRI length")));
                }
                self.begin_stage(m, len, payload, 0);
            }
            0xDA => {
                if self.shared.sof.get().is_none() {
                    return Err(self.fail(FilterVerdict::Malformed("scan before frame")));
                }
                self.begin_stage(m, len, payload, 0);
            }
            0xE0 | 0xEE => {
                let need = payload.min(12);
                self.begin_stage(m, len, need, payload - need);
            }
            _ => {
                self.st = if payload > 0 { St::Skip(payload) } else { St::Marker };
                return Ok(());
            }
        }
        if let St::Stage { m, left: 0, tail } = self.st {
            self.finish_segment(m, tail)?;
        }
        Ok(())
    }

    fn validate_sof(&mut self, m: u8) -> io::Result<()> {
        let p = &self.stage[4..self.stage_fill];
        let prec = p[0];
        let y = u32::from(p[1]) << 8 | u32::from(p[2]);
        let x = u32::from(p[3]) << 8 | u32::from(p[4]);
        let nf = usize::from(p[5]);
        if nf == 0 || nf > 4 || p.len() != 6 + 3 * nf {
            return Err(self.fail(FilterVerdict::Malformed("SOF length")));
        }
        if nf == 2 || nf == 4 {
            return Err(self.fail(FilterVerdict::Unsupported("component count")));
        }
        if prec != 8 {
            return Err(self.fail(FilterVerdict::Unsupported("sample precision")));
        }
        if y == 0 {
            return Err(self.fail(FilterVerdict::Unsupported("height from DNL")));
        }
        if x == 0 {
            return Err(self.fail(FilterVerdict::Malformed("zero width")));
        }
        let mut comps = [SofComponent { id: 0, h: 1, v: 1 }; 3];
        for i in 0..nf {
            let id = p[6 + 3 * i];
            let hv = p[7 + 3 * i];
            let tq = p[8 + 3 * i];
            let (h, v) = (hv >> 4, hv & 15);
            if !(1..=4).contains(&h) || !(1..=4).contains(&v) || tq > 3 {
                return Err(self.fail(FilterVerdict::Malformed("sampling or table")));
            }
            comps[i] = SofComponent { id, h, v };
        }
        self.shared.sof.set(Some(SofInfo { w: x, h: y, ncomp: nf, comps, progressive: m == 0xC2 }));
        Ok(())
    }

    fn validate_sos(&mut self) -> io::Result<()> {
        let sof = self.shared.sof.get();
        let p = &self.stage[4..self.stage_fill];
        let ns = usize::from(*p.first().unwrap_or(&0));
        let ok = (1..=4).contains(&ns) && p.len() == 4 + 2 * ns && sof.is_some_and(|s| {
            (0..ns).all(|i| s.comps[..s.ncomp].iter().any(|c| c.id == p[1 + 2 * i]))
        });
        if !ok {
            return Err(self.fail(FilterVerdict::Malformed("scan header")));
        }
        Ok(())
    }

    fn finish_segment(&mut self, m: u8, tail: usize) -> io::Result<()> {
        match m {
            0xC0..=0xC2 => {
                self.validate_sof(m)?;
                self.emit_stage();
            }
            0xC4 | 0xDB | 0xDD => self.emit_stage(),
            0xDA => {
                self.validate_sos()?;
                self.scans += 1;
                self.shared.emitted_scans.store(self.scans, Ordering::Relaxed);
                if self.scans > MAX_SCANS {
                    return Err(self.fail(FilterVerdict::ScanCap));
                }
                self.emit_stage();
                self.st = St::Entropy;
                #[cfg(test)]
                {
                    let n = self.scans;
                    if let Some(f) = self.on_sos.as_mut() {
                        f(n);
                    }
                }
                return Ok(());
            }
            0xE0 => {
                let p = &self.stage[4..self.stage_fill];
                if p.len() >= 5 && &p[..5] == b"JFIF\0" && !self.jfif_done {
                    self.jfif_done = true;
                    self.queue_out(&[0xFF, 0xE0, 0x00, 0x07, b'J', b'F', b'I', b'F', 0x00]);
                } else if p.len() >= 5 && &p[..5] == b"AVI1\0" && !self.avi_done {
                    self.avi_done = true;
                    self.queue_out(&[0xFF, 0xE0, 0x00, 0x07, b'A', b'V', b'I', b'1', 0x00]);
                }
                self.stage_fill = 0;
            }
            0xEE => {
                let p = &self.stage[4..self.stage_fill];
                if p.len() >= 12 && &p[..6] == b"Adobe\0" && p[11] <= 2 {
                    let mut unit = [0u8; 16];
                    unit[..4].copy_from_slice(&[0xFF, 0xEE, 0x00, 0x0E]);
                    unit[4..].copy_from_slice(&p[..12]);
                    self.queue_out(&unit);
                }
                self.stage_fill = 0;
            }
            _ => self.stage_fill = 0,
        }
        self.st = if tail > 0 { St::Skip(tail) } else { St::Marker };
        Ok(())
    }

    fn emit_stage(&mut self) {
        self.stage_out_len = self.stage_fill;
        self.stage_out_pos = 0;
        self.stage_fill = 0;
    }

    fn advance(&mut self, b: u8) -> io::Result<()> {
        match self.st {
            St::Start0 => {
                if b == 0xFF {
                    self.st = St::Start1;
                } else {
                    return Err(self.fail(FilterVerdict::Malformed("not a JPEG")));
                }
            }
            St::Start1 => {
                if b == 0xD8 {
                    self.queue_out(&[0xFF, 0xD8]);
                    self.st = St::Marker;
                } else {
                    return Err(self.fail(FilterVerdict::Malformed("not a JPEG")));
                }
            }
            St::Marker => {
                if b == 0xFF {
                    self.st = St::MarkerFF;
                }
            }
            St::MarkerFF => self.on_code(b)?,
            St::EntropyFF => match b {
                0x00 | 0xD0..=0xD7 => {
                    self.queue_out(&[0xFF, b]);
                    self.st = St::Entropy;
                }
                0xFF => {}
                m => self.on_code(m)?,
            },
            St::LenHi(m) => self.st = St::LenLo(m, b),
            St::LenLo(m, hi) => self.on_length(m, usize::from(hi) << 8 | usize::from(b))?,
            St::Stage { m, left, tail } => {
                self.stage[self.stage_fill] = b;
                self.stage_fill += 1;
                if left <= 1 {
                    self.finish_segment(m, tail)?;
                } else {
                    self.st = St::Stage { m, left: left - 1, tail };
                }
            }
            St::Skip(_) | St::Entropy | St::Done => {}
        }
        Ok(())
    }

    /// Copies a run of entropy bytes up to the next `FF`. `Ok(None)` at end of input.
    fn entropy_run(&mut self, buf: &mut [u8]) -> io::Result<Option<usize>> {
        let avail = self.inner.fill_buf()?;
        if avail.is_empty() {
            return Ok(None);
        }
        let lim = avail.len().min(buf.len());
        let (n, hit_ff) = match avail[..lim].iter().position(|&b| b == 0xFF) {
            Some(p) => (p, true),
            None => (lim, false),
        };
        buf[..n].copy_from_slice(&avail[..n]);
        if hit_ff && n == 0 {
            self.inner.consume(1);
            self.st = St::EntropyFF;
        } else {
            self.inner.consume(n);
        }
        Ok(Some(n))
    }
}

impl<R: BufRead> Read for JpegFilter<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        if self.failed {
            return Err(verdict_error());
        }
        loop {
            #[cfg(test)]
            {
                self.steps += 1;
                // A loop that stops consuming input would spin here; fail instead of hanging.
                assert!(self.steps < 1 << 24, "the filter made no progress");
            }
            if self.out_pos < self.out_len {
                let n = (self.out_len - self.out_pos).min(buf.len());
                buf[..n].copy_from_slice(&self.out[self.out_pos..self.out_pos + n]);
                self.out_pos += n;
                return Ok(n);
            }
            if self.stage_out_pos < self.stage_out_len {
                let n = (self.stage_out_len - self.stage_out_pos).min(buf.len());
                buf[..n].copy_from_slice(&self.stage[self.stage_out_pos..self.stage_out_pos + n]);
                self.stage_out_pos += n;
                return Ok(n);
            }
            match self.st {
                St::Done => return Ok(0),
                St::Entropy => match self.entropy_run(buf)? {
                    None => return Ok(0),
                    Some(0) => {}
                    Some(n) => return Ok(n),
                },
                St::Skip(rem) => {
                    let avail = self.inner.fill_buf()?.len();
                    if avail == 0 {
                        return Ok(0);
                    }
                    let k = rem.min(avail);
                    self.inner.consume(k);
                    self.st = if rem > k { St::Skip(rem - k) } else { St::Marker };
                }
                _ => match self.pull()? {
                    None => return Ok(0),
                    Some(b) => self.advance(b)?,
                },
            }
        }
    }
}
