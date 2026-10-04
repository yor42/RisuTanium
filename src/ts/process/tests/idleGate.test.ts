/**
 * The idle reload's gate and hold (`../memory/idleGate`): each condition alone
 * blocks, all conditions open fire only after the continuous hold, and a hold
 * is restarted by an interruption or by any watched counter moving, even one
 * that returns to its starting state.
 */
import { describe, expect, test } from 'vitest'
import {
    HOLD_MS,
    IDLE_MS,
    NOT_HOLDING,
    RESTORED_BYTES_THRESHOLD,
    idleGateBlockers,
    idleReloadMayStart,
    stepHold,
    type IdleBlocker,
    type IdleSignals,
} from '../memory/idleGate'

function openSignals(): IdleSignals {
    return {
        platformEnabled: true,
        archivingOn: true,
        canArchive: true,
        v21PluginEnabled: false,
        breaker: 'none',
        tooLarge: false,
        formatOk: true,
        restoredBytesOutside: RESTORED_BYTES_THRESHOLD,
        otherTabOpen: false,
        saveClean: true,
        busyAction: false,
        chokePointInFlight: false,
        workInProgress: false,
        startupCleanupPending: false,
        pluginDevMode: false,
        idleMs: IDLE_MS,
        windowFocused: true,
        pageVisible: true,
        ttsPlaying: false,
        mediaPlaying: false,
        pluginPanelOpen: false,
        realmOpen: false,
        alertOpen: false,
        promptOpen: false,
        modalOpen: false,
        composerDraftOnScreen: false,
        editorOpen: false,
        rateLimited: false,
        historyUnreadable: false,
    }
}

const SINGLE_CHANGES: [IdleBlocker, Partial<IdleSignals>][] = [
    ['platform', { platformEnabled: false }],
    ['archivingOff', { archivingOn: false }],
    ['cannotArchive', { canArchive: false }],
    ['v21Plugin', { v21PluginEnabled: true }],
    ['breaker', { breaker: 'one' }],
    ['breaker', { breaker: 'paused' }],
    ['breaker', { breaker: 'unreadable' }],
    ['tooLarge', { tooLarge: true }],
    ['formatVersion', { formatOk: false }],
    ['belowThreshold', { restoredBytesOutside: RESTORED_BYTES_THRESHOLD - 1 }],
    ['otherTab', { otherTabOpen: true }],
    ['otherTab', { otherTabOpen: null }],
    ['unsaved', { saveClean: false }],
    ['busyAction', { busyAction: true }],
    ['chokePoint', { chokePointInFlight: true }],
    ['work', { workInProgress: true }],
    ['startupCleanup', { startupCleanupPending: true }],
    ['pluginDevMode', { pluginDevMode: true }],
    ['notIdle', { idleMs: IDLE_MS - 1 }],
    ['noFocus', { windowFocused: false }],
    ['hidden', { pageVisible: false }],
    ['tts', { ttsPlaying: true }],
    ['media', { mediaPlaying: true }],
    ['pluginPanel', { pluginPanelOpen: true }],
    ['realm', { realmOpen: true }],
    ['alert', { alertOpen: true }],
    ['prompt', { promptOpen: true }],
    ['modal', { modalOpen: true }],
    ['composerDraft', { composerDraftOnScreen: true }],
    ['editorOpen', { editorOpen: true }],
    ['rateLimited', { rateLimited: true }],
    ['historyUnreadable', { historyUnreadable: true }],
]

describe('the idle reload gate', () => {
    test('has no blocker when every condition is open', () => {
        expect(idleGateBlockers(openSignals())).toEqual([])
    })

    test.each(SINGLE_CHANGES)('%s alone blocks it (%o)', (blocker, change) => {
        expect(idleGateBlockers({ ...openSignals(), ...change })).toEqual([blocker])
    })

    test('a restored-bytes figure that is not a number blocks it', () => {
        expect(idleGateBlockers({ ...openSignals(), restoredBytesOutside: Number.NaN })).toEqual(['belowThreshold'])
    })

    test('names every blocker when several hold at once', () => {
        const blockers = idleGateBlockers({ ...openSignals(), saveClean: false, modalOpen: true })
        expect(blockers).toEqual(['unsaved', 'modal'])
    })
})

describe('a page may arm the idle reload', () => {
    const page = { platformEnabled: true, canArchive: true, bootedByIdleReload: false, bootPassCommitted: false }

    test('on an ordinary boot that could archive', () => {
        expect(idleReloadMayStart(page)).toBe(true)
    })

    test('never where there is no platform path or the archive session could not archive', () => {
        expect(idleReloadMayStart({ ...page, platformEnabled: false })).toBe(false)
        expect(idleReloadMayStart({ ...page, canArchive: false })).toBe(false)
    })

    test('after an idle reload whose pass committed', () => {
        expect(idleReloadMayStart({ ...page, bootedByIdleReload: true, bootPassCommitted: true })).toBe(true)
    })

    test('not after an idle reload whose pass did not run or commit', () => {
        expect(idleReloadMayStart({ ...page, bootedByIdleReload: true, bootPassCommitted: false })).toBe(false)
    })
})

describe('the continuous hold', () => {
    const epoch = [10, 0, 5, 1, 2]

    test('starts at the first open look and fires once it has lasted the hold time', () => {
        let step = stepHold(NOT_HOLDING, { blocked: false, epoch, now: 1_000 })
        expect(step.fire).toBe(false)
        step = stepHold(step.state, { blocked: false, epoch, now: 1_000 + HOLD_MS - 1 })
        expect(step.fire).toBe(false)
        step = stepHold(step.state, { blocked: false, epoch, now: 1_000 + HOLD_MS })
        expect(step.fire).toBe(true)
    })

    test('a hold interrupted just before the hold time starts over', () => {
        let step = stepHold(NOT_HOLDING, { blocked: false, epoch, now: 0 })
        step = stepHold(step.state, { blocked: false, epoch, now: HOLD_MS - 100 })
        step = stepHold(step.state, { blocked: true, epoch, now: HOLD_MS - 50 })
        expect(step.state).toEqual(NOT_HOLDING)
        step = stepHold(step.state, { blocked: false, epoch, now: HOLD_MS })
        expect(step.fire).toBe(false)
        step = stepHold(step.state, { blocked: false, epoch, now: HOLD_MS + HOLD_MS - 1 })
        expect(step.fire).toBe(false)
        step = stepHold(step.state, { blocked: false, epoch, now: HOLD_MS + HOLD_MS })
        expect(step.fire).toBe(true)
    })

    test('a counter that moved restarts the hold even when it is back to a clean state by the next look', () => {
        let step = stepHold(NOT_HOLDING, { blocked: false, epoch, now: 0 })
        step = stepHold(step.state, { blocked: false, epoch: [10, 0, 6, 1, 2], now: HOLD_MS - 1 })
        expect(step.fire).toBe(false)
        step = stepHold(step.state, { blocked: false, epoch: [10, 0, 6, 1, 2], now: HOLD_MS })
        expect(step.fire).toBe(false)
        step = stepHold(step.state, { blocked: false, epoch: [10, 0, 6, 1, 2], now: HOLD_MS - 1 + HOLD_MS })
        expect(step.fire).toBe(true)
    })
})
