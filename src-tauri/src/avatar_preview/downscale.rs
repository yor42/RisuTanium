//! Streaming premultiplied box filter. Source rows (straight RGBA8) are pushed one at a
//! time; source row `y` feeds output row `floor(y*out_h/h)` and column `x` feeds output
//! column `floor(x*out_w/w)`. Colour is averaged weighted by alpha, so transparent pixels
//! do not darken their neighbours; alpha is the plain average.
//!
//! Requires `out_w <= w` and `out_h <= h` (the preview never upscales).

use std::io;

use super::stop::StopToken;

pub struct BoxFilter {
    w: u32,
    h: u32,
    ow: u32,
    oh: u32,
    sums: Vec<[u64; 4]>,
    counts: Vec<u32>,
    out: Vec<u8>,
    /// Next source row and the output row being accumulated.
    y: u32,
    cur_oy: u32,
    started: bool,
}

impl BoxFilter {
    /// `None` when the dimensions are unusable or the output buffer cannot be reserved.
    pub fn new(w: u32, h: u32, ow: u32, oh: u32) -> Option<BoxFilter> {
        if w == 0 || h == 0 || ow == 0 || oh == 0 || ow > w || oh > h {
            return None;
        }
        let out_len = (ow as usize).checked_mul(oh as usize)?.checked_mul(4)?;
        let mut out = Vec::new();
        out.try_reserve_exact(out_len).ok()?;
        Some(BoxFilter {
            w,
            h,
            ow,
            oh,
            sums: vec![[0; 4]; ow as usize],
            counts: vec![0; ow as usize],
            out,
            y: 0,
            cur_oy: 0,
            started: false,
        })
    }

    fn flush(&mut self, tok: &StopToken) -> io::Result<()> {
        tok.check()?;
        for (s, &n) in self.sums.iter().zip(&self.counts) {
            if s[3] == 0 || n == 0 {
                self.out.extend_from_slice(&[0, 0, 0, 0]);
            } else {
                let den = s[3];
                let half = den / 2;
                self.out.push(((s[0] + half) / den).min(255) as u8);
                self.out.push(((s[1] + half) / den).min(255) as u8);
                self.out.push(((s[2] + half) / den).min(255) as u8);
                let n = u64::from(n);
                self.out.push(((s[3] + n / 2) / n).min(255) as u8);
            }
        }
        for s in &mut self.sums {
            *s = [0; 4];
        }
        for c in &mut self.counts {
            *c = 0;
        }
        Ok(())
    }

    /// Pushes the next source row, `w * 4` bytes of straight RGBA.
    pub fn push_row(&mut self, row: &[u8], tok: &StopToken) -> io::Result<()> {
        if row.len() != self.w as usize * 4 || self.y >= self.h {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "box filter row"));
        }
        // Output row of this source row.
        let oy = (u64::from(self.y) * u64::from(self.oh) / u64::from(self.h)) as u32;
        if self.started && oy != self.cur_oy {
            self.flush(tok)?;
            self.cur_oy = oy;
        }
        self.started = true;
        let w = self.w;
        let ow = self.ow;
        let mut ox = 0usize;
        let mut rem = 0u32;
        for px in row.chunks_exact(4) {
            let a = u64::from(px[3]);
            let s = &mut self.sums[ox];
            s[0] += u64::from(px[0]) * a;
            s[1] += u64::from(px[1]) * a;
            s[2] += u64::from(px[2]) * a;
            s[3] += a;
            self.counts[ox] += 1;
            rem += ow;
            if rem >= w {
                rem -= w;
                ox += 1;
            }
        }
        self.y += 1;
        Ok(())
    }

    /// The output once every source row was pushed; `None` when rows are missing.
    pub fn finish(mut self, tok: &StopToken) -> io::Result<Option<Vec<u8>>> {
        if self.y != self.h {
            return Ok(None);
        }
        self.flush(tok)?;
        if self.out.len() != self.ow as usize * self.oh as usize * 4 {
            return Ok(None);
        }
        Ok(Some(self.out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn tok() -> Arc<StopToken> {
        StopToken::new(Arc::new(AtomicBool::new(false)))
    }

    fn run(w: u32, h: u32, ow: u32, oh: u32, px: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
        let t = tok();
        let mut f = BoxFilter::new(w, h, ow, oh).unwrap();
        for y in 0..h {
            let mut row = Vec::new();
            for x in 0..w {
                row.extend_from_slice(&px(x, y));
            }
            f.push_row(&row, &t).unwrap();
        }
        f.finish(&t).unwrap().unwrap()
    }

    #[test]
    fn exact_block_average() {
        // 4x4 into 2x2: each output pixel is the mean of a 2x2 block (opaque).
        let out = run(4, 4, 2, 2, |x, y| [(x * 10 + y) as u8, 0, 0, 255]);
        assert_eq!(out.len(), 16);
        assert_eq!(out[0], ((0 + 1 + 10 + 11) as f64 / 4.0).round() as u8);
        assert_eq!(out[3], 255);
    }

    #[test]
    fn identity_when_sizes_match() {
        let out = run(3, 2, 3, 2, |x, y| [x as u8, y as u8, 7, 255]);
        assert_eq!(&out[0..4], &[0, 0, 7, 255]);
        assert_eq!(&out[(3 + 2) * 4..(3 + 2) * 4 + 4], &[2, 1, 7, 255]);
    }

    #[test]
    fn premultiplied_average_keeps_colour_beside_transparent_black() {
        // One red pixel at alpha 128 beside a transparent black pixel.
        let out = run(2, 1, 1, 1, |x, _| if x == 0 { [255, 0, 0, 128] } else { [0, 0, 0, 0] });
        assert_eq!(out[0], 255, "red must not be darkened by transparent black");
        assert_eq!(out[3], 64);
    }

    #[test]
    fn uneven_ratios_cover_every_output_row_and_column() {
        let out = run(7, 5, 3, 2, |_, _| [9, 8, 7, 255]);
        assert_eq!(out.len(), 3 * 2 * 4);
        assert!(out.chunks_exact(4).all(|p| p == [9, 8, 7, 255]));
    }

    #[test]
    fn upscale_and_bad_rows_are_refused() {
        assert!(BoxFilter::new(2, 2, 3, 1).is_none());
        let t = tok();
        let mut f = BoxFilter::new(2, 2, 1, 1).unwrap();
        assert!(f.push_row(&[0; 4], &t).is_err());
    }

    #[test]
    fn flush_checks_the_token() {
        let cancel = Arc::new(AtomicBool::new(false));
        let t = StopToken::new(cancel.clone());
        let mut f = BoxFilter::new(2, 2, 1, 1).unwrap();
        f.push_row(&[0; 8], &t).unwrap();
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        f.push_row(&[0; 8], &t).unwrap();
        assert!(f.finish(&t).is_err());
    }
}
