//! Native avatar preview for files too large for the page: decodes a PNG or JPEG by key
//! and downscales it to a thumbnail-sized RGBA buffer.
//!
//! Invariants:
//! - No allocation proportional to the image happens before `peak` admits the header's
//!   predicted peak (128 MiB total, 400 MP, MC-2179 single-buffer cap on 32-bit).
//! - Every byte read from the file passes `reader::InnerGuard` (checked before each OS
//!   read, capped at 64 KiB, I/O errors recorded at the source); every decoder is built
//!   on `reader::OuterGuard`. `File::open` appears once, in `preview_with`. The sniff
//!   peeks the same `Source` and seeks back, so it opens nothing.
//! - A stop (cancel or deadline) ends a job at the decoder's next read, plus one decoder
//!   step: one blocking OS read of at most 64 KiB; for `jpeg-decoder` one scan over the
//!   admitted frame plus the IDCT of unfinished progressive components and the colour
//!   conversion of the admitted output; for `png` the work over one `fill_buf` slice.
//!   Also bounded: the 2 s orphan wait before the watchdog starts and one watchdog step.
//! - Closed loop table: filter input loop (consumes >= 1 byte per iteration), filter
//!   queue drain (<= 65,537 + 16 B), InnerGuard EINTR retry (checks every pass), PNG row
//!   loop (checks per row), downscaler (checks per output row), per-pixel conversion
//!   (one row), `peak` per-component loops (<= 3), the filter's SOF/SOS component loops
//!   (<= 4), the sniff (8 bytes), the orphan wait (time), the pre-cancel queue (<= 64),
//!   the watchdog loop (ends with the job), and the reply build (one copy).
//! - The decode body runs under `catch_unwind`, which needs `panic = "unwind"`; no Cargo
//!   profile may set `panic = "abort"`. Allocation failure and stack overflow are not
//!   catchable, which is why every size check precedes its allocation.

pub mod downscale;
pub mod jpeg_filter;
pub mod jpeg_path;
pub mod peak;
pub mod png_path;
pub mod reader;
pub mod slot;
pub mod stop;

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::rc::Rc;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use jpeg_filter::{FilterShared, FilterVerdict, JpegFilter};
use peak::Limits;
use reader::{InnerGuard, OuterGuard, BUF};
use slot::{global_tickets, run_job, JobCfg, SlotState, GLOBAL_SLOT};
use stop::{StopToken, TRIP_CANCEL, TRIP_DEADLINE, TRIP_IO};

/// Persisted refusals; the numbers are the reply status bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Unsupported = 1,
    TooLarge = 2,
    Animated = 3,
    Malformed = 4,
    Deadline = 5,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Pixels { w: u32, h: u32, rgba: Vec<u8> },
    Refused(Reason),
}

/// Not stored by the page: it may succeed on a later attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum Transient {
    Cancelled,
    Busy,
    Io(String),
    RefusedKey(String),
}

pub(crate) enum PathResult {
    Pixels { w: u32, h: u32, rgba: Vec<u8> },
    Refuse(Reason),
    Failed { unsupported: bool },
}

