//! PNG decode: row streaming through the box filter. Text and ICC chunks are ignored,
//! samples are normalised to 8 bit, and the whole prediction is admitted before the first
//! row buffer proportional to the image exists.

use std::io::{BufRead, Seek};

use png::{ColorType, Decoder, DecodingError, Limits as PngLimits, Transformations};

use super::downscale::BoxFilter;
use super::peak::{self, Limits, PngHeader, TooLarge, PNG_LIMIT_BYTES};
use super::stop::StopToken;
use super::{PathResult, Reason};

/// Straight RGBA8 from one normalised row.
fn to_rgba(ct: ColorType, src: &[u8], dst: &mut [u8]) {
    match ct {
        ColorType::Grayscale => {
            for (d, &g) in dst.chunks_exact_mut(4).zip(src) {
                d.copy_from_slice(&[g, g, g, 255]);
            }
        }
        ColorType::GrayscaleAlpha => {
            for (d, s) in dst.chunks_exact_mut(4).zip(src.chunks_exact(2)) {
                d.copy_from_slice(&[s[0], s[0], s[0], s[1]]);
            }
        }
        ColorType::Rgb => {
            for (d, s) in dst.chunks_exact_mut(4).zip(src.chunks_exact(3)) {
                d.copy_from_slice(&[s[0], s[1], s[2], 255]);
            }
        }
        // Rgba, and Indexed (expanded by the transformation before it reaches here).
        _ => {
            let n = src.len().min(dst.len());
            dst[..n].copy_from_slice(&src[..n]);
        }
    }
}

fn failed() -> PathResult {
    PathResult::Failed { unsupported: false }
}

fn err_result(e: DecodingError) -> PathResult {
    match e {
        DecodingError::LimitsExceeded => PathResult::Refuse(Reason::TooLarge),
        _ => failed(),
    }
}

pub(crate) fn run<R: BufRead + Seek>(reader: R, short_side: u32, lim: &Limits, tok: &StopToken) -> PathResult {
    let mut dec = Decoder::new_with_limits(reader, PngLimits { bytes: PNG_LIMIT_BYTES as usize });
    dec.set_ignore_text_chunk(true);
    dec.set_ignore_iccp_chunk(true);
    dec.set_transformations(Transformations::normalize_to_color8());

    let (w, h, ct, depth, interlaced) = match dec.read_header_info() {
        Ok(info) => (info.width, info.height, info.color_type, info.bit_depth as u32, info.interlaced),
        Err(e) => return err_result(e),
    };
    let stored = PngHeader {
        w,
        h,
        channels: ct.samples() as u32,
        bit_depth: depth,
        interlaced,
        out_channels: 4,
    };
    let early: Result<(), TooLarge> = stored.raw_row().and_then(|raw| peak::precheck_dims(w, h, raw, lim));
    if early.is_err() {
        return PathResult::Refuse(Reason::TooLarge);
    }

    let mut rd = match dec.read_info() {
        Ok(r) => r,
        Err(e) => return err_result(e),
    };
    if rd.info().animation_control.is_some() {
        return PathResult::Refuse(Reason::Animated);
    }
    let (out_ct, _) = rd.output_color_type();
    let hd = PngHeader { out_channels: out_ct.samples() as u32, ..stored };
    let plan = match peak::predict_png(&hd, short_side, lim) {
        Ok(p) => p,
        Err(TooLarge) => return PathResult::Refuse(Reason::TooLarge),
    };
    let Some(mut bf) = BoxFilter::new(w, h, plan.out_w.min(w), plan.out_h.min(h)) else {
        return failed();
    };
    let mut rgba_row: Vec<u8> = Vec::new();
    if rgba_row.try_reserve_exact(w as usize * 4).is_err() {
        return PathResult::Refuse(Reason::TooLarge);
    }
    rgba_row.resize(w as usize * 4, 0);

    if !interlaced {
        loop {
            if tok.check().is_err() {
                return failed();
            }
            match rd.next_row() {
                Ok(Some(row)) => {
                    to_rgba(out_ct, row.data(), &mut rgba_row);
                    if bf.push_row(&rgba_row, tok).is_err() {
                        return failed();
                    }
                }
                Ok(None) => break,
                Err(e) => return err_result(e),
            }
        }
    } else {
        let Some(size) = rd.output_buffer_size() else {
            return PathResult::Refuse(Reason::TooLarge);
        };
        if size as u64 > u64::from(hd.w) * u64::from(hd.h) * u64::from(hd.out_channels) {
            return PathResult::Refuse(Reason::TooLarge);
        }
        let mut frame: Vec<u8> = Vec::new();
        if frame.try_reserve_exact(size).is_err() {
            return PathResult::Refuse(Reason::TooLarge);
        }
        frame.resize(size, 0);
        let info = match rd.next_frame(&mut frame) {
            Ok(i) => i,
            Err(e) => return err_result(e),
        };
        if info.line_size == 0 {
            return failed();
        }
        for row in frame.chunks_exact(info.line_size).take(h as usize) {
            to_rgba(out_ct, row, &mut rgba_row);
            if bf.push_row(&rgba_row, tok).is_err() {
                return failed();
            }
        }
    }
    match bf.finish(tok) {
        Ok(Some(rgba)) => PathResult::Pixels { w: plan.out_w.min(w), h: plan.out_h.min(h), rgba },
        _ => failed(),
    }
}
