// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

/**
 * `src/main.ts` installs the hidden-page hold for card animations at boot, right after the motion marks and before the
 * app mounts, so a page that starts hidden or hides during its first paint is already covered. The entry module is
 * imported with everything it mounts or starts replaced, and the order of the calls is recorded.
 */

const order = vi.hoisted(() => [] as string[])

vi.mock('./ts/polyfill', () => ({}))
vi.mock('core-js/actual', () => ({}))
vi.mock('./ts/storage/database.svelte', () => ({}))
vi.mock('./ts/globalApi.svelte', () => ({ holdsOwnTabPresence: () => true }))
vi.mock('./App.svelte', () => ({ default: {} }))
vi.mock('./ts/bootstrap', () => ({ loadData: vi.fn() }))
vi.mock('./ts/hotkey', () => ({ initHotkey: vi.fn() }))
vi.mock('./preload', () => ({ preLoadCheck: () => { order.push('preLoadCheck') } }))
vi.mock('./ts/android/keepAliveService', () => ({ startKeepAliveService: vi.fn() }))
vi.mock('./ts/process/saveOnHide', () => ({ startSaveOnHide: vi.fn(), flushPageBeforeLeaving: vi.fn() }))
vi.mock('svelte', () => ({ mount: vi.fn(() => { order.push('mount'); return {} }) }))
vi.mock('./ts/backHandlers', () => ({ installBackGuard: vi.fn() }))
vi.mock('./ts/quitPill.svelte', () => ({ showQuitPill: vi.fn(), hideQuitPill: vi.fn() }))
vi.mock('./lib/Nexus/pattern/QuitPill.svelte', () => ({ default: {} }))
vi.mock('./ts/storage/store2/bootActive', () => ({ registerStore2Boot: vi.fn() }))
vi.mock('./ts/storage/store2/bootDispatch', () => ({ dispatchStore2Boot: vi.fn() }))
vi.mock('./ts/storage/store2/abandonedMarker', () => ({ markerOwnerProbeFor: vi.fn() }))
vi.mock('./ts/storage/store2/ui/productionBootUi', () => ({ createProductionBootUi: vi.fn() }))
vi.mock('./ts/chatShell/motionPrefs.svelte', () => ({ installMotionPrefs: () => { order.push('installMotionPrefs'); return () => {} } }))
vi.mock('./ts/gui/cardAnimationHold', () => ({ installCardAnimationVisibilityHold: () => { order.push('installCardAnimationVisibilityHold'); return () => {} } }))

describe('the entry module installs the card animation hold', () => {
    test('the hidden-page hold is installed once, after the motion marks and before the preload check and any mount', async () => {
        document.body.innerHTML = '<div id="app"></div><div id="preloading"></div>'
        await import('./main')
        expect(order.filter((step) => step === 'installCardAnimationVisibilityHold')).toHaveLength(1)
        const hold = order.indexOf('installCardAnimationVisibilityHold')
        expect(hold).toBeGreaterThan(order.indexOf('installMotionPrefs'))
        expect(hold).toBeLessThan(order.indexOf('preLoadCheck'))
        expect(hold).toBeLessThan(order.indexOf('mount'))
    })
})