/// Precedence: a recorded stop, then the filter's verdict, then the decoder's own result.
/// The final `check()` records a flag raised after the decoder's last read, so pixels are
/// kept only when no stop ever tripped.
pub(crate) fn finalize(result: PathResult, tok: &StopToken, verdict: Option<FilterVerdict>) -> Result<Outcome, Transient> {
    let _ = tok.check();
    match tok.tripped() {
        TRIP_CANCEL => return Err(Transient::Cancelled),
        TRIP_DEADLINE => return Ok(Outcome::Refused(Reason::Deadline)),
        TRIP_IO => return Err(Transient::Io("read failed".to_string())),
        _ => {}
    }
    if let Some(v) = verdict {
        return Ok(Outcome::Refused(match v {
            FilterVerdict::Unsupported(_) => Reason::Unsupported,
            FilterVerdict::Malformed(_) | FilterVerdict::ScanCap => Reason::Malformed,
        }));
    }
    Ok(match result {
        PathResult::Pixels { w, h, rgba } => Outcome::Pixels { w, h, rgba },
        PathResult::Refuse(r) => Outcome::Refused(r),
        PathResult::Failed { unsupported: true } => Outcome::Refused(Reason::Unsupported),
        PathResult::Failed { unsupported: false } => Outcome::Refused(Reason::Malformed),
    })
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

enum Format {
    Png,
    Jpeg,
    Other,
}

fn sniff<R: Read + Seek>(source: &mut R) -> std::io::Result<Format> {
    let mut head = [0u8; 8];
    let mut n = 0;
    while n < head.len() {
        let k = source.read(&mut head[n..])?;
        if k == 0 {
            break;
        }
        n += k;
    }
    source.seek(SeekFrom::Start(0))?;
    Ok(if n >= 8 && head == PNG_SIGNATURE {
        Format::Png
    } else if n >= 3 && head[..3] == [0xFF, 0xD8, 0xFF] {
        Format::Jpeg
    } else {
        Format::Other
    })
}

/// Decodes one source under the stop token. `buf_cap` is the `BufReader` capacity
/// (`BUF` in production; tests vary it to move every refill boundary).
pub(crate) fn decode_source<S: Read + Seek>(
    src: S,
    buf_cap: usize,
    short_side: u32,
    lim: &Limits,
    tok: &Arc<StopToken>,
    shared: &Rc<FilterShared>,
) -> Result<Outcome, Transient> {
    let body = catch_unwind(AssertUnwindSafe(|| {
        let mut source = BufReader::with_capacity(buf_cap, InnerGuard::new(src, tok.clone()));
        let format = match sniff(&mut source) {
            Ok(f) => f,
            Err(_) => return PathResult::Failed { unsupported: false },
        };
        match format {
            Format::Png => png_path::run(OuterGuard::new(source, tok.clone()), short_side, lim, tok),
            Format::Jpeg => {
                let filter = JpegFilter::new(source, shared.clone());
                jpeg_path::run(OuterGuard::new(filter, tok.clone()), shared, short_side, lim, tok)
            }
            Format::Other => PathResult::Refuse(Reason::Unsupported),
        }
    }));
    let result = body.unwrap_or(PathResult::Failed { unsupported: false });
    finalize(result, tok, shared.verdict.get())
}

pub fn preview_file(path: &Path, short_side: u32, cancel: Arc<AtomicBool>) -> Result<Outcome, Transient> {
    preview_with(&GLOBAL_SLOT, &JobCfg::production(), path, short_side, cancel)
}

/// The module's only `File::open`.
pub fn preview_with(
    slot: &SlotState,
    cfg: &JobCfg,
    path: &Path,
    short_side: u32,
    cancel: Arc<AtomicBool>,
) -> Result<Outcome, Transient> {
    run_job(slot, cancel, cfg, |tok| {
        let file = File::open(path).map_err(|e| Transient::Io(format!("open: {:?}", e.kind())))?;
        let shared = FilterShared::new();
        decode_source(file, BUF, short_side, &Limits::for_target(), &tok, &shared)
    })?
}

pub const REPLY_HEADER: usize = 9;

/// `status u8 | w u32 LE | h u32 LE | rgba` (rgba only for status 0).
pub fn encode_outcome(o: &Outcome) -> Vec<u8> {
    match o {
        Outcome::Pixels { w, h, rgba } => {
            let mut v = Vec::with_capacity(REPLY_HEADER + rgba.len());
            v.push(0);
            v.extend_from_slice(&w.to_le_bytes());
            v.extend_from_slice(&h.to_le_bytes());
            v.extend_from_slice(rgba);
            v
        }
        Outcome::Refused(r) => {
            let mut v = vec![0u8; REPLY_HEADER];
            v[0] = *r as u8;
            v
        }
    }
}

pub fn transient_message(t: &Transient) -> String {
    match t {
        Transient::Cancelled => "cancelled".to_string(),
        Transient::Busy => "busy".to_string(),
        Transient::Io(m) => format!("io: {}", m),
        Transient::RefusedKey(m) => format!("refused key: {}", m),
    }
}

/// The command body: validates the page's arguments, resolves the key under `base`
/// (the page never passes a path), and returns the reply bytes.
pub fn preview_key(base: &Path, key: &str, short_side: u32, ticket: u64) -> Result<Vec<u8>, String> {
    if !(16..=512).contains(&short_side) {
        return Err(transient_message(&Transient::RefusedKey("short side".to_string())));
    }
    if !key.starts_with("assets/") {
        return Err(transient_message(&Transient::RefusedKey("not an asset".to_string())));
    }
    let path = crate::chunked_io::resolve_addressable(base, key)?;
    let guard = global_tickets().register(ticket);
    match preview_file(&path, short_side, guard.flag.clone()) {
        Ok(o) => Ok(encode_outcome(&o)),
        Err(t) => Err(transient_message(&t)),
    }
}

// FIXTURES-BEGIN
#[cfg(test)]
pub(crate) mod fixtures {
    //! Synthetic producers for the tests; no real photos.

    pub fn gradient(x: u32, y: u32, w: u32, h: u32) -> [u8; 3] {
        [(x * 255 / w.max(1)) as u8, (y * 255 / h.max(1)) as u8, ((x + y) * 255 / (w + h).max(1)) as u8]
    }

    pub fn png_encode(
        w: u32,
        h: u32,
        ct: png::ColorType,
        depth: png::BitDepth,
        data: &[u8],
        pre: impl FnOnce(&mut png::Writer<&mut Vec<u8>>),
    ) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(ct);
            enc.set_depth(depth);
            let mut wr = enc.write_header().unwrap();
            pre(&mut wr);
            wr.write_image_data(data).unwrap();
        }
        out
    }

    pub fn rgb_png(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
        let mut d = Vec::new();
        for y in 0..h {
            for x in 0..w {
                d.extend_from_slice(&f(x, y));
            }
        }
        png_encode(w, h, png::ColorType::Rgb, png::BitDepth::Eight, &d, |_| {})
    }

    pub fn rgba_png(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let mut d = Vec::new();
        for y in 0..h {
            for x in 0..w {
                d.extend_from_slice(&f(x, y));
            }
        }
        png_encode(w, h, png::ColorType::Rgba, png::BitDepth::Eight, &d, |_| {})
    }

    pub fn crc32(data: &[u8]) -> u32 {
        let mut c = 0xFFFF_FFFFu32;
        for &b in data {
            c ^= u32::from(b);
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        !c
    }

    pub fn adler32(data: &[u8]) -> u32 {
        let (mut a, mut b) = (1u32, 0u32);
        for &x in data {
            a = (a + u32::from(x)) % 65521;
            b = (b + a) % 65521;
        }
        b << 16 | a
    }

    pub fn chunk(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = name.to_vec();
        body.extend_from_slice(data);
        v.extend_from_slice(&body);
        v.extend_from_slice(&crc32(&body).to_be_bytes());
        v
    }

    /// A zlib stream of stored (uncompressed) blocks.
    pub fn zlib_stored(raw: &[u8]) -> Vec<u8> {
        let mut v = vec![0x78, 0x01];
        let mut blocks = raw.chunks(65535).peekable();
        if blocks.peek().is_none() {
            v.extend_from_slice(&[1, 0, 0, 0xFF, 0xFF]);
        }
        while let Some(b) = blocks.next() {
            v.push(u8::from(blocks.peek().is_none()));
            v.extend_from_slice(&(b.len() as u16).to_le_bytes());
            v.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
            v.extend_from_slice(b);
        }
        v.extend_from_slice(&adler32(raw).to_be_bytes());
        v
    }

    /// The seven Adam7 passes as (x0, y0, dx, dy).
    const ADAM7: [(u32, u32, u32, u32); 7] = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)];

    /// An interlaced 8-bit RGBA PNG. The `png` encoder cannot write Adam7 data, so the
    /// IDAT is built byte by byte (filter 0, stored zlib) in the layout the spec defines.
    pub fn interlaced_rgba_png(w: u32, h: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let mut raw = Vec::new();
        for (x0, y0, dx, dy) in ADAM7 {
            let xs: Vec<u32> = (x0..w).step_by(dx as usize).collect();
            if xs.is_empty() {
                continue;
            }
            for y in (y0..h).step_by(dy as usize) {
                raw.push(0);
                for &x in &xs {
                    raw.extend_from_slice(&f(x, y));
                }
            }
        }
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 6, 0, 0, 1]);
        let mut out = super::PNG_SIGNATURE.to_vec();
        out.extend(chunk(b"IHDR", &ihdr));
        out.extend(chunk(b"IDAT", &zlib_stored(&raw)));
        out.extend(chunk(b"IEND", &[]));
        out
    }

    /// A PNG claiming a size: IHDR and an empty IDAT, no image data.
    pub fn png_header_only(w: u32, h: u32, color: u8, depth: u8, interlace: u8) -> Vec<u8> {
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[depth, color, 0, 0, interlace]);
        let mut out = super::PNG_SIGNATURE.to_vec();
        out.extend(chunk(b"IHDR", &ihdr));
        out.extend(chunk(b"IDAT", &[]));
        out
    }

    pub fn jpeg_encode(
        w: u16,
        h: u16,
        gray: bool,
        sampling: jpeg_encoder::SamplingFactor,
        progressive: bool,
        restart: u16,
        f: impl Fn(u32, u32) -> [u8; 3],
    ) -> Vec<u8> {
        let mut data = Vec::new();
        for y in 0..u32::from(h) {
            for x in 0..u32::from(w) {
                let p = f(x, y);
                if gray {
                    data.push(p[0]);
                } else {
                    data.extend_from_slice(&p);
                }
            }
        }
        let mut out = Vec::new();
        {
            let mut enc = jpeg_encoder::Encoder::new(&mut out, 90);
            enc.set_sampling_factor(sampling);
            enc.set_progressive(progressive);
            enc.set_restart_interval(restart);
            let ct = if gray { jpeg_encoder::ColorType::Luma } else { jpeg_encoder::ColorType::Rgb };
            enc.encode(&data, w, h, ct).unwrap();
        }
        out
    }

    pub fn jpeg420(w: u16, h: u16) -> Vec<u8> {
        jpeg_encode(w, h, false, jpeg_encoder::SamplingFactor::F_2_2, false, 0, |x, y| gradient(x, y, u32::from(w), u32::from(h)))
    }

    pub fn jpeg444(w: u16, h: u16) -> Vec<u8> {
        jpeg_encode(w, h, false, jpeg_encoder::SamplingFactor::F_1_1, false, 0, |x, y| gradient(x, y, u32::from(w), u32::from(h)))
    }

    pub fn jpeg_progressive(w: u16, h: u16, sampling: jpeg_encoder::SamplingFactor) -> Vec<u8> {
        jpeg_encode(w, h, false, sampling, true, 0, |x, y| gradient(x, y, u32::from(w), u32::from(h)))
    }

    /// One piece of a JPEG as the strict splitter sees it.
    #[derive(Clone, Debug)]
    pub enum Piece {
        /// A whole marker segment (`FF m len payload`), the SOI and the EOI included.
        Seg(u8, Vec<u8>),
        Entropy(Vec<u8>),
    }

    pub fn split(jpeg: &[u8]) -> Vec<Piece> {
        let mut out = Vec::new();
        let mut i = 2;
        out.push(Piece::Seg(0xD8, vec![0xFF, 0xD8]));
        while i < jpeg.len() {
            assert_eq!(jpeg[i], 0xFF);
            let m = jpeg[i + 1];
            if m == 0xD9 {
                out.push(Piece::Seg(0xD9, vec![0xFF, 0xD9]));
                break;
            }
            let len = usize::from(jpeg[i + 2]) << 8 | usize::from(jpeg[i + 3]);
            out.push(Piece::Seg(m, jpeg[i..i + 2 + len].to_vec()));
            i += 2 + len;
            if m == 0xDA {
                let s = i;
                while !(jpeg[i] == 0xFF && jpeg[i + 1] != 0 && !(0xD0..=0xD7).contains(&jpeg[i + 1])) {
                    i += 1;
                }
                out.push(Piece::Entropy(jpeg[s..i].to_vec()));
            }
        }
        out
    }

    pub fn join(pieces: &[Piece]) -> Vec<u8> {
        let mut v = Vec::new();
        for p in pieces {
            match p {
                Piece::Seg(_, b) | Piece::Entropy(b) => v.extend_from_slice(b),
            }
        }
        v
    }

    /// An SOF-only JPEG: SOI, one SOF (m = C0..C2), EOI.
    pub fn jpeg_sof_only(m: u8, w: u16, h: u16, comps: &[(u8, u8)], precision: u8) -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8, 0xFF, m];
        let len = 8 + 3 * comps.len() as u16;
        v.extend_from_slice(&len.to_be_bytes());
        v.push(precision);
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&w.to_be_bytes());
        v.push(comps.len() as u8);
        for (i, &(hh, vv)) in comps.iter().enumerate() {
            v.extend_from_slice(&[i as u8 + 1, hh << 4 | vv, 0]);
        }
        v.extend_from_slice(&[0xFF, 0xD9]);
        v
    }

    /// The hand-built frame used by the empty-scan fixtures: SOI, DQT, DHT, SOF0
    /// (4:4:4, `w` x `h`), `n` empty SOS segments, EOI.
    pub fn empty_sos(w: u16, h: u16, n: usize) -> Vec<u8> {
        let mut v = vec![0xFF, 0xD8];
        v.extend_from_slice(&[0xFF, 0xDB, 0x00, 0x43, 0x00]);
        v.extend_from_slice(&[1u8; 64]);
        // DHT: DC table 0 with one 1-bit code (value 0), AC table 0 with one code (value 0).
        for class_id in [0x00u8, 0x10] {
            v.extend_from_slice(&[0xFF, 0xC4, 0x00, 0x14, class_id]);
            let mut counts = [0u8; 16];
            counts[0] = 1;
            v.extend_from_slice(&counts);
            v.push(0);
        }
        v.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 8]);
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&[3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
        for _ in 0..n {
            v.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x0C, 3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]);
        }
        v.extend_from_slice(&[0xFF, 0xD9]);
        v
    }

}
// FIXTURES-END
#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn tok() -> Arc<StopToken> {
        StopToken::new(Arc::new(AtomicBool::new(false)))
    }

    fn run(bytes: Vec<u8>, cap: usize) -> Result<Outcome, Transient> {
        let t = tok();
        decode_source(Cursor::new(bytes), cap, 168, &Limits::for_target(), &t, &FilterShared::new())
    }

    fn pixels(o: Result<Outcome, Transient>) -> (u32, u32, Vec<u8>) {
        match o {
            Ok(Outcome::Pixels { w, h, rgba }) => (w, h, rgba),
            other => panic!("expected pixels, got {:?}", other.map(|o| match o { Outcome::Refused(r) => format!("{:?}", r), _ => "px".into() })),
        }
    }

    fn refused(o: Result<Outcome, Transient>) -> Reason {
        match o {
            Ok(Outcome::Refused(r)) => r,
            Ok(Outcome::Pixels { .. }) => panic!("got pixels"),
            Err(t) => panic!("got transient {:?}", t),
        }
    }

    // RS1: exact block averages. Every 3x3 block is one value, so each output pixel is exact.
    #[test]
    fn png_rgb_downscale_gives_exact_block_averages() {
        let img = rgb_png(840, 504, |x, y| [((x / 3) * 7 + (y / 3) * 3) as u8, ((x / 3) % 251) as u8, 9]);
        let (w, h, rgba) = pixels(run(img, BUF));
        assert_eq!((w, h), (280, 168));
        assert_eq!(rgba.len(), 280 * 168 * 4);
        for &(ox, oy) in &[(0u32, 0u32), (17, 5), (279, 167), (100, 80)] {
            let i = ((oy * 280 + ox) * 4) as usize;
            assert_eq!(rgba[i], (ox * 7 + oy * 3) as u8);
            assert_eq!(rgba[i + 1], (ox % 251) as u8);
            assert_eq!(rgba[i + 2], 9);
            assert_eq!(rgba[i + 3], 255);
        }
    }

    #[test]
    fn png_small_image_is_not_upscaled_and_formats_expand() {
        let g = png_encode(4, 3, png::ColorType::Grayscale, png::BitDepth::Eight, &[10; 12], |_| {});
        let (w, h, rgba) = pixels(run(g, BUF));
        assert_eq!((w, h), (4, 3));
        assert_eq!(&rgba[..4], &[10, 10, 10, 255]);
        let ga = png_encode(2, 1, png::ColorType::GrayscaleAlpha, png::BitDepth::Eight, &[50, 100, 60, 200], |_| {});
        let (_, _, rgba) = pixels(run(ga, BUF));
        assert_eq!(&rgba[..8], &[50, 50, 50, 100, 60, 60, 60, 200]);
        // 16 bit is stripped to 8.
        let d16 = png_encode(1, 1, png::ColorType::Rgb, png::BitDepth::Sixteen, &[0x80, 0, 0x40, 0, 0xFF, 0xFF], |_| {});
        let (_, _, rgba) = pixels(run(d16, BUF));
        assert_eq!(&rgba[..4], &[0x80, 0x40, 0xFF, 255]);
        // Palette with a transparency table.
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, 2, 1);
            enc.set_color(png::ColorType::Indexed);
            enc.set_depth(png::BitDepth::Eight);
            enc.set_palette(vec![255, 0, 0, 0, 0, 255]);
            enc.set_trns(vec![128, 255]);
            let mut wr = enc.write_header().unwrap();
            wr.write_image_data(&[0, 1]).unwrap();
        }
        let (_, _, rgba) = pixels(run(out, BUF));
        assert_eq!(&rgba[..8], &[255, 0, 0, 128, 0, 0, 255, 255]);
    }

    // RS4 on the PNG path: transparent black does not darken a half-transparent red.
    #[test]
    fn png_alpha_is_averaged_premultiplied() {
        let img = rgba_png(336, 336, |x, _| if x % 2 == 0 { [255, 0, 0, 128] } else { [0, 0, 0, 0] });
        let (w, h, rgba) = pixels(run(img, BUF));
        assert_eq!((w, h), (168, 168));
        assert_eq!(rgba[0], 255);
        assert_eq!(rgba[3], 64);
    }

    #[test]
    fn png_interlaced_matches_non_interlaced() {
        let f = |x: u32, y: u32| [(x * 255 / 400) as u8, (y * 255 / 300) as u8, 40, 255];
        let a = pixels(run(interlaced_rgba_png(400, 300, f), BUF));
        let b = pixels(run(rgba_png(400, 300, f), BUF));
        assert_eq!(a, b);
        assert_eq!((a.0, a.1), (224, 168));
    }

    // RS3
    #[test]
    fn apng_is_animated_even_after_a_large_text_chunk() {
        let d = vec![7u8; 8 * 8 * 4];
        let apng = png_encode(8, 8, png::ColorType::Rgba, png::BitDepth::Eight, &d, |wr| {
            wr.write_chunk(png::chunk::tEXt, &[b'k', 0].iter().copied().chain(vec![b'a'; 300 * 1024]).collect::<Vec<u8>>()).unwrap();
            wr.write_chunk(png::chunk::acTL, &[0, 0, 0, 1, 0, 0, 0, 0]).unwrap();
        });
        assert_eq!(refused(run(apng, BUF)), Reason::Animated);
        let plain = png_encode(8, 8, png::ColorType::Rgba, png::BitDepth::Eight, &d, |wr| {
            wr.write_chunk(png::chunk::acTL, &[0, 0, 0, 1, 0, 0, 0, 0]).unwrap();
        });
        assert_eq!(refused(run(plain, BUF)), Reason::Animated);
    }

    #[test]
    fn text_and_icc_chunks_are_ignored_not_refused() {
        let d = vec![7u8; 8 * 8 * 4];
        let img = png_encode(8, 8, png::ColorType::Rgba, png::BitDepth::Eight, &d, |wr| {
            wr.write_chunk(png::chunk::iTXt, &vec![b'x'; 3 * 1024 * 1024]).unwrap();
            wr.write_chunk(png::chunk::iCCP, &vec![0u8; 5 * 1024 * 1024]).unwrap();
        });
        let (w, h, _) = pixels(run(img, BUF));
        assert_eq!((w, h), (8, 8));
    }

    #[test]
    fn exif_chunk_over_the_png_limit_is_too_large() {
        let d = vec![7u8; 8 * 8 * 4];
        let img = png_encode(8, 8, png::ColorType::Rgba, png::BitDepth::Eight, &d, |wr| {
            wr.write_chunk(png::chunk::eXIf, &vec![1u8; 9 * 1024 * 1024]).unwrap();
        });
        assert_eq!(refused(run(img, BUF)), Reason::TooLarge);
    }

    // RS2b/RS13: header-only giants are refused without allocating.
    #[test]
    fn header_only_giants_are_too_large() {
        assert_eq!(refused(run(png_header_only(100_000, 100_000, 6, 16, 0), BUF)), Reason::TooLarge);
        assert_eq!(refused(run(png_header_only(100_001, 1, 6, 8, 0), BUF)), Reason::TooLarge);
        assert_eq!(refused(run(png_header_only(400_000_000, 1, 6, 16, 0), BUF)), Reason::TooLarge);
        assert_eq!(refused(run(png_header_only(8000, 8000, 6, 8, 1), BUF)), Reason::TooLarge);
        assert_eq!(refused(run(jpeg_sof_only(0xC2, 65535, 65535, &[(1, 1), (1, 1), (1, 1)], 8), BUF)), Reason::TooLarge);
        assert_eq!(refused(run(jpeg_sof_only(0xC2, 6000, 6000, &[(1, 1), (1, 1), (1, 1)], 8), BUF)), Reason::TooLarge);
    }

    // RS12 and RS16 outcomes
    #[test]
    fn other_formats_and_unsupported_jpegs() {
        let mut webp = b"RIFF\x10\0\0\0WEBPVP8 ".to_vec();
        webp.resize(64, 0);
        assert_eq!(refused(run(webp, BUF)), Reason::Unsupported);
        let mut avif = vec![0, 0, 0, 0x18];
        avif.extend_from_slice(b"ftypavif");
        avif.resize(64, 0);
        assert_eq!(refused(run(avif, BUF)), Reason::Unsupported);
        assert_eq!(refused(run(b"GIF89a\x01\0\x01\0".to_vec(), BUF)), Reason::Unsupported);
        assert_eq!(refused(run(b"BM\0\0\0\0\0\0\0\0\0\0\0\0".to_vec(), BUF)), Reason::Unsupported);
        assert_eq!(refused(run(Vec::new(), BUF)), Reason::Unsupported);
        let c = [(1, 1), (1, 1), (1, 1)];
        for m in [0xC3u8, 0xC5, 0xC9, 0xCD] {
            let mut j = jpeg_sof_only(0xC0, 16, 16, &c, 8);
            j[3] = m;
            assert_eq!(refused(run(j, BUF)), Reason::Unsupported, "SOF{:X}", m);
        }
        assert_eq!(refused(run(jpeg_sof_only(0xC0, 16, 16, &[(1, 1), (1, 1)], 8), BUF)), Reason::Unsupported);
        assert_eq!(refused(run(jpeg_sof_only(0xC0, 16, 16, &[(1, 1), (1, 1), (1, 1), (1, 1)], 8), BUF)), Reason::Unsupported);
        assert_eq!(refused(run(jpeg_sof_only(0xC0, 16, 16, &c, 12), BUF)), Reason::Unsupported);
        assert_eq!(refused(run(jpeg_sof_only(0xC0, 16, 0, &c, 8), BUF)), Reason::Unsupported);
        assert_eq!(refused(run(jpeg_sof_only(0xC0, 16, 16, &[(5, 1), (1, 1), (1, 1)], 8), BUF)), Reason::Malformed);
        assert_eq!(refused(run(jpeg_sof_only(0xC0, 16, 16, &[(0, 1), (1, 1), (1, 1)], 8), BUF)), Reason::Malformed);
        for marker in [0xCCu8, 0xDE, 0xDF] {
            let j = vec![0xFF, 0xD8, 0xFF, marker, 0, 2, 0xFF, 0xD9];
            assert_eq!(refused(run(j, BUF)), Reason::Unsupported, "marker {:X}", marker);
        }
        for bad in [vec![0xFF, 0xD8, 0xFF, 0x01, 0xFF, 0xD9], vec![0xFF, 0xD8, 0xFF, 0x80, 0xFF, 0xD9], vec![0xFF, 0xD8, 0xFF, 0xD8, 0xFF, 0xD9]] {
            assert_eq!(refused(run(bad, BUF)), Reason::Malformed);
        }
        // DRI with a bad length, and an SOS naming an unknown component.
        let mut dri = jpeg_sof_only(0xC0, 16, 16, &c, 8);
        dri.splice(2..2, [0xFF, 0xDD, 0x00, 0x05, 0, 1, 0]);
        assert_eq!(refused(run(dri, BUF)), Reason::Malformed);
        let mut sos = jpeg_sof_only(0xC0, 16, 16, &c, 8);
        let n = sos.len() - 2;
        sos.splice(n..n, [0xFF, 0xDA, 0x00, 0x08, 1, 9, 0, 0, 63, 0]);
        assert_eq!(refused(run(sos, BUF)), Reason::Malformed);
    }

    // RS5
    #[test]
    fn jpeg_dimensions_for_each_coding() {
        let (w, h, _) = pixels(run(jpeg420(640, 400), BUF));
        assert_eq!((w, h), (269, 168));
        let (w, h, _) = pixels(run(jpeg444(300, 500), BUF));
        assert_eq!((w, h), (168, 280));
        let (w, h, _) = pixels(run(jpeg_progressive(500, 300, jpeg_encoder::SamplingFactor::F_2_2), BUF));
        assert_eq!((w, h), (280, 168));
        let gray = jpeg_encode(400, 300, true, jpeg_encoder::SamplingFactor::F_1_1, false, 0, |x, y| [(x ^ y) as u8; 3]);
        let (w, h, rgba) = pixels(run(gray, BUF));
        assert_eq!((w, h), (224, 168));
        assert!(rgba.chunks_exact(4).all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255));
        // Small images are not upscaled.
        let (w, h, _) = pixels(run(jpeg420(50, 30), BUF));
        assert_eq!((w, h), (50, 30));
    }

    #[test]
    fn jpeg_colours_survive_the_pipeline() {
        for img in [jpeg420(480, 320), jpeg444(480, 320), jpeg_progressive(480, 320, jpeg_encoder::SamplingFactor::F_1_1)] {
            let (w, h, rgba) = pixels(run(img, BUF));
            assert_eq!((w, h), (252, 168));
            // The gradient: left edge has r about 0, right edge r about 255; top g about 0.
            let at = |x: u32, y: u32| &rgba[((y * w + x) * 4) as usize..][..3];
            let (l, r) = (at(2, 80), at(w - 3, 80));
            assert!(l[0] < 30 && r[0] > 225, "{:?} {:?}", l, r);
            let (t, b) = (at(100, 2), at(100, h - 3));
            assert!(t[1] < 30 && b[1] > 225, "{:?} {:?}", t, b);
        }
    }

    #[test]
    fn a_wide_jpeg_requests_a_proportional_scale() {
        let img = jpeg_encode(4000, 200, false, jpeg_encoder::SamplingFactor::F_2_2, false, 0, |x, y| gradient(x, y, 4000, 200));
        let (w, h, _) = pixels(run(img, BUF));
        assert_eq!((w, h), (2048, 102));
        // The scale request keeps the aspect ratio, so the decoder output is at least as large as
        // the final size on one axis and the box filter never has to upscale.
        let hd = peak::SofInfo { w: 4000, h: 200, ncomp: 3, comps: [peak::SofComponent { id: 1, h: 2, v: 2 }, peak::SofComponent { id: 2, h: 1, v: 1 }, peak::SofComponent { id: 3, h: 1, v: 1 }], progressive: false };
        let plan = peak::predict_jpeg(&hd, 168, &Limits::for_target()).unwrap();
        assert_eq!((plan.out_w, plan.out_h), (2048, 102));
        assert!(plan.sw >= plan.out_w || plan.sh >= plan.out_h);
    }

    // 4000 x 1337 requests 503 x 168. At scale 1 the height reaches 168 while the width
    // reaches only 500, so the per-axis request picks scale 1; one squared request of 503 on
    // both axes would pick scale 2 and the decoder output would disagree with the prediction.
    #[test]
    fn a_jpeg_scale_request_keeps_both_axes() {
        let gray = peak::SofComponent { id: 1, h: 1, v: 1 };
        let hd = peak::SofInfo { w: 4000, h: 1337, ncomp: 1, comps: [gray; 3], progressive: false };
        let plan = peak::predict_jpeg(&hd, 168, &Limits::for_target()).unwrap();
        assert_eq!((plan.out_w, plan.out_h, plan.d, plan.sw, plan.sh), (503, 168, 1, 500, 168));
        let img = jpeg_encode(4000, 1337, true, jpeg_encoder::SamplingFactor::F_1_1, false, 0, |x, y| gradient(x, y, 4000, 1337));
        let (w, h, _) = pixels(run(img, BUF));
        assert_eq!((w, h), (500, 168));
    }

    // RS17: the finalize table.
    #[test]
    fn finalize_precedence() {
        let mk = || StopToken::new(Arc::new(AtomicBool::new(false)));
        let px = || PathResult::Pixels { w: 1, h: 1, rgba: vec![0; 4] };
        assert!(matches!(finalize(px(), &mk(), None), Ok(Outcome::Pixels { .. })));
        let t = mk();
        t.deadline_flag().store(true, Ordering::Relaxed);
        // The flag was raised after the decoder's last read: pixels are discarded.
        assert_eq!(finalize(px(), &t, None), Ok(Outcome::Refused(Reason::Deadline)));
        let t = StopToken::new(Arc::new(AtomicBool::new(true)));
        assert_eq!(finalize(px(), &t, None), Err(Transient::Cancelled));
        let t = mk();
        t.trip_io();
        assert!(matches!(finalize(px(), &t, None), Err(Transient::Io(_))));
        // A trip beats a verdict; a verdict beats the decoder's error.
        let t = StopToken::new(Arc::new(AtomicBool::new(true)));
        assert_eq!(finalize(PathResult::Failed { unsupported: false }, &t, Some(FilterVerdict::Unsupported("x"))), Err(Transient::Cancelled));
        assert_eq!(finalize(PathResult::Failed { unsupported: false }, &mk(), Some(FilterVerdict::Unsupported("x"))), Ok(Outcome::Refused(Reason::Unsupported)));
        assert_eq!(finalize(PathResult::Failed { unsupported: true }, &mk(), Some(FilterVerdict::Malformed("x"))), Ok(Outcome::Refused(Reason::Malformed)));
        assert_eq!(finalize(PathResult::Failed { unsupported: false }, &mk(), Some(FilterVerdict::ScanCap)), Ok(Outcome::Refused(Reason::Malformed)));
        assert_eq!(finalize(PathResult::Failed { unsupported: true }, &mk(), None), Ok(Outcome::Refused(Reason::Unsupported)));
        assert_eq!(finalize(PathResult::Failed { unsupported: false }, &mk(), None), Ok(Outcome::Refused(Reason::Malformed)));
        assert_eq!(finalize(PathResult::Refuse(Reason::TooLarge), &mk(), None), Ok(Outcome::Refused(Reason::TooLarge)));
    }

    // RS9
    #[test]
    fn reply_layout() {
        let o = Outcome::Pixels { w: 2, h: 1, rgba: vec![1, 2, 3, 4, 5, 6, 7, 8] };
        let v = encode_outcome(&o);
        assert_eq!(v.len(), REPLY_HEADER + 8);
        assert_eq!(v[0], 0);
        assert_eq!(&v[1..5], &2u32.to_le_bytes());
        assert_eq!(&v[5..9], &1u32.to_le_bytes());
        for r in [Reason::Unsupported, Reason::TooLarge, Reason::Animated, Reason::Malformed, Reason::Deadline] {
            let v = encode_outcome(&Outcome::Refused(r));
            assert_eq!(v.len(), REPLY_HEADER);
            assert_eq!(v[0], r as u8);
            assert!(v[1..].iter().all(|&b| b == 0));
        }
        assert_eq!(Reason::Unsupported as u8, 1);
        assert_eq!(Reason::Deadline as u8, 5);
    }

    // RS7
    #[test]
    fn keys_and_short_sides_are_refused() {
        let base = std::env::temp_dir();
        for key in ["../x", "assets/../x", "database/x", "/abs/x", "", "C:/x", "assets//x", "assets/./x"] {
            let e = preview_key(&base, key, 168, 1).unwrap_err();
            assert!(e.starts_with("refused key"), "{} -> {}", key, e);
        }
        for s in [0u32, 15, 513] {
            assert!(preview_key(&base, "assets/a", s, 1).unwrap_err().starts_with("refused key"));
        }
        // A well-formed key to a missing file is an I/O error, not a refusal.
        let e = preview_key(&base, "assets/definitely-missing-avatar-preview", 168, 2).unwrap_err();
        assert!(e.starts_with("io:"), "{}", e);
    }

    #[test]
    fn preview_file_reads_a_real_file_end_to_end() {
        let dir = std::env::temp_dir().join(format!("avatar-preview-e2e-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("assets").join("p"), jpeg444(300, 200)).unwrap();
        let reply = preview_key(&dir, "assets/p", 168, 77).unwrap();
        assert_eq!(reply[0], 0);
        let w = u32::from_le_bytes(reply[1..5].try_into().unwrap());
        let h = u32::from_le_bytes(reply[5..9].try_into().unwrap());
        assert_eq!((w, h), (252, 168));
        assert_eq!(reply.len(), REPLY_HEADER + (w * h * 4) as usize);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // A panic inside a decoder step is a persisted Malformed, not an unwind into the caller.
    #[test]
    fn a_panicking_decode_body_is_malformed() {
        let r = catch_unwind(AssertUnwindSafe(|| -> PathResult { panic!("decoder bug") }));
        let res = r.unwrap_or(PathResult::Failed { unsupported: false });
        assert_eq!(finalize(res, &tok(), None), Ok(Outcome::Refused(Reason::Malformed)));
    }

    // The production `decode_source` itself must turn a panic below it into Malformed.
    #[test]
    fn decode_source_turns_a_source_panic_into_malformed() {
        struct PanicSrc;
        impl Read for PanicSrc {
            fn read(&mut self, _b: &mut [u8]) -> std::io::Result<usize> {
                panic!("source bug")
            }
        }
        impl Seek for PanicSrc {
            fn seek(&mut self, _p: SeekFrom) -> std::io::Result<u64> {
                Ok(0)
            }
        }
        let t = tok();
        let r = decode_source(PanicSrc, BUF, 168, &Limits::for_target(), &t, &FilterShared::new());
        assert_eq!(r, Ok(Outcome::Refused(Reason::Malformed)));
    }

    #[allow(dead_code)]
    fn unused(_: &AtomicUsize) {}
}
// TESTS-END
#[cfg(test)]
mod filter_tests {
    //! The canonical filter: oracle, literal expected stream, split-read at every
    //! boundary, verdicts, progress and fidelity.
    use super::fixtures::*;
    use super::*;
    use std::io::{BufRead, Read};

    /// Independent strict parser of the canonical stream (written apart from the filter).
    pub fn oracle(b: &[u8]) -> Result<(), String> {
        if b.len() < 2 || b[..2] != [0xFF, 0xD8] {
            return Err("no SOI".into());
        }
        let (mut i, mut entropy, mut jfif, mut avi) = (2usize, false, 0, 0);
        loop {
            if i >= b.len() {
                return Err("no EOI".into());
            }
            if entropy {
                if b[i] != 0xFF {
                    i += 1;
                    continue;
                }
                let n = *b.get(i + 1).ok_or("lone FF at the end")?;
                if n == 0 || (0xD0..=0xD7).contains(&n) {
                    i += 2;
                    continue;
                }
                entropy = false;
            }
            if b[i] != 0xFF {
                return Err(format!("non-FF byte {:02X} where a unit must start at {}", b[i], i));
            }
            let code = *b.get(i + 1).ok_or("truncated marker")?;
            if code == 0xD9 {
                return if i + 2 == b.len() { Ok(()) } else { Err("bytes after EOI".into()) };
            }
            if !matches!(code, 0xC0 | 0xC1 | 0xC2 | 0xC4 | 0xDB | 0xDD | 0xDA | 0xE0 | 0xEE) {
                return Err(format!("marker {:02X} is not on the allowlist at {}", code, i));
            }
            if i + 4 > b.len() {
                return Err("truncated length".into());
            }
            let len = usize::from(b[i + 2]) << 8 | usize::from(b[i + 3]);
            if len < 2 || i + 2 + len > b.len() {
                return Err(format!("bad length {} at {}", len, i));
            }
            let p = &b[i + 4..i + 2 + len];
            match code {
                0xDD if len != 4 => return Err("DRI length".into()),
                0xE0 => {
                    if len != 7 {
                        return Err("APP0 is not canonical".into());
                    }
                    match p {
                        b"JFIF\0" => jfif += 1,
                        b"AVI1\0" => avi += 1,
                        _ => return Err("APP0 is not JFIF or AVI1".into()),
                    }
                    if jfif > 1 || avi > 1 {
                        return Err("APP0 repeated".into());
                    }
                }
                0xEE => {
                    if len != 14 || &p[..6] != b"Adobe\0" || p[11] > 2 {
                        return Err("APP14 is not canonical".into());
                    }
                }
                0xDA => entropy = true,
                _ => {}
            }
            i += 2 + len;
        }
    }

    /// Reads through `read_size` and `cap`, with the source cut at `cuts`.
    struct Cut {
        data: Vec<u8>,
        pos: usize,
        cuts: Vec<usize>,
    }
    impl Read for Cut {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let end = self.cuts.iter().copied().find(|&c| c > self.pos).unwrap_or(self.data.len()).min(self.data.len());
            let n = buf.len().min(end - self.pos);
            buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
            self.pos += n;
            Ok(n)
        }
    }

    pub struct Pumped {
        pub out: Vec<u8>,
        pub verdict: Option<FilterVerdict>,
        pub errored: bool,
        pub steps: u64,
    }

    pub fn pump_src<R: Read>(src: R, cap: usize, read_size: usize) -> Pumped {
        let shared = FilterShared::new();
        let mut f = JpegFilter::new(BufReader::with_capacity(cap, src), shared.clone());
        let mut out = Vec::new();
        let mut buf = vec![0u8; read_size];
        let mut errored = false;
        loop {
            match f.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(_) => {
                    errored = true;
                    break;
                }
            }
        }
        Pumped { out, verdict: shared.verdict.get(), errored, steps: f.steps }
    }

    pub fn pump(data: &[u8], cap: usize, read_size: usize, cuts: Vec<usize>) -> Pumped {
        pump_src(Cut { data: data.to_vec(), pos: 0, cuts }, cap, read_size)
    }

    const FF: u8 = 0xFF;

    fn leak_unit(fill: usize) -> Vec<u8> {
        let mut v = vec![FF; fill];
        v.extend_from_slice(&[0xE2, 0x01, 0x04]);
        v.extend(vec![7u8; 258]);
        v
    }

    /// Every construct the filter distinguishes, with its literal canonical output.
    pub fn canon_case() -> (Vec<u8>, Vec<u8>) {
        let base = jpeg_encode(16, 16, false, jpeg_encoder::SamplingFactor::F_2_2, true, 1, |x, y| gradient(x, y, 16, 16));
        let pieces = split(&base);
        let (mut inp, mut exp) = (Vec::new(), Vec::new());
        let n = pieces.len();
        let mut jfif_seen = false;
        for (idx, p) in pieces.iter().enumerate() {
            match p {
                Piece::Seg(0xD8, b) => {
                    inp.extend_from_slice(b);
                    exp.extend_from_slice(b);
                    inp.extend_from_slice(&[0x12, 0x00, FF, FF]); // garbage, fill
                }
                Piece::Seg(0xE0, b) if !jfif_seen => {
                    jfif_seen = true;
                    inp.extend_from_slice(b);
                    exp.extend_from_slice(&[FF, 0xE0, 0, 7, b'J', b'F', b'I', b'F', 0]);
                    // A second JFIF APP0 and an AVI1 one.
                    inp.extend_from_slice(&[FF, 0xE0, 0, 7, b'J', b'F', b'I', b'F', 0]);
                    inp.extend_from_slice(&[FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0]);
                    exp.extend_from_slice(&[FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0]);
                    inp.extend_from_slice(&[FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0]);
                    // Adobe (kept, canonical), a short APP14 and a bad-transform one (dropped).
                    let adobe = [FF, 0xEE, 0, 14, b'A', b'd', b'o', b'b', b'e', 0, 0x64, 0, 0, 0, 0, 1];
                    inp.extend_from_slice(&adobe);
                    exp.extend_from_slice(&adobe);
                    inp.extend_from_slice(&[FF, 0xEE, 0, 5, 1, 2, 3]);
                    inp.extend_from_slice(&[FF, 0xEE, 0, 14, b'A', b'd', b'o', b'b', b'e', 0, 0x64, 0, 0, 0, 0, 9]);
                    // Exif, ICC with a length free of FF, Photoshop, comment.
                    inp.extend_from_slice(&[FF, 0xE1, 0x01, 0x02]);
                    inp.extend(vec![b'E'; 256]);
                    inp.extend_from_slice(&[FF, 0xE2, 0x01, 0x02]);
                    inp.extend(vec![b'I'; 256]);
                    inp.extend_from_slice(&[FF, 0xED, 0, 6, 1, 2, 3, 4]);
                    inp.extend_from_slice(&[FF, 0xFE, 0, 5, b'h', b'i', b'!']);
                }
                Piece::Seg(0xD9, b) => {
                    inp.extend_from_slice(b);
                    exp.extend_from_slice(b);
                    inp.extend_from_slice(&[0, 1, FF, 2]); // padding after EOI, never read
                }
                Piece::Seg(_, b) => {
                    // Junk between segments: FF 00, a stray RST, fill, garbage.
                    inp.extend_from_slice(&[0x55, FF, 0x00, FF, 0xD3, FF, FF]);
                    inp.extend_from_slice(b);
                    exp.extend_from_slice(b);
                }
                Piece::Entropy(b) => {
                    inp.extend_from_slice(b);
                    exp.extend_from_slice(b);
                    // Between scans: fill, then an APP2 and a zero-length APP1 (dropped).
                    inp.extend(leak_unit(2));
                    inp.extend_from_slice(&[FF, FF, 0xE1, 0, 2]);
                    if idx + 2 == n {
                        inp.extend_from_slice(&[FF, FF, FF]);
                    }
                }
            }
        }
        (inp, exp)
    }

    #[test]
    fn oracle_accepts_the_literal_expected_stream_and_rejects_leaks() {
        let (inp, exp) = canon_case();
        oracle(&exp).unwrap();
        assert!(oracle(&inp).is_err());
        // The oracle itself catches the reviewer's literal-filter leaks.
        let mut bad = exp.clone();
        bad.splice(2..2, [FF]);
        assert!(oracle(&bad).is_err(), "a lone fill byte");
        let mut bad = exp.clone();
        bad.splice(2..2, [0x00]);
        assert!(oracle(&bad).is_err(), "garbage at a unit start");
        let mut bad = exp.clone();
        bad.splice(2..2, [FF, 0xE2, 0, 4, 1, 1]);
        assert!(oracle(&bad).is_err(), "APP2");
        let mut bad = exp.clone();
        bad.splice(2..2, [FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0, FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0]);
        assert!(oracle(&bad).is_err(), "AVI1 twice");
    }

    #[test]
    fn f_canon_literal_output() {
        let (inp, exp) = canon_case();
        let p = pump(&inp, BUF, 4096, vec![]);
        assert!(!p.errored, "{:?}", p.verdict);
        assert_eq!(p.out, exp);
    }

    // RS15c: a cut at every boundary and a single-byte source at every offset, over inner
    // buffer capacities and decoder-side read sizes.
    #[test]
    fn f_canon_every_split_gives_the_same_stream() {
        let (inp, exp) = canon_case();
        for cap in [1usize, 2, 3, 7, 13] {
            for rs in [1usize, 2, 4096] {
                for i in 0..=inp.len() {
                    let p = pump(&inp, cap, rs, vec![i]);
                    assert_eq!(p.out, exp, "cap {} read {} cut {}", cap, rs, i);
                }
            }
        }
        for rs in [1usize, 3] {
            for i in 0..inp.len() {
                let cuts = vec![i, i + 1];
                let p = pump(&inp, 5, rs, cuts);
                assert_eq!(p.out, exp, "single byte at {}", i);
            }
        }
    }

    fn sticky_source() -> Vec<u8> {
        let base = jpeg420(16, 16);
        let mut pieces = split(&base);
        let sof = pieces.iter().position(|p| matches!(p, Piece::Seg(0xC0, _))).unwrap();
        let dup = pieces[sof].clone();
        pieces.insert(sof + 1, dup);
        let mut v = join(&pieces);
        v.extend(vec![0u8; 4096]);
        v
    }

    struct CountingBuf {
        data: Vec<u8>,
        pos: usize,
        fills: std::rc::Rc<std::cell::Cell<usize>>,
    }
    impl Read for CountingBuf {
        fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
            let n = b.len().min(self.data.len() - self.pos);
            b[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
            self.pos += n;
            Ok(n)
        }
    }
    impl BufRead for CountingBuf {
        fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
            self.fills.set(self.fills.get() + 1);
            Ok(&self.data[self.pos..])
        }
        fn consume(&mut self, n: usize) {
            self.pos += n;
        }
    }

    // RS16b: after a verdict every read fails and no input is touched.
    #[test]
    fn a_verdict_is_sticky_and_stops_reading_input() {
        let fills = std::rc::Rc::new(std::cell::Cell::new(0));
        let shared = FilterShared::new();
        let src = CountingBuf { data: sticky_source(), pos: 0, fills: fills.clone() };
        let mut f = JpegFilter::new(src, shared.clone());
        let mut buf = [0u8; 64];
        loop {
            if f.read(&mut buf).is_err() {
                break;
            }
        }
        assert_eq!(shared.verdict.get(), Some(FilterVerdict::Malformed("second SOF")));
        let at_verdict = fills.get();
        for _ in 0..10 {
            assert!(f.read(&mut buf).is_err());
        }
        assert_eq!(fills.get(), at_verdict);
        assert_eq!(f.read(&mut []).unwrap(), 0);
    }

    /// A `BufRead` that fails with a recognisable error at `fail_at` bytes consumed.
    struct FailingBuf {
        data: Vec<u8>,
        pos: usize,
        fail_at: usize,
    }
    impl Read for FailingBuf {
        fn read(&mut self, _b: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }
    impl BufRead for FailingBuf {
        fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
            if self.pos >= self.fail_at {
                return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "below"));
            }
            Ok(&self.data[self.pos..self.fail_at.min(self.data.len())])
        }
        fn consume(&mut self, n: usize) {
            self.pos += n;
        }
    }

    // An error from the reader below passes through unchanged: never turned into EOF, a
    // verdict or another error, in every filter state.
    #[test]
    fn errors_from_below_pass_through_unchanged() {
        let (inp, _) = canon_case();
        for at in 1..inp.len() - 8 {
            let shared = FilterShared::new();
            let mut f = JpegFilter::new(FailingBuf { data: inp.clone(), pos: 0, fail_at: at }, shared.clone());
            let mut buf = [0u8; 64];
            let err = loop {
                match f.read(&mut buf) {
                    Ok(0) => panic!("error at {} became EOF", at),
                    Ok(_) => {}
                    Err(e) => break e,
                }
            };
            assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied, "at {}", at);
            assert_eq!(err.to_string(), "below", "at {}", at);
            assert_eq!(shared.verdict.get(), None, "at {}", at);
        }
    }

    // RS15e (tight): every loop iteration consumes input or returns output, so the step count
    // stays within input plus output plus a constant. A zero-length dropped segment must not
    // re-enter a state without consuming, and a large dropped payload must be skipped in
    // buffer runs rather than staged byte by byte.
    #[test]
    fn dropped_segments_are_consumed_without_idle_or_bytewise_steps() {
        let mut zero = vec![FF, 0xD8];
        for _ in 0..64 {
            zero.extend_from_slice(&[FF, 0xE1, 0, 2]);
        }
        zero.extend_from_slice(&[FF, 0xD9]);
        let p = pump(&zero, BUF, 4096, vec![]);
        assert!(!p.errored, "{:?}", p.verdict);
        assert_eq!(p.out, [FF, 0xD8, FF, 0xD9]);
        assert!(p.steps <= zero.len() as u64 + p.out.len() as u64 + 4, "zero-length steps {}", p.steps);

        let mut big = vec![FF, 0xD8, FF, 0xE2, 0xFF, 0xFF];
        big.extend(vec![7u8; 65_533]);
        big.extend_from_slice(&[FF, 0xD9]);
        let p = pump(&big, BUF, 4096, vec![]);
        assert!(!p.errored, "{:?}", p.verdict);
        assert_eq!(p.out, [FF, 0xD8, FF, 0xD9]);
        assert!(p.steps < 64, "a dropped APP2 took {} steps", p.steps);
    }

    // RS15e: seeded token fuzz with a progress counter.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u32 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 33) as u32
        }
        fn below(&mut self, n: u32) -> u32 {
            self.next() % n
        }
    }

    fn junk(r: &mut Lcg, out: &mut Vec<u8>, entropy_ok: bool) {
        let _ = entropy_ok;
        match r.below(9) {
            0 => out.extend(vec![FF; 1 + r.below(5) as usize]),
            1 => out.extend((0..1 + r.below(4)).map(|_| (r.below(0xFE) + 1) as u8 & 0x7F | 1)),
            2 => out.extend_from_slice(&[FF, 0]),
            3 => out.extend_from_slice(&[FF, 0xD0 + r.below(8) as u8]),
            4 => {
                // A dropped segment, with FF-free or FF-containing payload.
                let m = [0xE1u8, 0xE2, 0xED, 0xFE, 0xE5, 0xC8, 0xF3, 0xEF, 0xDC][r.below(9) as usize];
                let len = r.below(300) as usize;
                out.extend_from_slice(&[FF, m, ((len + 2) >> 8) as u8, ((len + 2) & 0xFF) as u8]);
                let with_ff = r.below(2) == 0;
                out.extend((0..len).map(|_| if with_ff { r.below(256) as u8 } else { r.below(255) as u8 }));
            }
            5 => out.extend_from_slice(&[FF, 0xE1, 0, 2]),
            6 => out.extend_from_slice(&[FF, 0xE0, 0, 7, b'J', b'F', b'I', b'F', 0]),
            7 => out.extend_from_slice(&[FF, 0xEE, 0, 14, b'A', b'd', b'o', b'b', b'e', 0, 0x64, 0, 0, 0, 0, r.below(3) as u8]),
            _ => out.extend_from_slice(&[FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0]),
        }
    }

    fn fuzz_case(r: &mut Lcg) -> (Vec<u8>, bool) {
        let ev = empty_sos(16, 16, 0);
        // Pieces of the header of `empty_sos`: SOI | DQT | DHT | DHT | SOF.
        let (dqt, dht1, dht2, sof) = (&ev[2..71], &ev[71..93], &ev[93..115], &ev[115..ev.len() - 2]);
        let mut v = vec![FF, 0xD8];
        for unit in [dqt, dht1, dht2, sof] {
            for _ in 0..r.below(3) {
                junk(r, &mut v, false);
            }
            v.extend_from_slice(unit);
        }
        let scans = 1 + r.below(3);
        for _ in 0..scans {
            for _ in 0..r.below(3) {
                junk(r, &mut v, false);
            }
            v.extend_from_slice(&[FF, 0xDA, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0]);
            for _ in 0..r.below(40) {
                match r.below(6) {
                    0 => v.extend_from_slice(&[FF, 0]),
                    1 => v.extend_from_slice(&[FF, 0xD0 + r.below(8) as u8]),
                    _ => v.push(r.below(255) as u8),
                }
            }
            for _ in 0..r.below(3) {
                if r.below(2) == 0 {
                    v.extend(vec![FF; 1 + r.below(3) as usize]);
                }
                junk(r, &mut v, true);
            }
        }
        for _ in 0..r.below(2) {
            v.extend(vec![FF; 1 + r.below(3) as usize]);
        }
        v.extend_from_slice(&[FF, 0xD9]);
        if r.below(3) == 0 {
            for _ in 0..r.below(5) {
                v.push(r.below(256) as u8);
            }
        }
        let truncated = r.below(5) == 0;
        if truncated {
            let at = r.below(v.len() as u32) as usize;
            v.truncate(at);
        }
        (v, truncated)
    }

    #[test]
    fn seeded_fuzz_is_split_independent_progressing_and_canonical() {
        let mut r = Lcg(0x5EED_AB12_CD34_EF56);
        let mut oks = 0;
        for case in 0..2000 {
            let (data, truncated) = fuzz_case(&mut r);
            let a = pump(&data, BUF, 4096, vec![]);
            let b = pump(&data, 1, 1, vec![]);
            let c = pump(&data, 7, 3, (0..data.len()).step_by(1 + (r.below(9) as usize)).collect());
            assert_eq!(a.out, b.out, "case {}", case);
            assert_eq!(a.out, c.out, "case {}", case);
            assert_eq!((a.errored, a.verdict), (b.errored, b.verdict), "case {}", case);
            assert_eq!((a.errored, a.verdict), (c.errored, c.verdict), "case {}", case);
            // Progress: steps are bounded by the input and output sizes.
            for p in [&a, &b, &c] {
                assert!(p.steps <= 4 * (data.len() as u64 + p.out.len() as u64) + 64, "case {} steps {}", case, p.steps);
            }
            if !a.errored && a.out.ends_with(&[FF, 0xD9]) {
                oracle(&a.out).unwrap_or_else(|e| panic!("case {}: {}", case, e));
                oks += 1;
            } else {
                assert!(truncated || a.errored, "case {} should have been well formed", case);
            }
        }
        assert!(oks > 1000, "only {} complete cases", oks);
    }
}
// FILTER-TESTS-END
#[cfg(test)]
mod gap_tests {
    //! The two-guard stop mechanism on the real stack: the flag is raised by the test source
    //! at a byte offset, independently of the check sites.
    use super::filter_tests::{oracle, pump};
    use super::fixtures::*;
    use super::*;
    use std::io::{Cursor, Read, Seek, SeekFrom};
    use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

