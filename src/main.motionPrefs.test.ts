// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

/**
 * `src/main.ts` marks the root with the device's low-power and reduced-motion choices (MC-1529) before anything
 * can paint: before the preload check and before the app mounts. The entry module is imported with everything it
 * mounts or starts replaced, and the order of the calls is recorded.
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

describe('the entry module installs the motion marks first', () => {
    test('installMotionPrefs runs once, before the preload check and before any mount', async () => {
        document.body.innerHTML = '<div id="app"></div><div id="preloading"></div>'
        await import('./main')
        expect(order.filter((step) => step === 'installMotionPrefs')).toHaveLength(1)
        expect(order[0]).toBe('installMotionPrefs')
        expect(order.indexOf('installMotionPrefs')).toBeLessThan(order.indexOf('preLoadCheck'))
        expect(order.indexOf('installMotionPrefs')).toBeLessThan(order.indexOf('mount'))
    })
})
