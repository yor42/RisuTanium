//! Pure admission rule: the peak memory of a decode is predicted from the header facts
//! before any allocation proportional to the image. A prediction above the budget, a
//! single buffer above the per-buffer cap, a side or pixel count above its cap, or any
//! arithmetic overflow is `TooLarge`.
//!
//! All arithmetic is `u64` and checked; overflow is `TooLarge`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TooLarge;

pub const MIB: u64 = 1024 * 1024;
/// Predicted peak budget of one decode (MC-2178).
pub const PEAK_BUDGET_BYTES: u64 = 128 * MIB;
/// Buffers of the BufReader, inflate state and small structures.
pub const FIXED_OVERHEAD: u64 = MIB;
pub const MAX_SIDE: u32 = 100_000;
/// Sanity cap on source pixels (MC-2088).
pub const MAX_PIXELS: u64 = 400_000_000;
pub const MAX_SCANS: u32 = 128;
pub const OUT_LONG_CAP: u32 = 2048;
pub const MAX_RAW_ROW_BYTES: u64 = 8 * MIB;
/// What `png` may buffer itself: processed ancillary chunks (eXIf, PLTE, ...) and its
/// output line. Passed as `png::Limits::bytes` and counted in the prediction.
pub const PNG_LIMIT_BYTES: u64 = 5 * MIB;
/// Rows of the PNG unfiltering buffer held before it shifts back (png 0.18.1,
/// `UnfilteringBuffer`: shift_back_limit = max(4 rows, 128 KiB), plus the row in flight
/// and a 32 KiB look-back window).
pub const ROWS_HELD: u64 = 6;
/// Per output column: four u64 sums, a u32 count, doubled for the flush copy.
const ACC_BYTES_PER_COLUMN: u64 = 64;

const _: () = assert!(MAX_SIDE as u64 * 8 + 1 <= MAX_RAW_ROW_BYTES);

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub budget: u64,
    pub single_cap: u64,
    pub max_side: u32,
    pub max_pixels: u64,
    pub max_scans: u32,
}

impl Limits {
    pub const fn for_target() -> Limits {
        Limits {
            budget: PEAK_BUDGET_BYTES,
            // MC-2179: on 32-bit builds one contiguous buffer above 32 MiB may fail.
            single_cap: if cfg!(target_pointer_width = "32") { 32 * MIB } else { PEAK_BUDGET_BYTES },
            max_side: MAX_SIDE,
            max_pixels: MAX_PIXELS,
            max_scans: MAX_SCANS,
        }
    }
}

fn mul(a: u64, b: u64) -> Result<u64, TooLarge> {
    a.checked_mul(b).ok_or(TooLarge)
}

fn add(a: u64, b: u64) -> Result<u64, TooLarge> {
    a.checked_add(b).ok_or(TooLarge)
}

fn ceil_div(a: u64, b: u64) -> u64 {
    a / b + u64::from(a % b != 0)
}

fn round_up(a: u64, m: u64) -> Result<u64, TooLarge> {
    mul(ceil_div(a, m), m)
}

/// The thumbnail size rule: the short side becomes `short_side` and is never upscaled;
/// the long side is then capped at `long_cap`, scaling both sides. Never 0.
pub fn target_dims(w: u32, h: u32, short_side: u32, long_cap: u32) -> (u32, u32) {
    let (mut ow, mut oh) = (w.max(1), h.max(1));
    if ow.min(oh) > short_side {
        let scale = f64::from(short_side) / f64::from(ow.min(oh));
        ow = ((f64::from(ow) * scale).round() as u32).max(1);
        oh = ((f64::from(oh) * scale).round() as u32).max(1);
    }
    if ow.max(oh) > long_cap {
        let scale = f64::from(long_cap) / f64::from(ow.max(oh));
        ow = ((f64::from(ow) * scale).round() as u32).max(1);
        oh = ((f64::from(oh) * scale).round() as u32).max(1);
    }
    (ow, oh)
}