    const FF: u8 = 0xFF;

    struct Probe {
        data: Vec<u8>,
        pos: usize,
        flag_x: Option<usize>,
        flag: Arc<AtomicBool>,
        tok: Arc<StopToken>,
        scans: Arc<AtomicU32>,
        scans_at_flag: Arc<AtomicU32>,
        flagged: Arc<AtomicBool>,
        after: Arc<AtomicUsize>,
        max_req: Arc<AtomicUsize>,
        fail_at: Option<usize>,
        failed: Arc<AtomicBool>,
        intr_at: Option<usize>,
        intr_done: bool,
    }

    impl Probe {
        fn note_after(&self) {
            if self.flagged.load(Ordering::Relaxed) || self.tok.tripped() != 0 || self.flag.load(Ordering::Relaxed) {
                self.after.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    impl Read for Probe {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.note_after();
            self.max_req.fetch_max(buf.len(), Ordering::Relaxed);
            if let Some(ia) = self.intr_at {
                if !self.intr_done && self.pos >= ia {
                    self.intr_done = true;
                    return Err(std::io::ErrorKind::Interrupted.into());
                }
            }
            let mut n = buf.len().min(self.data.len() - self.pos);
            if let Some(f) = self.fail_at {
                if self.pos >= f {
                    self.failed.store(true, Ordering::Relaxed);
                    return Err(std::io::Error::new(std::io::ErrorKind::Other, "injected"));
                }
                n = n.min(f - self.pos);
            }
            buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
            self.pos += n;
            if let Some(x) = self.flag_x {
                if n > 0 && self.pos > x && self.pos - n <= x && !self.flagged.load(Ordering::Relaxed) {
                    self.scans_at_flag.store(self.scans.load(Ordering::Relaxed), Ordering::Relaxed);
                    self.flag.store(true, Ordering::Relaxed);
                    self.flagged.store(true, Ordering::Relaxed);
                }
            }
            Ok(n)
        }
    }

    impl Seek for Probe {
        fn seek(&mut self, p: SeekFrom) -> std::io::Result<u64> {
            self.note_after();
            match p {
                SeekFrom::Start(s) => {
                    self.pos = s as usize;
                    Ok(s)
                }
                _ => Err(std::io::ErrorKind::Unsupported.into()),
            }
        }
    }

    struct Run {
        out: Result<Outcome, Transient>,
        after: usize,
        max_req: usize,
        flagged: bool,
        failed: bool,
        scans_at_flag: u32,
        scans_end: u32,
        trip: u8,
    }

    fn go(data: &[u8], cap: usize, flag_x: Option<usize>, fail_at: Option<usize>, intr_at: Option<usize>, fire_at: usize) -> Run {
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        tok.fire_at.store(fire_at, Ordering::Relaxed);
        let shared = FilterShared::new();
        let after = Arc::new(AtomicUsize::new(0));
        let max_req = Arc::new(AtomicUsize::new(0));
        let flagged = Arc::new(AtomicBool::new(false));
        let failed = Arc::new(AtomicBool::new(false));
        let scans_at_flag = Arc::new(AtomicU32::new(0));
        let probe = Probe {
            data: data.to_vec(),
            pos: 0,
            flag_x,
            flag: tok.deadline_flag(),
            tok: tok.clone(),
            scans: shared.emitted_scans.clone(),
            scans_at_flag: scans_at_flag.clone(),
            flagged: flagged.clone(),
            after: after.clone(),
            max_req: max_req.clone(),
            fail_at,
            failed: failed.clone(),
            intr_at,
            intr_done: false,
        };
        let out = decode_source(probe, cap, 168, &Limits::for_target(), &tok, &shared);
        Run {
            out,
            after: after.load(Ordering::Relaxed),
            max_req: max_req.load(Ordering::Relaxed),
            flagged: flagged.load(Ordering::Relaxed),
            failed: failed.load(Ordering::Relaxed),
            scans_at_flag: scans_at_flag.load(Ordering::Relaxed),
            scans_end: shared.emitted_scans.load(Ordering::Relaxed),
            trip: tok.tripped(),
        }
    }

    fn is_px(o: &Result<Outcome, Transient>) -> bool {
        matches!(o, Ok(Outcome::Pixels { .. }))
    }

    fn is_deadline(o: &Result<Outcome, Transient>) -> bool {
        matches!(o, Ok(Outcome::Refused(Reason::Deadline)))
    }

    /// F-GAP: every drop class and filter state around a valid 16x16 frame.
    fn gap_fixture(big: bool) -> Vec<u8> {
        let base = jpeg_encode(16, 16, false, jpeg_encoder::SamplingFactor::F_2_2, false, 2, |x, y| gradient(x, y, 16, 16));
        let pieces = split(&base);
        let rep = |unit: &[u8]| -> Vec<u8> {
            let n = if big { (3 * BUF).div_ceil(unit.len()) } else { 3 };
            unit.repeat(n)
        };
        let mut leak = vec![FF, FF, 0xE2, 0x01, 0x04];
        leak.extend(vec![7u8; 258]);
        let mut app1 = vec![FF, 0xE1, 0x01, 0x02];
        app1.extend(vec![1u8; 256]);
        let pre = [rep(&[0x00]), rep(&[FF]), rep(&[FF, 0x00]), rep(&[FF, 0xD0]), rep(&[FF, 0xE1, 0x00, 0x02]), rep(&leak), rep(&app1)];
        let post = [rep(&[FF]), rep(&leak), rep(&app1)];
        let mut v = Vec::new();
        let mut k = 0;
        let mut seen_sos = false;
        for p in &pieces {
            match p {
                Piece::Seg(m, b) => {
                    v.extend_from_slice(b);
                    if *m == 0xDA {
                        seen_sos = true;
                    } else if *m != 0xD8 && !seen_sos && k < pre.len() {
                        v.extend_from_slice(&pre[k]);
                        k += 1;
                    }
                }
                Piece::Entropy(b) => {
                    v.extend_from_slice(b);
                    for c in &post {
                        v.extend_from_slice(c);
                    }
                }
            }
        }
        assert_eq!(k, pre.len(), "enough segments to carry every class");
        v
    }

    fn sos_scans(w: u16, n: usize) -> Vec<u8> {
        empty_sos(w, w, n)
    }

    #[test]
    fn f_gap_fixture_is_valid_canonical_and_decodes() {
        let v = gap_fixture(false);
        let p = pump(&v, 7, 4096, vec![]);
        assert!(!p.errored, "{:?}", p.verdict);
        oracle(&p.out).unwrap();
        let r = go(&v, 7, None, None, None, 0);
        assert!(is_px(&r.out), "{:?}", r.out.as_ref().map(|o| match o { Outcome::Refused(r) => format!("{:?}", r), _ => "px".into() }));
    }

    // RS-GAP, small buffers: every offset, deadline at the offset, no source read after it.
    #[test]
    fn flag_at_every_offset_of_f_gap_stops_before_another_source_read() {
        let v = gap_fixture(false);
        for cap in [1usize, 2, 7, 61] {
            let mut flagged = 0;
            for x in 0..v.len() {
                let r = go(&v, cap, Some(x), None, None, 0);
                if r.flagged {
                    flagged += 1;
                    assert!(is_deadline(&r.out), "cap {} x {}", cap, x);
                    assert_eq!(r.after, 0, "cap {} x {}: source read after the flag", cap, x);
                } else {
                    assert!(is_px(&r.out), "cap {} x {}", cap, x);
                }
            }
            assert!(flagged + 80 >= v.len(), "cap {} flagged {} of {}", cap, flagged, v.len());
        }
    }

    /// A `BufRead` between the `BufReader` and the filter that raises the deadline when the
    /// consumer has taken more than `at` bytes: a flag raised outside any source read.
    struct Shim<R: std::io::BufRead> {
        inner: R,
        flag: Arc<AtomicBool>,
        at: usize,
        consumed: usize,
    }
    impl<R: std::io::BufRead> Read for Shim<R> {
        fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
            self.inner.read(b)
        }
    }
    impl<R: std::io::BufRead> std::io::BufRead for Shim<R> {
        fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
            self.inner.fill_buf()
        }
        fn consume(&mut self, n: usize) {
            self.consumed += n;
            if self.consumed > self.at {
                self.flag.store(true, Ordering::Relaxed);
            }
            self.inner.consume(n)
        }
    }

