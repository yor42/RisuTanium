// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    arrivalInFlight, beginArrival, cancelArrival, endArrival, focusFirstControl, runSettingsArrival,
    type ArrivalDeps, type ArrivalPage,
} from './settingsArrival'
import {
    closeSearch, HIGHLIGHT_MS, openSearch, resetSearch, setHighlight, settingsSearchState,
} from './settingsSearchState.svelte'

interface Rig {
    log: string[]
    deps: ArrivalDeps
    row: HTMLElement
    page: ArrivalPage
    releaseTick: () => void
    scrollArgs: unknown[]
}

/** Fake deps that log every call; `tick` resolves only when the test releases it. */
function makeRig(options: { reveal?: 'row' | 'missing', reduced?: boolean, holdTick?: boolean } = {}): Rig {
    const log: string[] = []
    const row = document.createElement('div')
    const scrollArgs: unknown[] = []
    row.scrollIntoView = ((arg?: unknown) => { log.push('scroll'); scrollArgs.push(arg) }) as typeof row.scrollIntoView
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const page: ArrivalPage = {
        reveal: async (rowId) => {
            log.push(`reveal:${rowId}`)
            return options.reveal === 'missing' ? null : row
        },
        focusHeading: () => { log.push('heading') },
    }
    const deps: ArrivalDeps = {
        setIndex: (index) => { log.push(`setIndex:${index}`) },
        closeSearch: () => { log.push('close') },
        tick: async () => {
            log.push('tick')
            if (options.holdTick) await held
        },
        page: () => { log.push('page'); return page },
        setHighlight: (rowId) => { log.push(`highlight:${rowId}`) },
        reducedMotion: () => options.reduced ?? false,
        focusControl: () => { log.push('focus') },
    }
    return { log, deps, row, page, releaseTick: release, scrollArgs }
}

beforeEach(() => {
    vi.useFakeTimers()
    cancelArrival()
    resetSearch()
})

afterEach(() => {
    resetSearch()
    cancelArrival()
    vi.useRealTimers()
})

describe('runSettingsArrival order (T-AR1)', () => {
    test('a row target closes, sets the index, waits, reveals, centres, highlights, then focuses', async () => {
        const rig = makeRig()
        await runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, rig.deps)
        expect(rig.log).toEqual([
            'close', 'setIndex:3', 'tick', 'page', 'reveal:display.customCSS', 'scroll',
            'highlight:display.customCSS', 'focus',
        ])
        expect(rig.scrollArgs).toEqual([{ block: 'center', behavior: 'smooth' }])
        expect(arrivalInFlight(3)).toBe(false)
    })

    test('reduced motion scrolls instantly', async () => {
        const rig = makeRig({ reduced: true })
        await runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, rig.deps)
        expect(rig.scrollArgs).toEqual([{ block: 'center', behavior: 'instant' }])
    })

    test('a row the page does not have focuses the heading and highlights nothing', async () => {
        const rig = makeRig({ reveal: 'missing' })
        await runSettingsArrival({ index: 3, rowId: 'display.nope' }, rig.deps)
        expect(rig.log).toEqual(['close', 'setIndex:3', 'tick', 'page', 'reveal:display.nope', 'heading'])
    })

    test('a page or view target focuses the heading without a reveal', async () => {
        const rig = makeRig()
        await runSettingsArrival({ index: 11, rowId: null }, rig.deps)
        expect(rig.log).toEqual(['close', 'setIndex:11', 'tick', 'page', 'heading'])
    })

    test('with no mounted page nothing is focused', async () => {
        const rig = makeRig()
        rig.deps.page = () => undefined
        await runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, rig.deps)
        expect(rig.log).toEqual(['close', 'setIndex:3', 'tick'])
    })

    test('the real search close does not cancel its own arrival', async () => {
        const rig = makeRig()
        openSearch()
        // The arrival closes the search as its first step; the focus and highlight still happen afterwards.
        await runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, { ...rig.deps, closeSearch })
        expect(settingsSearchState.open).toBe(false)
        expect(rig.log).toEqual([
            'setIndex:3', 'tick', 'page', 'reveal:display.customCSS', 'scroll', 'highlight:display.customCSS', 'focus',
        ])
    })

    test('the default focus goes to the first focusable control of the row', async () => {
        const rig = makeRig()
        const control = document.createElement('input')
        rig.row.append(document.createElement('span'), control)
        document.body.append(rig.row)
        const { focusControl: _unused, ...rest } = rig.deps
        void _unused
        await runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, rest)
        expect(document.activeElement).toBe(control)
        rig.row.remove()
    })

    test('focusFirstControl skips a disabled control and reports an empty row', () => {
        const row = document.createElement('div')
        const disabled = document.createElement('button')
        disabled.disabled = true
        row.append(disabled)
        document.body.append(row)
        expect(focusFirstControl(row)).toBe(false)
        const live = document.createElement('select')
        row.append(live)
        expect(focusFirstControl(row)).toBe(true)
        expect(document.activeElement).toBe(live)
        row.remove()
    })
})

