//! Allocation rows of the native avatar preview, measured with a counting allocator.
//!
//! One process-wide peak is measured, so every test takes `SERIAL` and resets the peak;
//! CI also runs this binary with `--test-threads=1`. The only `unsafe` here is the
//! counting allocator's `GlobalAlloc` impl, which delegates to `System`.
//!
//! Fixtures are synthetic and made at test time: images from `png` and `jpeg-encoder`,
//! plus hand-built headers and marker streams. Host sizes are indicative only.

use std::alloc::{GlobalAlloc, Layout, System};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use alib::avatar_preview::peak::{self, Limits, PngHeader, SofComponent, SofInfo};
use alib::avatar_preview::slot::{JobCfg, SlotState};
use alib::avatar_preview::{preview_with, Outcome, Reason, Transient};

struct Counting;
static CUR: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = System.alloc(l);
        if !p.is_null() {
            let now = CUR.fetch_add(l.size(), Ordering::Relaxed) + l.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l);
        CUR.fetch_sub(l.size(), Ordering::Relaxed);
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        let p = System.alloc_zeroed(l);
        if !p.is_null() {
            let now = CUR.fetch_add(l.size(), Ordering::Relaxed) + l.size();
            PEAK.fetch_max(now, Ordering::Relaxed);
        }
        p
    }
}

#[global_allocator]
static A: Counting = Counting;

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> std::sync::MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|p| p.into_inner())
}

const MIB: usize = 1024 * 1024;