    // The inner guard checks before its read, not after: a flag raised between two reads
    // stops the next OS read from starting.
    #[test]
    fn a_flag_raised_between_reads_prevents_the_next_source_read() {
        let v = gap_fixture(false);
        for at in 0..v.len() - 40 {
            let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
            let shared = FilterShared::new();
            let after = Arc::new(AtomicUsize::new(0));
            let probe = Probe {
                data: v.clone(),
                pos: 0,
                flag_x: None,
                flag: tok.deadline_flag(),
                tok: tok.clone(),
                scans: shared.emitted_scans.clone(),
                scans_at_flag: Arc::new(AtomicU32::new(0)),
                flagged: Arc::new(AtomicBool::new(false)),
                after: after.clone(),
                max_req: Arc::new(AtomicUsize::new(0)),
                fail_at: None,
                failed: Arc::new(AtomicBool::new(false)),
                intr_at: None,
                intr_done: false,
            };
            let src = BufReader::with_capacity(7, super::reader::InnerGuard::new(probe, tok.clone()));
            let shim = Shim { inner: src, flag: tok.deadline_flag(), at, consumed: 0 };
            let filter = JpegFilter::new(shim, shared.clone());
            let result = jpeg_path::run(super::reader::OuterGuard::new(filter, tok.clone()), &shared, 168, &Limits::for_target(), &tok);
            let out = finalize(result, &tok, shared.verdict.get());
            assert!(is_deadline(&out), "at {}", at);
            assert_eq!(after.load(Ordering::Relaxed), 0, "at {}: an OS read started after the flag", at);
        }
    }

