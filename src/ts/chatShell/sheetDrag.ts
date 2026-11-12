// A bottom sheet dragged down by its handle (SLICE1_SPEC 5.2, SLICE2_SPEC 3): it follows the finger and closes on
// release past 30 % of its height or on a downward fling, otherwise it springs back. Distances are px, velocities px/ms.
// The release velocity is measured from the oldest sample within SHEET_VELOCITY_WINDOW_MS before the lift to the lift
// itself, so a lift delivered at the last move's position still carries the flick; a finger that rested longer than
// the window before lifting has velocity 0.
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
        // Only the newest window of samples can reach a later release; the cap bounds a very dense stream.
        let drop = 0
        while (drop < samples.length - 1 && samples[drop].time < time - SHEET_VELOCITY_WINDOW_MS) drop++
        drop = Math.max(drop, samples.length - SHEET_SAMPLE_LIMIT)
        if (drop > 0) samples.splice(0, drop)
        if (!engaged && Math.abs(y - start.y) > SHEET_SLOP_PX) engaged = true
        return engaged ? Math.max(0, y - start.y) : 0
    }

    function up(y: number, time: number, height: number): SheetRelease {
        if (!start || !engaged) { clear(); return 'stay' }
        const oldest = samples.find(sample => sample.time >= time - SHEET_VELOCITY_WINDOW_MS)
        const elapsed = oldest ? time - oldest.time : 0
        const velocity = oldest && elapsed > 0 ? (y - oldest.y) / elapsed : 0
        const offset = Math.max(0, y - start.y)
        clear()
        // A fling back up keeps the sheet whatever the distance; a fling down closes it whatever the distance.
        if (velocity < -SHEET_FLING_PX_MS) return 'stay'
        return offset > SHEET_CLOSE_FRACTION * height || velocity > SHEET_FLING_PX_MS ? 'close' : 'stay'
    }

    function cancel(): SheetRelease { clear(); return 'stay' }

    return { down, move, up, cancel, engaged: () => engaged }
}
