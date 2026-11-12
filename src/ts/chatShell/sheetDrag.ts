// A bottom sheet dragged down by its handle (SLICE1_SPEC 5.2, SLICE2_SPEC 3): it follows the finger and closes on
// release past 30 % of its height or on a downward fling, otherwise it springs back. Distances are px, velocities px/ms.
// The release velocity is measured from an anchor to the lift. The anchor is the newest sample at or before
// SHEET_VELOCITY_WINDOW_MS prior to the lift, so the span always covers the window even when moves are sparse or
// batched and the last move sits at the lift's position; a drag shorter than the window is anchored on its down sample.
// A sample is added only on a move, so a finger that rested longer than the window leaves an anchor at the lift's
// position and has velocity 0.
export const SHEET_CLOSE_FRACTION = 0.3
export const SHEET_FLING_PX_MS = 0.5
export const SHEET_SLOP_PX = 4
export const SHEET_VELOCITY_WINDOW_MS = 80
const SHEET_SAMPLE_LIMIT = 64

export type SheetRelease = 'close' | 'stay'

export function createSheetDrag() {
    let start: { y: number, time: number } | null = null
    let samples: { y: number, time: number }[] = []
    let engaged = false

    function clear(): void {
        start = null
        samples = []
        engaged = false
    }

    function down(y: number, time: number): void {
        clear()
        start = { y, time }
        samples = [start]
    }

    /** The sheet's offset below its rest position for this sample: 0 until the press passes the slop, never negative. */
    function move(y: number, time: number): number {
        if (!start) return 0
        samples.push({ y, time })
        // Only the newest sample at or before the window start, and everything after it, can reach a later release; the cap bounds a very dense stream.
        let drop = 0
        while (drop < samples.length - 1 && samples[drop + 1].time <= time - SHEET_VELOCITY_WINDOW_MS) drop++
        drop = Math.max(drop, samples.length - SHEET_SAMPLE_LIMIT)
        if (drop > 0) samples.splice(0, drop)
        if (!engaged && Math.abs(y - start.y) > SHEET_SLOP_PX) engaged = true
        return engaged ? Math.max(0, y - start.y) : 0
    }

    function up(y: number, time: number, height: number): SheetRelease {
        if (!start || !engaged) { clear(); return 'stay' }
        // The fallback to the down sample applies only when no sample reaches back to the window start, which is a drag shorter than the window; a pause leaves an older sample, so it is never turned into a fling.
        let anchor = samples[0]
        for (const sample of samples) if (sample.time <= time - SHEET_VELOCITY_WINDOW_MS) anchor = sample
        const elapsed = time - anchor.time
        const velocity = elapsed > 0 ? (y - anchor.y) / elapsed : 0
        const offset = Math.max(0, y - start.y)
        clear()
        // A fling back up keeps the sheet whatever the distance; a fling down closes it whatever the distance.
        if (velocity < -SHEET_FLING_PX_MS) return 'stay'
        return offset > SHEET_CLOSE_FRACTION * height || velocity > SHEET_FLING_PX_MS ? 'close' : 'stay'
    }

    function cancel(): SheetRelease { clear(); return 'stay' }

    return { down, move, up, cancel, engaged: () => engaged }
}