    // RS-GAP at the real 64 KiB buffer, each drop class several buffers long.
    #[test]
    fn flag_in_big_drop_runs_stops_within_one_buffer() {
        let v = gap_fixture(true);
        assert!(v.len() > 2 * 1024 * 1024 / 2);
        // Every 16 KiB, plus both sides of each 64 KiB boundary (the 4 KiB stride of the
        // plan costs minutes in the unoptimised test profile).
        let mut xs: Vec<usize> = (0..v.len()).step_by(16 * 1024).collect();
        for b in (BUF..v.len()).step_by(BUF) {
            xs.extend([b - 1, b, b + 1]);
        }
        let mut flagged = 0;
        for x in xs {
            let r = go(&v, BUF, Some(x), None, None, 0);
            if r.flagged {
                flagged += 1;
                assert!(is_deadline(&r.out), "x {}", x);
                assert_eq!(r.after, 0, "x {}", x);
            }
        }
        assert!(flagged > 100, "flagged {}", flagged);
    }

    // RS-GAP on many scans: the outer guard stops a decoder that makes no reads in a scan.
    #[test]
    fn flag_during_many_scans_stops_within_one_scan() {
        let v = sos_scans(64, 128);
        assert!(is_px(&go(&v, 61, None, None, None, 0).out));
        for cap in [7usize, 61, 4096] {
            let mut n = 0;
            for x in (0..v.len()).step_by(if cap == 7 { 11 } else { 3 }) {
                let r = go(&v, cap, Some(x), None, None, 0);
                if r.flagged {
                    n += 1;
                    assert!(is_deadline(&r.out), "cap {} x {}", cap, x);
                    assert_eq!(r.after, 0);
                    assert!(r.scans_end <= r.scans_at_flag + 1, "cap {} x {}: {} scans after the flag at {}", cap, x, r.scans_end, r.scans_at_flag);
                }
            }
            assert!(n > 100);
        }
    }