fn dir() -> PathBuf {
    let d = std::env::temp_dir().join(format!("avatar-preview-alloc-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn cfg() -> JobCfg {
    JobCfg { deadline: Duration::from_secs(600), step: Duration::from_millis(100), orphan_wait: Duration::from_secs(2), on_fire: None }
}

/// Runs the preview and returns its outcome with the peak of live heap bytes above the
/// level at the start, with `rayon` limited to one thread (as the reviewer measured).
fn measure(path: &Path) -> (Result<Outcome, Transient>, usize) {
    let slot = SlotState::new();
    let pool = rayon::ThreadPoolBuilder::new().num_threads(1).build().unwrap();
    // Warm the first-use allocations (pool registry, thread-locals) outside the window.
    pool.install(|| ());
    let base = CUR.load(Ordering::Relaxed);
    PEAK.store(base, Ordering::Relaxed);
    let out = pool.install(|| preview_with(&slot, &cfg(), path, 168, Arc::new(AtomicBool::new(false))));
    let peak = PEAK.load(Ordering::Relaxed).saturating_sub(base);
    (out, peak)
}

fn write(name: &str, bytes: &[u8]) -> PathBuf {
    let p = dir().join(name);
    std::fs::write(&p, bytes).unwrap();
    p
}

fn refused(r: &Result<Outcome, Transient>) -> Option<Reason> {
    match r {
        Ok(Outcome::Refused(x)) => Some(*x),
        _ => None,
    }
}

fn is_pixels(r: &Result<Outcome, Transient>) -> bool {
    matches!(r, Ok(Outcome::Pixels { .. }))
}

// ---------------------------------------------------------------------------
// Fixture producers.
// ---------------------------------------------------------------------------

fn noise(x: u32, y: u32, salt: u32) -> u8 {
    let mut h = x.wrapping_mul(0x9E37_79B1) ^ y.wrapping_mul(0x85EB_CA6B) ^ salt.wrapping_mul(0xC2B2_AE35);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    (h & 0xFF) as u8
}

fn png_bytes(w: u32, h: u32, ct: png::ColorType, depth: png::BitDepth, channels: usize, bytes_per_sample: usize) -> Vec<u8> {
    let mut data = Vec::with_capacity(w as usize * h as usize * channels * bytes_per_sample);
    for y in 0..h {
        for x in 0..w {
            for c in 0..channels * bytes_per_sample {
                data.push(((x / 4 + y / 4) as u8).wrapping_add(noise(x, y, c as u32) & 7));
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(ct);
        enc.set_depth(depth);
        enc.write_header().unwrap().write_image_data(&data).unwrap();
    }
    out
}

fn crc32(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= u32::from(b);
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
    }
    !c
}

fn chunk(name: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut v = (data.len() as u32).to_be_bytes().to_vec();
    let mut body = name.to_vec();
    body.extend_from_slice(data);
    v.extend_from_slice(&body);
    v.extend_from_slice(&crc32(&body).to_be_bytes());
    v
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &x in data {
        a = (a + u32::from(x)) % 65521;
        b = (b + a) % 65521;
    }
    b << 16 | a
}

const PNG_SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// IHDR plus an empty IDAT: a PNG that claims a size and holds no image data.
fn png_header_only(w: u32, h: u32, color: u8, depth: u8, interlace: u8) -> Vec<u8> {
    let mut ihdr = w.to_be_bytes().to_vec();
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[depth, color, 0, 0, interlace]);
    let mut out = PNG_SIG.to_vec();
    out.extend(chunk(b"IHDR", &ihdr));
    out.extend(chunk(b"IDAT", &[]));
    out
}

/// An interlaced 8-bit RGBA PNG with stored zlib (the `png` encoder writes no Adam7).
fn interlaced_rgba_png(w: u32, h: u32) -> Vec<u8> {
    const PASSES: [(u32, u32, u32, u32); 7] = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)];
    let mut raw = Vec::new();
    for (x0, y0, dx, dy) in PASSES {
        let xs: Vec<u32> = (x0..w).step_by(dx as usize).collect();
        if xs.is_empty() {
            continue;
        }
        for y in (y0..h).step_by(dy as usize) {
            raw.push(0);
            for &x in &xs {
                raw.extend_from_slice(&[noise(x, y, 0) & 15, noise(x, y, 1) & 15, noise(x, y, 2) & 15, 255]);
            }
        }
    }
    let mut z = vec![0x78, 0x01];
    let mut blocks = raw.chunks(65535).peekable();
    while let Some(b) = blocks.next() {
        z.push(u8::from(blocks.peek().is_none()));
        z.extend_from_slice(&(b.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
        z.extend_from_slice(b);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut ihdr = w.to_be_bytes().to_vec();
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 1]);
    let mut out = PNG_SIG.to_vec();
    out.extend(chunk(b"IHDR", &ihdr));
    out.extend(chunk(b"IDAT", &z));
    out.extend(chunk(b"IEND", &[]));
    out
}

fn jpeg(w: u16, h: u16, sampling: jpeg_encoder::SamplingFactor, progressive: bool) -> Vec<u8> {
    let mut data = Vec::with_capacity(w as usize * h as usize * 3);
    for y in 0..u32::from(h) {
        for x in 0..u32::from(w) {
            data.push((x * 255 / u32::from(w)) as u8 ^ (noise(x, y, 0) & 3));
            data.push((y * 255 / u32::from(h)) as u8 ^ (noise(x, y, 1) & 3));
            data.push(((x + y) % 256) as u8 ^ (noise(x, y, 2) & 3));
        }
    }
    let mut out = Vec::new();
    let mut enc = jpeg_encoder::Encoder::new(&mut out, 85);
    enc.set_sampling_factor(sampling);
    enc.set_progressive(progressive);
    enc.encode(&data, w, h, jpeg_encoder::ColorType::Rgb).unwrap();
    out
}

/// Marker segments of an encoder JPEG: (marker, bytes of the whole segment) and the
/// entropy run that follows a scan header.
fn split(j: &[u8]) -> Vec<(u8, Vec<u8>)> {
    let mut out = vec![(0xD8, vec![0xFF, 0xD8])];
    let mut i = 2;
    while i < j.len() {
        let m = j[i + 1];
        if m == 0xD9 {
            out.push((0xD9, vec![0xFF, 0xD9]));
            break;
        }
        let len = usize::from(j[i + 2]) << 8 | usize::from(j[i + 3]);
        out.push((m, j[i..i + 2 + len].to_vec()));
        i += 2 + len;
        if m == 0xDA {
            let s = i;
            while !(j[i] == 0xFF && j[i + 1] != 0 && !(0xD0..=0xD7).contains(&j[i + 1])) {
                i += 1;
            }
            out.push((0, j[s..i].to_vec()));
        }
    }
    out
}

/// Keeps the headers and only the scans `keep(Ss)` accepts (an unfinished progressive file).
fn keep_scans(j: &[u8], keep: impl Fn(u8) -> bool) -> Vec<u8> {
    let parts = split(j);
    let mut out = Vec::new();
    let mut idx = 0;
    while idx < parts.len() {
        let (m, b) = &parts[idx];
        if *m == 0xDA {
            let ns = usize::from(b[4]);
            let ss = b[5 + 2 * ns];
            if keep(ss) {
                out.extend_from_slice(b);
                out.extend_from_slice(&parts[idx + 1].1);
            }
            idx += 2;
            continue;
        }
        out.extend_from_slice(b);
        idx += 1;
    }
    out
}

/// SOI, DQT, DHT, SOF0 (4:4:4), `n` empty scans, EOI: every scan is zero-filled by the decoder.
fn empty_sos(w: u16, h: u16, n: usize) -> Vec<u8> {
    let mut v = vec![0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x43, 0x00];
    v.extend_from_slice(&[1u8; 64]);
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

fn sof_header_only(m: u8, w: u16, h: u16) -> Vec<u8> {
    let mut v = vec![0xFF, 0xD8, 0xFF, m, 0x00, 0x11, 8];
    v.extend_from_slice(&h.to_be_bytes());
    v.extend_from_slice(&w.to_be_bytes());
    v.extend_from_slice(&[3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xFF, 0xD9]);
    v
}

/// A small valid JPEG with `k` metadata segments of `unit` bytes inserted before its frame,
/// written through a file so nothing but the writer's buffer is held.
fn flood_file(name: &str, marker: u8, payload_len: usize, k: usize, leak_style: bool) -> PathBuf {
    let base = jpeg(16, 16, jpeg_encoder::SamplingFactor::F_1_1, false);
    let p = dir().join(name);
    let mut f = std::io::BufWriter::new(std::fs::File::create(&p).unwrap());
    f.write_all(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 7, b'J', b'F', b'I', b'F', 0]).unwrap();
    let seg_len = (payload_len + 2) as u16;
    let mut seg = Vec::new();
    if leak_style {
        seg.extend_from_slice(&[0xFF, 0xFF]);
    }
    seg.extend_from_slice(&[0xFF, marker, (seg_len >> 8) as u8, (seg_len & 0xFF) as u8]);
    seg.extend(std::iter::repeat(0x5Au8).take(payload_len));
    for _ in 0..k {
        f.write_all(&seg).unwrap();
    }
    f.write_all(&base[2..]).unwrap();
    f.flush().unwrap();
    p
}

fn sof(w: u32, h: u32, hv: &[(u8, u8)], progressive: bool) -> SofInfo {
    let mut comps = [SofComponent { id: 1, h: 1, v: 1 }; 3];
    for (i, &(a, b)) in hv.iter().enumerate() {
        comps[i] = SofComponent { id: i as u8 + 1, h: a, v: b };
    }
    SofInfo { w, h, ncomp: hv.len(), comps, progressive }
}

// ---------------------------------------------------------------------------
// Rows.
// ---------------------------------------------------------------------------

/// RS2b: header-only giants are refused without an allocation above 1 MiB.
#[test]
fn header_only_giants_allocate_nothing_large() {
    let _g = serial();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("png-100000-sq-rgba16", png_header_only(100_000, 100_000, 6, 16, 0)),
        ("png-400m-wide", png_header_only(400_000_000, 1, 6, 16, 0)),
        ("png-100001", png_header_only(100_001, 1, 6, 8, 0)),
        ("png-interlaced-8000", png_header_only(8000, 8000, 6, 8, 1)),
        ("jpeg-65535-prog", sof_header_only(0xC2, 65535, 65535)),
        ("jpeg-6000-prog", sof_header_only(0xC2, 6000, 6000)),
    ];
    for (name, bytes) in cases {
        let p = write(name, &bytes);
        let (out, peak) = measure(&p);
        println!("RS2b {:<24} {:?} peak {} B", name, refused(&out), peak);
        assert_eq!(refused(&out), Some(Reason::TooLarge), "{}", name);
        assert!(peak < MIB, "{} allocated {} bytes", name, peak);
    }
}