describe('arrival marker and abort (T-AR2, I13)', () => {
    test('the marker is true only for the target index and only between begin and end', () => {
        expect(arrivalInFlight(3)).toBe(false)
        const token = beginArrival(3)
        expect(arrivalInFlight(3)).toBe(true)
        expect(arrivalInFlight(4)).toBe(false)
        endArrival(token)
        expect(arrivalInFlight(3)).toBe(false)
    })

    test('a stale token cannot end a newer arrival', () => {
        const first = beginArrival(3)
        const second = beginArrival(4)
        endArrival(first)
        expect(arrivalInFlight(4)).toBe(true)
        endArrival(second)
        expect(arrivalInFlight(4)).toBe(false)
    })

    test.each([
        ['cancelArrival', () => cancelArrival()],
        ['openSearch', () => openSearch()],
        ['a second beginArrival', () => { beginArrival(7) }],
        ['resetSearch', () => resetSearch()],
    ])('%s while the tick is pending leaves no focus and no highlight', async (_name, abort) => {
        const rig = makeRig({ holdTick: true })
        const running = runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, rig.deps)
        await vi.advanceTimersByTimeAsync(0)
        expect(arrivalInFlight(3)).toBe(true)
        abort()
        rig.releaseTick()
        await running
        expect(rig.log).toEqual(['close', 'setIndex:3', 'tick'])
        expect(arrivalInFlight(3)).toBe(false)
        cancelArrival()
    })

    test('an abort during the reveal sets no highlight and moves no focus', async () => {
        const rig = makeRig()
        rig.page.reveal = async (rowId) => {
            rig.log.push(`reveal:${rowId}`)
            cancelArrival()
            return rig.row
        }
        await runSettingsArrival({ index: 3, rowId: 'display.customCSS' }, rig.deps)
        expect(rig.log).toEqual(['close', 'setIndex:3', 'tick', 'page', 'reveal:display.customCSS'])
    })
})

describe('highlight and teardown timers (T-A12d, I10)', () => {
    test('the highlight clears after the set time', () => {
        setHighlight('display.lineHeight')
        expect(settingsSearchState.highlightedRow).toBe('display.lineHeight')
        vi.advanceTimersByTime(HIGHLIGHT_MS - 1)
        expect(settingsSearchState.highlightedRow).toBe('display.lineHeight')
        vi.advanceTimersByTime(1)
        expect(settingsSearchState.highlightedRow).toBeNull()
    })

    test('a second highlight replaces the first and keeps its own full time', () => {
        setHighlight('display.lineHeight')
        vi.advanceTimersByTime(1500)
        setHighlight('display.customCSS')
        vi.advanceTimersByTime(1000)
        expect(settingsSearchState.highlightedRow).toBe('display.customCSS')
        vi.advanceTimersByTime(1000)
        expect(settingsSearchState.highlightedRow).toBeNull()
    })

    test('resetSearch clears the highlight and leaves no timer', () => {
        setHighlight('display.lineHeight')
        vi.advanceTimersByTime(500)
        resetSearch()
        expect(settingsSearchState.highlightedRow).toBeNull()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('resetSearch clears the query, the open flag and a pending arrival', () => {
        openSearch()
        settingsSearchState.query = 'font'
        beginArrival(3)
        resetSearch()
        expect(settingsSearchState.open).toBe(false)
        expect(settingsSearchState.query).toBe('')
        expect(arrivalInFlight(3)).toBe(false)
    })

    test('each open takes a new token', () => {
        openSearch()
        const first = settingsSearchState.openToken
        closeSearch()
        openSearch()
        expect(settingsSearchState.openToken).toBe(first + 1)
    })
})