    #[test]
    fn png_flag_at_every_offset_stops_before_another_source_read() {
        let png = rgb_png(24, 16, |x, y| [x as u8, y as u8, 3]);
        let mut with_chunks = png_encode(24, 16, png::ColorType::Rgb, png::BitDepth::Eight, &vec![5u8; 24 * 16 * 3], |wr| {
            wr.write_chunk(png::chunk::eXIf, &vec![9u8; 300]).unwrap();
        });
        with_chunks.extend_from_slice(&[0; 3]);
        for data in [&png, &with_chunks, &interlaced_rgba_png(19, 13, |x, y| [x as u8, y as u8, 1, 255])] {
            for cap in [1usize, 7, 61] {
                for x in (0..data.len()).step_by(2) {
                    let r = go(data, cap, Some(x), None, None, 0);
                    if r.flagged {
                        assert!(is_deadline(&r.out), "cap {} x {}", cap, x);
                        assert_eq!(r.after, 0, "cap {} x {}", cap, x);
                    }
                }
            }
        }
    }

    // RS-FINAL: a flag raised while the last byte is handed out never lets pixels through.
    #[test]
    fn flag_on_the_last_bytes_is_a_deadline_not_pixels() {
        for data in [jpeg420(16, 16), rgb_png(16, 16, |x, y| [x as u8, y as u8, 0]), jpeg_progressive(16, 16, jpeg_encoder::SamplingFactor::F_1_1)] {
            for cap in [7usize, 1024] {
                for back in 1..=8 {
                    let r = go(&data, cap, Some(data.len() - back), None, None, 0);
                    if r.flagged {
                        assert!(is_deadline(&r.out), "cap {} back {}", cap, back);
                    }
                }
            }
        }
    }

