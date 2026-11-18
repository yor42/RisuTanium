//! JPEG decode through `jpeg-decoder` with DCT scaling, then the box filter. The decoder
//! reads only the canonical stream of `JpegFilter`. The prediction uses the source
//! dimensions and sampling factors recorded by the filter, before `scale()` or
//! `decode()` allocate anything proportional to the image.

use std::io::Read;

use jpeg_decoder::{Decoder, Error as JpegError, PixelFormat};

use super::downscale::BoxFilter;
use super::jpeg_filter::FilterShared;
use super::peak::{self, Limits, TooLarge};
use super::stop::StopToken;
use super::{PathResult, Reason};

fn failed(e: &JpegError) -> PathResult {
    PathResult::Failed { unsupported: matches!(e, JpegError::Unsupported(_)) }
}

fn malformed() -> PathResult {
    PathResult::Failed { unsupported: false }
}

pub(crate) fn run<R: Read>(reader: R, shared: &FilterShared, short_side: u32, lim: &Limits, tok: &StopToken) -> PathResult {
    let mut dec = Decoder::new(reader);
    // A defence on the scaled output only; the prediction refuses first.
    dec.set_max_decoding_buffer_size(lim.budget as usize);
    if let Err(e) = dec.read_info() {
        return failed(&e);
    }
    let (Some(info), Some(sof)) = (dec.info(), shared.sof.get()) else {
        return malformed();
    };
    let comps = match info.pixel_format {
        PixelFormat::L8 => 1,
        PixelFormat::RGB24 => 3,
        _ => return PathResult::Failed { unsupported: true },
    };
    if u32::from(info.width) != sof.w || u32::from(info.height) != sof.h || comps != sof.ncomp {
        return malformed();
    }
    let plan = match peak::predict_jpeg(&sof, short_side, lim) {
        Ok(p) => p,
        Err(TooLarge) => return PathResult::Refuse(Reason::TooLarge),
    };
    let (Ok(req_w), Ok(req_h)) = (u16::try_from(plan.out_w), u16::try_from(plan.out_h)) else {
        return PathResult::Refuse(Reason::TooLarge);
    };
    let (sw, sh) = match dec.scale(req_w, req_h) {
        Ok(d) => d,
        Err(e) => return failed(&e),
    };
    if u32::from(sw) != plan.sw || u32::from(sh) != plan.sh {
        // The size rule replicated in `peak.rs` no longer matches the decoder.
        return malformed();
    }
    let pixels = match dec.decode() {
        Ok(p) => p,
        Err(e) => return failed(&e),
    };
    if tok.check().is_err() {
        return malformed();
    }
    let (ow, oh) = (plan.out_w.min(plan.sw), plan.out_h.min(plan.sh));
    if pixels.len() != plan.sw as usize * plan.sh as usize * comps {
        return malformed();
    }
    let Some(mut bf) = BoxFilter::new(plan.sw, plan.sh, ow, oh) else {
        return malformed();
    };
    let mut rgba_row = vec![255u8; plan.sw as usize * 4];
    for row in pixels.chunks_exact(plan.sw as usize * comps) {
        if comps == 1 {
            for (d, &g) in rgba_row.chunks_exact_mut(4).zip(row) {
                d[0] = g;
                d[1] = g;
                d[2] = g;
            }
        } else {
            for (d, s) in rgba_row.chunks_exact_mut(4).zip(row.chunks_exact(3)) {
                d[0] = s[0];
                d[1] = s[1];
                d[2] = s[2];
            }
        }
        if bf.push_row(&rgba_row, tok).is_err() {
            return malformed();
        }
    }
    match bf.finish(tok) {
        Ok(Some(rgba)) => PathResult::Pixels { w: ow, h: oh, rgba },
        _ => malformed(),
    }
}
