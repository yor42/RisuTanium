// A bottom sheet dragged down by its handle (SLICE1_SPEC 5.2, SLICE2_SPEC 3): it follows the finger and closes on
// release past 30 % of its height or on a downward fling, otherwise it springs back. Distances are px, velocities px/ms.
export const SHEET_CLOSE_FRACTION = 0.3
export const SHEET_FLING_PX_MS = 0.5
export const SHEET_SLOP_PX = 4

export type SheetRelease = 'close' | 'stay'

export function createSheetDrag() {
    let start: { y: number, time: number } | null = null
    let previous: { y: number, time: number } | null = null
    let engaged = false
    let lastVelocity = 0

    function clear(): void {
        start = null
        previous = null
        engaged = false
        lastVelocity = 0
    }

    function down(y: number, time: number): void {
        clear()
        start = previous = { y, time }
    }

    /** The sheet's offset below its rest position for this sample: 0 until the press passes the slop, never negative. */
    function move(y: number, time: number): number {
        if (!start || !previous) return 0
        const elapsed = time - previous.time
        if (elapsed > 0) lastVelocity = (y - previous.y) / elapsed
        previous = { y, time }
        if (!engaged && Math.abs(y - start.y) > SHEET_SLOP_PX) engaged = true
        return engaged ? Math.max(0, y - start.y) : 0
    }

    function up(y: number, time: number, height: number): SheetRelease {
        if (!start || !previous || !engaged) { clear(); return 'stay' }
        const elapsed = time - previous.time
        const velocity = elapsed > 0 ? (y - previous.y) / elapsed : lastVelocity
        const offset = Math.max(0, y - start.y)
        clear()
        // A fling back up keeps the sheet whatever the distance; a fling down closes it whatever the distance.
        if (velocity < -SHEET_FLING_PX_MS) return 'stay'
        return offset > SHEET_CLOSE_FRACTION * height || velocity > SHEET_FLING_PX_MS ? 'close' : 'stay'
    }

    function cancel(): SheetRelease { clear(); return 'stay' }

    return { down, move, up, cancel, engaged: () => engaged }
}