    // RS-PROP: a stop at the n-th check propagates through every layer and state.
    #[test]
    fn a_stop_at_the_nth_check_propagates() {
        let data = gap_fixture(false);
        let total = go(&data, 7, None, None, None, 0);
        assert!(is_px(&total.out));
        let png = rgb_png(40, 30, |x, y| [x as u8, y as u8, 3]);
        for d in [&data, &png] {
            let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
            let _ = decode_source(Cursor::new(d.clone()), 7, 168, &Limits::for_target(), &tok, &FilterShared::new());
            let checks = tok.checks.load(Ordering::Relaxed);
            assert!(checks > 30);
            for n in 1..=checks {
                let r = go(d, 7, None, None, None, n);
                assert!(is_deadline(&r.out), "check {}", n);
                assert_eq!(r.after, 0, "check {}", n);
            }
        }
    }

    // RS-IO: an I/O error is classified at the source, never as a format problem.
    #[test]
    fn io_errors_at_every_offset_are_transient_io() {
        let jpeg = gap_fixture(false);
        let png = rgb_png(40, 30, |x, y| [x as u8, y as u8, 3]);
        let ipng = interlaced_rgba_png(33, 21, |x, y| [x as u8, y as u8, 1, 255]);
        for data in [&jpeg, &png, &ipng] {
            for n in (0..data.len()).step_by(3) {
                let r = go(data, 7, None, Some(n), None, 0);
                if r.failed {
                    assert!(matches!(r.out, Err(Transient::Io(_))), "offset {}: {:?}", n, r.out.as_ref().map(|_| ()));
                    assert_eq!(r.trip, super::stop::TRIP_IO);
                } else {
                    assert!(is_px(&r.out));
                }
            }
        }
    }

    // EINTR from the file is retried at the source, for both decoders.
    #[test]
    fn an_interrupted_read_is_invisible() {
        let jpeg = gap_fixture(false);
        let png = rgb_png(40, 30, |x, y| [x as u8, y as u8, 3]);
        for data in [&jpeg, &png] {
            for n in 0..data.len() {
                let r = go(data, 7, None, None, Some(n), 0);
                assert!(is_px(&r.out), "offset {}", n);
                assert_eq!(r.trip, 0);
            }
        }
    }

    // RS6 per format: pre-set cancel, pre-set deadline, failing reader.
    #[test]
    fn preset_flags_and_failing_reader_per_format() {
        let fixtures: Vec<(&str, Vec<u8>)> = vec![
            ("png", rgb_png(64, 64, |x, y| [x as u8, y as u8, 0])),
            ("png-interlaced", interlaced_rgba_png(64, 64, |x, y| [x as u8, y as u8, 0, 255])),
            ("jpeg-baseline", jpeg420(64, 64)),
            ("jpeg-progressive", jpeg_progressive(64, 64, jpeg_encoder::SamplingFactor::F_2_2)),
        ];
        for (name, data) in fixtures {
            let t = StopToken::new(Arc::new(AtomicBool::new(true)));
            let r = decode_source(Cursor::new(data.clone()), BUF, 168, &Limits::for_target(), &t, &FilterShared::new());
            assert_eq!(r, Err(Transient::Cancelled), "{}", name);
            let t = StopToken::new(Arc::new(AtomicBool::new(false)));
            t.deadline_flag().store(true, Ordering::Relaxed);
            let r = decode_source(Cursor::new(data.clone()), BUF, 168, &Limits::for_target(), &t, &FilterShared::new());
            assert_eq!(r, Ok(Outcome::Refused(Reason::Deadline)), "{}", name);
            let r = go(&data, BUF, None, Some(data.len() / 2), None, 0);
            assert!(matches!(r.out, Err(Transient::Io(_))), "{}", name);
        }
    }