/// RS14 and RS14b: metadata floods never reach the decoder. The heap stays small and the
/// 16x16 image still decodes. 100 MiB per flood is streamed from disk.
#[test]
fn metadata_floods_hold_no_payload() {
    let _g = serial();
    let k = 100 * MIB / 65_535;
    // The leak style uses fill bytes before each marker and a length free of 0xFF bytes.
    let cases = [
        ("app2-icc", 0xE2u8, 65_533usize, false),
        ("app1", 0xE1, 65_533, false),
        ("com", 0xFE, 65_533, false),
        ("app13", 0xED, 65_533, false),
        ("leak-app2", 0xE2, 0xFE00 - 2, true),
    ];
    for (name, marker, payload, leak) in cases {
        let p = flood_file(name, marker, payload, k, leak);
        let size = std::fs::metadata(&p).unwrap().len();
        assert!(size > 99 * MIB as u64);
        let (out, peak) = measure(&p);
        println!("RS14 {:<10} file {} MiB peak {} B", name, size / MIB as u64, peak);
        assert!(is_pixels(&out), "{}: {:?}", name, refused(&out));
        assert!(peak < 2 * MIB, "{} held {} bytes", name, peak);
        let _ = std::fs::remove_file(&p);
    }
}

fn report(name: &str, predicted: u64, out: &Result<Outcome, Transient>, peak: usize) {
    println!("RS2c {:<34} predicted {:>10} B  measured {:>10} B  ({})", name, predicted, peak, if is_pixels(out) { "pixels" } else { "not pixels" });
    assert!(is_pixels(out), "{}: expected pixels, got {:?}", name, refused(out));
    assert!(peak as u64 <= predicted, "{}: measured {} above predicted {}", name, peak, predicted);
}