/// Header-only dimension caps, checked before the decoder reads further.
pub fn precheck_dims(w: u32, h: u32, raw_row: u64, lim: &Limits) -> Result<(), TooLarge> {
    if w == 0 || h == 0 || w > lim.max_side || h > lim.max_side {
        return Err(TooLarge);
    }
    if mul(u64::from(w), u64::from(h))? > lim.max_pixels {
        return Err(TooLarge);
    }
    if raw_row > MAX_RAW_ROW_BYTES {
        return Err(TooLarge);
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Plan {
    pub out_w: u32,
    pub out_h: u32,
    /// Predicted peak in bytes, overhead included.
    pub peak: u64,
    /// JPEG only: the IDCT scale (1, 2, 4 or 8) and the decoder's output size.
    pub d: u32,
    pub sw: u32,
    pub sh: u32,
}

/// `singles` are individually checked against `single_cap`; `rest` only count in the sum.
fn admit(lim: &Limits, singles: &[u64], rest: &[u64]) -> Result<u64, TooLarge> {
    let mut sum = FIXED_OVERHEAD;
    for &s in singles {
        if s > lim.single_cap {
            return Err(TooLarge);
        }
        sum = add(sum, s)?;
    }
    for &r in rest {
        sum = add(sum, r)?;
    }
    if sum > lim.budget {
        return Err(TooLarge);
    }
    Ok(sum)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PngHeader {
    pub w: u32,
    pub h: u32,
    /// Samples per pixel as stored (1, 2, 3 or 4) and the stored bit depth.
    pub channels: u32,
    pub bit_depth: u32,
    pub interlaced: bool,
    /// Bytes per pixel of the 8-bit output after normalisation (1 to 4).
    pub out_channels: u32,
}

impl PngHeader {
    pub fn raw_row(&self) -> Result<u64, TooLarge> {
        let bits = mul(mul(u64::from(self.w), u64::from(self.channels))?, u64::from(self.bit_depth))?;
        add(ceil_div(bits, 8), 1)
    }
}

pub fn predict_png(hd: &PngHeader, short_side: u32, lim: &Limits) -> Result<Plan, TooLarge> {
    let raw_row = hd.raw_row()?;
    precheck_dims(hd.w, hd.h, raw_row, lim)?;
    let (ow, oh) = target_dims(hd.w, hd.h, short_side, OUT_LONG_CAP);
    let w = u64::from(hd.w);
    let unfilter = mul(
        2,
        add(
            round_up(mul(ROWS_HELD, round_up(raw_row, 64)?)?, 1)?.max(128 * 1024),
            40 * 1024,
        )?,
    )?;
    let out_row = mul(w, u64::from(hd.out_channels))?;
    let rgba_row = mul(w, 4)?;
    let acc = mul(u64::from(ow), ACC_BYTES_PER_COLUMN)?;
    let out = mul(mul(u64::from(ow), u64::from(oh))?, 4)?;
    let mut singles = vec![unfilter, raw_row, out_row, rgba_row, acc, out];
    if hd.interlaced {
        singles.push(mul(mul(w, u64::from(hd.h))?, u64::from(hd.out_channels))?);
    }
    let peak = admit(lim, &singles, &[PNG_LIMIT_BYTES])?;
    Ok(Plan { out_w: ow, out_h: oh, peak, d: 0, sw: 0, sh: 0 })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SofComponent {
    pub id: u8,
    pub h: u8,
    pub v: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SofInfo {
    pub w: u32,
    pub h: u32,
    pub ncomp: usize,
    pub comps: [SofComponent; 3],
    pub progressive: bool,
}

/// `jpeg-decoder` 0.3.2 `idct::choose_idct_size`: the smallest scale whose output
/// reaches the request on at least one axis.
pub fn choose_idct_size(w: u32, h: u32, req_w: u32, req_h: u32) -> u32 {
    fn scaled(len: u32, scale: u32) -> u32 {
        (len * scale - 1) / 8 + 1
    }
    for &scale in &[1u32, 2, 4] {
        if scaled(w, scale) >= req_w || scaled(h, scale) >= req_h {
            return scale;
        }
    }
    8
}

/// Blocks across and down per component after MCU padding (jpeg-decoder 0.3.2
/// `update_component_sizes`: MCU counts are padded by the largest sampling factors).
pub fn component_blocks(sof: &SofInfo) -> Result<[(u64, u64); 3], TooLarge> {
    let comps = &sof.comps[..sof.ncomp];
    let hmax = u64::from(comps.iter().map(|c| c.h).max().unwrap_or(1).max(1));
    let vmax = u64::from(comps.iter().map(|c| c.v).max().unwrap_or(1).max(1));
    let mcux = ceil_div(u64::from(sof.w), 8 * hmax);
    let mcuy = ceil_div(u64::from(sof.h), 8 * vmax);
    let mut out = [(0u64, 0u64); 3];
    for (i, c) in comps.iter().enumerate() {
        out[i] = (mul(mcux, u64::from(c.h))?, mul(mcuy, u64::from(c.v))?);
    }
    Ok(out)
}

pub fn predict_jpeg(sof: &SofInfo, short_side: u32, lim: &Limits) -> Result<Plan, TooLarge> {
    precheck_dims(sof.w, sof.h, 0, lim)?;
    let (ow, oh) = target_dims(sof.w, sof.h, short_side, OUT_LONG_CAP);
    let d = choose_idct_size(sof.w, sof.h, ow, oh);
    let sw = (sof.w * d - 1) / 8 + 1;
    let sh = (sof.h * d - 1) / 8 + 1;
    let comps = &sof.comps[..sof.ncomp];
    let blocks = component_blocks(sof)?;
    let d64 = u64::from(d);
    let mut singles: Vec<u64> = Vec::new();
    let mut rest: Vec<u64> = Vec::new();
    let mut max_coeff = 0u64;
    for (i, c) in comps.iter().enumerate() {
        let (bw, bh) = blocks[i];
        singles.push(mul(mul(bw, bh)?, d64 * d64)?); // plane
        // MCU row of coefficients, live and its replacement.
        rest.push(mul(mul(bw, u64::from(c.v))?, 64 * 2 * 2)?);
        if sof.progressive {
            let coeff = mul(mul(bw, bh)?, 64 * 2)?;
            singles.push(coeff);
            max_coeff = max_coeff.max(coeff);
        }
    }
    if sof.progressive {
        // Row copies of one unfinished component made for the IDCT.
        rest.push(max_coeff);
    }
    let n_out = if sof.ncomp == 1 { 1 } else { 3 };
    singles.push(mul(mul(u64::from(sw), u64::from(sh))?, n_out)?); // decoder output
    singles.push(mul(u64::from(sw), 4)?); // RGBA row
    singles.push(mul(u64::from(ow), ACC_BYTES_PER_COLUMN)?);
    singles.push(mul(mul(u64::from(ow), u64::from(oh))?, 4)?);
    let peak = admit(lim, &singles, &rest)?;
    Ok(Plan { out_w: ow, out_h: oh, peak, d, sw, sh })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32, channels: u32, depth: u32, interlaced: bool, out: u32) -> PngHeader {
        PngHeader { w, h, channels, bit_depth: depth, interlaced, out_channels: out }
    }
    fn sof(w: u32, h: u32, hv: &[(u8, u8)], progressive: bool) -> SofInfo {
        let mut comps = [SofComponent { id: 0, h: 1, v: 1 }; 3];
        for (i, &(hh, vv)) in hv.iter().enumerate() {
            comps[i] = SofComponent { id: i as u8 + 1, h: hh, v: vv };
        }
        SofInfo { w, h, ncomp: hv.len(), comps, progressive }
    }
    const L: Limits = Limits::for_target();
    const YCC420: [(u8, u8); 3] = [(2, 2), (1, 1), (1, 1)];
    const YCC444: [(u8, u8); 3] = [(1, 1), (1, 1), (1, 1)];

    #[test]
    fn target_dims_rule() {
        assert_eq!(target_dims(1000, 600, 168, 2048), (280, 168));
        assert_eq!(target_dims(100, 50, 168, 2048), (100, 50));
        assert_eq!(target_dims(20000, 1000, 168, 2048), (2048, 102));
        assert_eq!(target_dims(65535, 10, 168, 2048), (2048, 1));
        assert_eq!(target_dims(1, 1, 168, 2048), (1, 1));
    }

    #[test]
    fn budget_edge_png_admits_exactly_and_refuses_one_byte_less() {
        let hd = png(4000, 4000, 3, 8, false, 3);
        let p = predict_png(&hd, 168, &Limits { budget: u64::MAX, ..L }).unwrap().peak;
        assert!(predict_png(&hd, 168, &Limits { budget: p, ..L }).is_ok());
        assert_eq!(predict_png(&hd, 168, &Limits { budget: p - 1, ..L }), Err(TooLarge));
    }

    #[test]
    fn side_pixel_and_raw_row_caps() {
        assert_eq!(predict_png(&png(100_001, 1, 4, 8, false, 4), 168, &L), Err(TooLarge));
        assert_eq!(predict_png(&png(1, 100_001, 4, 8, false, 4), 168, &L), Err(TooLarge));
        // 20,000 x 20,001 = 400,020,000 pixels, both sides within the side cap.
        assert_eq!(predict_jpeg(&sof(20_000, 20_001, &[(1, 1)], false), 168, &L), Err(TooLarge));
        assert!(predict_jpeg(&sof(20_000, 20_000, &[(1, 1)], false), 168, &L).is_ok());
        // Only the pixel cap can refuse this one.
        let wide = Limits { max_side: u32::MAX, ..L };
        assert_eq!(precheck_dims(40_000, 10_000, 1, &wide), Ok(()));
        assert_eq!(precheck_dims(20_000, 20_001, 1, &wide), Err(TooLarge));
        assert_eq!(precheck_dims(400_000_001, 1, 1, &wide), Err(TooLarge));
        assert_eq!(precheck_dims(400_000_000, 1, 1, &wide), Ok(()));
        // The raw row of a 16-bit RGBA row at the side cap fits, a larger one does not.
        assert_eq!(precheck_dims(1, 1, MAX_RAW_ROW_BYTES + 1, &L), Err(TooLarge));
    }

    #[test]
    fn overflow_is_too_large() {
        let hd = png(u32::MAX, u32::MAX, 4, 16, true, 4);
        assert_eq!(predict_png(&hd, 168, &L), Err(TooLarge));
    }

    // With every cap lifted, a progressive 4:4:4 frame of 2^32-1 x 2^32-1 has 2^29 x 2^29
    // blocks per component, and 2^58 blocks x 128 bytes of coefficients is 2^65: a wrapping
    // product would read 0 and admit it.
    #[test]
    fn a_product_that_wraps_u64_is_too_large() {
        let open = Limits { budget: u64::MAX, single_cap: u64::MAX, max_side: u32::MAX, max_pixels: u64::MAX, ..L };
        assert_eq!(predict_jpeg(&sof(u32::MAX, u32::MAX, &YCC444, true), 168, &open), Err(TooLarge));
    }

    #[test]
    fn progressive_444_6000_is_too_large_but_baseline_10000_is_admitted() {
        assert_eq!(predict_jpeg(&sof(6000, 6000, &YCC444, true), 168, &L), Err(TooLarge));
        let b = predict_jpeg(&sof(10_000, 10_000, &YCC420, false), 168, &L).unwrap();
        assert!(b.peak < 16 * MIB, "peak {}", b.peak);
        assert_eq!(b.d, 1);
    }

    #[test]
    fn prediction_uses_source_dimensions_not_scaled_ones() {
        // Scaled dimensions (750x750) would pass; source dimensions do not.
        assert!(predict_jpeg(&sof(750, 750, &YCC444, true), 168, &L).is_ok());
        assert_eq!(predict_jpeg(&sof(6000, 6000, &YCC444, true), 168, &L), Err(TooLarge));
    }

    #[test]
    fn progressive_copy_term_is_counted() {
        let base = sof(3000, 3000, &YCC444, true);
        let with = predict_jpeg(&base, 168, &Limits { budget: u64::MAX, ..L }).unwrap().peak;
        let coeff = 3 * (375u64 * 375) * 64 * 2;
        assert!(with >= coeff + coeff / 3, "peak {} coeff {}", with, coeff);
    }

    #[test]
    fn mcu_padding_uses_the_sampling_factors() {
        // 1 x 100,000 at 4:2:0: one 16-wide MCU column, 6250 MCU rows.
        let b = component_blocks(&sof(1, 100_000, &YCC420, false)).unwrap();
        assert_eq!(b[0], (2, 12_500));
        assert_eq!(b[1], (1, 6_250));
        // An H = 4 component pads a 1 x 1 image to 4 blocks across.
        let b = component_blocks(&sof(1, 1, &[(4, 1), (1, 1), (1, 1)], false)).unwrap();
        assert_eq!(b[0], (4, 1));
        assert_eq!(b[1], (1, 1));
    }

    #[test]
    fn single_buffer_cap_on_32_bit_targets() {
        let cap32 = Limits { single_cap: 32 * MIB, ..L };
        // 3000x3000 interlaced RGBA frame is 36,000,000 bytes.
        let hd = png(3000, 3000, 4, 8, true, 4);
        assert_eq!(predict_png(&hd, 168, &cap32), Err(TooLarge));
        assert!(predict_png(&hd, 168, &L).is_ok());
        // One progressive component above 32 MiB.
        let big = sof(8000, 4000, &YCC444, true);
        assert_eq!(predict_jpeg(&big, 168, &cap32), Err(TooLarge));
        assert!(predict_jpeg(&big, 168, &Limits { budget: u64::MAX, ..L }).is_ok());
        // The ignored per-buffer rule would admit it by sum alone.
        let sum_only = Limits { single_cap: u64::MAX, budget: 32 * MIB * 100, ..L };
        assert!(predict_png(&hd, 168, &sum_only).is_ok());
        assert_eq!(Limits::for_target().single_cap, if cfg!(target_pointer_width = "32") { 32 * MIB } else { PEAK_BUDGET_BYTES });
    }

    #[test]
    fn idct_scale_rule() {
        assert_eq!(choose_idct_size(8000, 8000, 168, 168), 1);
        assert_eq!(choose_idct_size(20000, 1000, 2048, 102), 1);
        assert_eq!(choose_idct_size(400, 400, 168, 168), 4);
        assert_eq!(choose_idct_size(300, 300, 168, 168), 8);
        assert_eq!(choose_idct_size(100, 100, 100, 100), 8);
    }
}