    // M-INCAP's target: no read request above the buffer size reaches the source.
    #[test]
    fn the_source_never_sees_a_request_above_the_buffer() {
        for data in [jpeg420(300, 200), rgb_png(300, 200, |x, y| [x as u8, y as u8, 0])] {
            let r = go(&data, BUF, None, None, None, 0);
            assert!(is_px(&r.out));
            assert!(r.max_req <= BUF);
        }
    }

    // RS6b: deterministic cancel inside a many-scan file.
    #[test]
    fn a_cancel_raised_at_a_scan_stops_within_that_scan() {
        let v = sos_scans(300, 50);
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let tok2 = StopToken::new(cancel_flag.clone());
        let shared = FilterShared::new();
        // The hook cannot reach the filter built inside `decode_source`, so watch the
        // counter from a source that cancels once the third scan header was read.
        struct Watch {
            inner: Cursor<Vec<u8>>,
            scans: Arc<AtomicU32>,
            cancel: Arc<AtomicBool>,
        }
        impl Read for Watch {
            fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
                if self.scans.load(Ordering::Relaxed) >= 3 {
                    self.cancel.store(true, Ordering::Relaxed);
                }
                self.inner.read(b)
            }
        }
        impl Seek for Watch {
            fn seek(&mut self, p: SeekFrom) -> std::io::Result<u64> {
                self.inner.seek(p)
            }
        }
        let w = Watch { inner: Cursor::new(v), scans: shared.emitted_scans.clone(), cancel: cancel_flag };
        let r = decode_source(w, 13, 168, &Limits::for_target(), &tok2, &shared);
        assert_eq!(r, Err(Transient::Cancelled));
        assert!(shared.emitted_scans.load(Ordering::Relaxed) <= 3 + 2, "{} scans", shared.emitted_scans.load(Ordering::Relaxed));
        let _ = tok;
    }

    // RS6d: the scan cap is a persisted Malformed, not an I/O error.
    #[test]
    fn scan_cap_is_malformed_and_128_scans_decode() {
        assert!(is_px(&go(&sos_scans(64, 128), 61, None, None, None, 0).out));
        let r = go(&sos_scans(64, 129), 61, None, None, None, 0);
        assert_eq!(r.out, Ok(Outcome::Refused(Reason::Malformed)));
        assert_eq!(r.trip, 0);
    }

    // RS6f: the real watchdog stops a many-scan decode within one scan of its fire.
    #[test]
    fn the_watchdog_stops_a_long_decode_within_one_scan() {
        let v = sos_scans(3000, 128);
        let slot = SlotState::new();
        let fired_at = Arc::new(AtomicU32::new(u32::MAX));
        let shared = FilterShared::new();
        let (f2, s2) = (fired_at.clone(), shared.emitted_scans.clone());
        let cfg = JobCfg {
            deadline: std::time::Duration::from_millis(100),
            step: std::time::Duration::from_millis(10),
            orphan_wait: std::time::Duration::from_millis(50),
            on_fire: Some(Arc::new(move || f2.store(s2.load(Ordering::Relaxed), Ordering::Relaxed))),
        };
        let r = run_job(&slot, Arc::new(AtomicBool::new(false)), &cfg, |tok| {
            decode_source(Cursor::new(v), BUF, 168, &Limits::for_target(), &tok, &shared)
        })
        .unwrap();
        assert_eq!(r, Ok(Outcome::Refused(Reason::Deadline)));
        let k = fired_at.load(Ordering::Relaxed);
        assert!(k < 128, "the watchdog never fired");
        assert!(shared.emitted_scans.load(Ordering::Relaxed) <= k + 1, "{} scans at return, {} at the fire", shared.emitted_scans.load(Ordering::Relaxed), k);
    }

    // RS6c, diagnostic: wall-clock cost of one zero-filled scan and the latency from the
    // watchdog's fire to the return, at the 400 MP cap. Run with `--ignored --nocapture`.
    #[test]
    #[ignore]
    fn diagnostic_scan_time_and_watchdog_latency_at_the_pixel_cap() {
        let v = sos_scans(20_000, 3);
        let tok = StopToken::new(Arc::new(AtomicBool::new(false)));
        let shared = FilterShared::new();
        let t0 = std::time::Instant::now();
        let r = decode_source(Cursor::new(sos_scans(20_000, 1)), BUF, 168, &Limits::for_target(), &tok, &shared);
        println!("RS6c one 400 MP zero-filled scan, full decode: {:?} ({:?})", t0.elapsed(), r.map(|o| matches!(o, Outcome::Pixels { .. })));
        let slot = SlotState::new();
        let cfg = JobCfg { deadline: std::time::Duration::from_millis(200), step: std::time::Duration::from_millis(20), orphan_wait: std::time::Duration::from_millis(50), on_fire: None };
        let started = std::time::Instant::now();
        let shared = FilterShared::new();
        let r = run_job(&slot, Arc::new(AtomicBool::new(false)), &cfg, |tok| decode_source(Cursor::new(v), BUF, 168, &Limits::for_target(), &tok, &shared)).unwrap();
        println!("RS6c deadline 200 ms, returned after {:?}: {:?}", started.elapsed(), r.map(|o| matches!(o, Outcome::Pixels { .. })));
    }

    // The reviewer's leak input, scaled: APP2 units with fill bytes and FF-free lengths
    // never reach the decoder, whatever the size.
    #[test]
    fn leak_input_is_dropped_by_the_filter() {
        let base = jpeg420(16, 16);
        let pieces = split(&base);
        let mut v = vec![FF, 0xD8];
        let mut unit = vec![FF, FF, 0xE2, 0xFE, 0x00];
        unit.extend(vec![1u8; 0xFDFE]);
        for _ in 0..40 {
            v.extend_from_slice(&unit);
        }
        v.extend_from_slice(&join(&pieces[1..]));
        let p = pump(&v, BUF, 4096, vec![]);
        assert!(!p.errored);
        oracle(&p.out).unwrap();
        assert!(p.out.len() < 2000);
        assert!(is_px(&go(&v, BUF, None, None, None, 0).out));
    }

    // RS15: the decode through the filter equals the decode of the original bytes.
    fn plain(b: &[u8]) -> Result<Vec<u8>, String> {
        jpeg_decoder::Decoder::new(Cursor::new(b.to_vec())).decode().map_err(|e| format!("{:?}", e))
    }
    fn filtered(b: &[u8]) -> Result<Vec<u8>, String> {
        let shared = FilterShared::new();
        let f = JpegFilter::new(BufReader::with_capacity(7, Cursor::new(b.to_vec())), shared);
        jpeg_decoder::Decoder::new(f).decode().map_err(|e| format!("{:?}", e))
    }

    fn retag(jpeg: &[u8], ids: [u8; 3]) -> Vec<u8> {
        let mut pieces = split(jpeg);
        for p in &mut pieces {
            if let Piece::Seg(m, b) = p {
                match *m {
                    0xC0..=0xC2 => (0..3).for_each(|i| b[4 + 6 + 3 * i] = ids[i]),
                    0xDA => (0..3).for_each(|i| b[5 + 2 * i] = ids[i]),
                    _ => {}
                }
            }
        }
        join(&pieces)
    }

    fn with_segment_after_soi(jpeg: &[u8], seg: &[u8]) -> Vec<u8> {
        let mut v = jpeg[..2].to_vec();
        v.extend_from_slice(seg);
        v.extend_from_slice(&jpeg[2..]);
        v
    }

    #[test]
    fn decode_through_the_filter_is_pixel_identical() {
        let gray = jpeg_encode(70, 50, true, jpeg_encoder::SamplingFactor::F_1_1, false, 0, |x, y| [(x * 3 + y) as u8; 3]);
        let restart = jpeg_encode(100, 70, false, jpeg_encoder::SamplingFactor::F_2_2, false, 3, |x, y| gradient(x, y, 100, 70));
        let prog_restart = jpeg_encode(90, 60, false, jpeg_encoder::SamplingFactor::F_2_1, true, 2, |x, y| gradient(x, y, 90, 60));
        let fixtures = vec![
            jpeg420(100, 70),
            jpeg444(65, 33),
            gray,
            restart,
            prog_restart,
            jpeg_progressive(80, 80, jpeg_encoder::SamplingFactor::F_2_2),
            jpeg_progressive(80, 80, jpeg_encoder::SamplingFactor::F_1_1),
        ];
        for (i, f) in fixtures.iter().enumerate() {
            assert!(plain(f).unwrap() == filtered(f).unwrap(), "fixture {}", i);
        }
        // Non-standard component ids: a JFIF APP0 keeps them YCbCr; without it an Adobe
        // transform 0 makes them RGB. The filter must keep both facts.
        let odd = retag(&jpeg444(48, 48), [10, 20, 30]);
        assert!(plain(&odd).unwrap() == filtered(&odd).unwrap());
        let mut no_jfif = split(&odd);
        no_jfif.retain(|p| !matches!(p, Piece::Seg(0xE0, _)));
        let adobe0 = [FF, 0xEE, 0, 14, b'A', b'd', b'o', b'b', b'e', 0, 0x64, 0, 0, 0, 0, 0];
        let a0 = with_segment_after_soi(&join(&no_jfif), &adobe0);
        assert!(plain(&a0).unwrap() == filtered(&a0).unwrap());
        assert!(plain(&odd).unwrap() != plain(&a0).unwrap(), "RGB and YCbCr must differ or the row proves nothing");
        // AVI1 MJPEG without Huffman tables decodes with the default tables.
        let mut pieces = split(&jpeg444(48, 48));
        pieces.retain(|p| !matches!(p, Piece::Seg(0xC4, _)));
        let no_dht = join(&pieces);
        assert!(plain(&no_dht).is_err());
        let avi1 = with_segment_after_soi(&no_dht, &[FF, 0xE0, 0, 7, b'A', b'V', b'I', b'1', 0]);
        assert!(plain(&avi1).unwrap() == filtered(&avi1).unwrap());
        assert!(filtered(&no_dht).is_err());
    }

    #[test]
    fn filter_output_of_every_encoder_fixture_passes_the_oracle() {
        for f in [jpeg420(100, 70), jpeg444(65, 33), jpeg_progressive(80, 80, jpeg_encoder::SamplingFactor::F_2_2)] {
            let p = pump(&f, 61, 5, vec![]);
            assert!(!p.errored);
            oracle(&p.out).unwrap();
        }
    }
}
// GAP-TESTS-END