/// RS2c, PNG: measured peak at most the predicted peak.
#[test]
fn png_measured_peak_stays_under_the_prediction() {
    let _g = serial();
    let lim = Limits::for_target();
    let hd = |w, h, ch, d, il, out| PngHeader { w, h, channels: ch, bit_depth: d, interlaced: il, out_channels: out };
    let cases: Vec<(&str, Vec<u8>, PngHeader)> = vec![
        ("png-4000sq-rgb", png_bytes(4000, 4000, png::ColorType::Rgb, png::BitDepth::Eight, 3, 1), hd(4000, 4000, 3, 8, false, 3)),
        ("png-100000x64-rgba16", png_bytes(100_000, 64, png::ColorType::Rgba, png::BitDepth::Sixteen, 4, 2), hd(100_000, 64, 4, 16, false, 4)),
        ("png-interlaced-2000sq-rgba", interlaced_rgba_png(2000, 2000), hd(2000, 2000, 4, 8, true, 4)),
    ];
    for (name, bytes, header) in cases {
        let p = write(name, &bytes);
        let plan = peak::predict_png(&header, 168, &lim).unwrap();
        let (out, peak) = measure(&p);
        report(name, plan.peak, &out, peak);
        let _ = std::fs::remove_file(&p);
    }
}

/// RS2c, JPEG: baseline, a zero-filled scan and progressive files, each inside a one-thread pool.
#[test]
fn jpeg_measured_peak_stays_under_the_prediction() {
    let _g = serial();
    let lim = Limits::for_target();
    use jpeg_encoder::SamplingFactor as S;
    let c420 = [(2, 2), (1, 1), (1, 1)];
    let c444 = [(1, 1), (1, 1), (1, 1)];
    let prog = jpeg(2500, 2500, S::F_1_1, true);
    let cases: Vec<(&str, Vec<u8>, SofInfo)> = vec![
        ("jpeg-4000x3000-420", jpeg(4000, 3000, S::F_2_2, false), sof(4000, 3000, &c420, false)),
        ("jpeg-4000x3000-444", jpeg(4000, 3000, S::F_1_1, false), sof(4000, 3000, &c444, false)),
        ("jpeg-4000sq-zero-filled-scan", empty_sos(4000, 4000, 1), sof(4000, 4000, &c444, false)),
        ("jpeg-2500sq-444-progressive", prog.clone(), sof(2500, 2500, &c444, true)),
        ("jpeg-2500sq-420-progressive", jpeg(2500, 2500, S::F_2_2, true), sof(2500, 2500, &c420, true)),
        ("jpeg-2500sq-progressive-dc-only", keep_scans(&prog, |ss| ss == 0), sof(2500, 2500, &c444, true)),
        ("jpeg-2500sq-progressive-ac-first", keep_scans(&prog, |ss| ss != 0), sof(2500, 2500, &c444, true)),
    ];
    for (name, bytes, header) in cases {
        let p = write(name, &bytes);
        let plan = peak::predict_jpeg(&header, 168, &lim).unwrap();
        let (out, peak) = measure(&p);
        report(name, plan.peak, &out, peak);
        let _ = std::fs::remove_file(&p);
    }
}

/// RS5b at the process level: a progressive 4:4:4 6000 x 6000 JPEG is refused from its
/// header (predicted from source dimensions, not scaled ones), so a decode never starts.
#[test]
fn progressive_6000_square_is_refused_before_decoding() {
    let _g = serial();
    let p = write("prog-6000", &sof_header_only(0xC2, 6000, 6000));
    let (out, peak) = measure(&p);
    assert_eq!(refused(&out), Some(Reason::TooLarge));
    assert!(peak < MIB);
}
