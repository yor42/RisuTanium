// @vitest-environment jsdom

/**
 * The legacy row sheet, the hold counter and the row-settle registry. jsdom has no layout and no content-visibility
 * engine, so the sheet is read through CSSOM and its selectors are matched against built DOM.
 *
 * Labels: G = guard of a new module (it cannot run on the base, where the module is absent).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { holdRowLayout, holdUntilRowsRendered, releaseRowHoldAfterFrames } from './legacyRowVisibility'
import { forgetRows, noteRowBodyRendered, waitForRows } from './rowBodySettle'

const HOLD = 'data-risu-cv-hold'

function sheetRules(): { cis: CSSStyleRule[], supports: CSSSupportsRule[], styleRulesInSupports: CSSStyleRule[], all: CSSRule[] } {
    const style = document.head.querySelector('style[data-risu-sheet="legacy-row-visibility"]') as HTMLStyleElement
    expect(style).not.toBeNull()
    const rules = [...(style.sheet as CSSStyleSheet).cssRules]
    const supports = rules.filter((r) => r.constructor.name === 'CSSSupportsRule') as CSSSupportsRule[]
    const cis = rules.filter((r) => r.constructor.name === 'CSSStyleRule') as CSSStyleRule[]
    const styleRulesInSupports = supports.flatMap((s) => [...s.cssRules] as CSSStyleRule[])
    return { cis, supports, styleRulesInSupports, all: rules }
}

describe('G the sheet', () => {
    test('G T6 has one size rule outside the support query and one skipping rule inside it', () => {
        const { cis, supports, styleRulesInSupports, all } = sheetRules()
        expect(all).toHaveLength(2)
        expect(cis).toHaveLength(1)
        expect(cis[0].style.getPropertyValue('contain-intrinsic-size')).toBe('auto 400px')
        expect(cis[0].selectorText).not.toContain('data-risu-cv-hold')
        expect(cis[0].style.getPropertyValue('content-visibility')).toBe('')
        expect(supports).toHaveLength(1)
        expect(supports[0].conditionText).toContain('overflow-clip-margin: 80px')
        expect(styleRulesInSupports).toHaveLength(1)
        expect(styleRulesInSupports[0].style.getPropertyValue('content-visibility')).toBe('auto')
        expect(styleRulesInSupports[0].style.getPropertyValue('overflow-clip-margin')).toBe('80px')
        expect(styleRulesInSupports[0].style.getPropertyValue('contain-intrinsic-size')).toBe('')
        expect(styleRulesInSupports[0].style.getPropertyPriority('content-visibility')).toBe('')
        expect(cis[0].style.getPropertyPriority('contain-intrinsic-size')).toBe('')
    })

    function buildList(count: number): { list: HTMLElement, rows: HTMLElement[] } {
        const list = document.createElement('div')
        list.setAttribute('data-part', 'chat-messages')
        const rows: HTMLElement[] = []
        for (let i = 0; i < count; i++) {
            const row = document.createElement('div')
            row.className = 'chat-message-container'
            list.append(row)
            rows.push(row)
        }
        document.body.append(list)
        return { list, rows }
    }

    afterEach(() => {
        document.body.replaceChildren()
    })

    test('G the skipping rule matches from the fourth row, never rows with an editor or an overlay, never a held list', () => {
        const { styleRulesInSupports, cis } = sheetRules()
        const cv = styleRulesInSupports[0].selectorText
        const { list, rows } = buildList(6)
        expect(rows.map((r) => r.matches(cv))).toEqual([false, false, false, true, true, true])
        expect(rows.map((r) => r.matches(cis[0].selectorText))).toEqual([true, true, true, true, true, true])
        const editor = document.createElement('textarea')
        editor.className = 'message-edit-area'
        rows[4].append(editor)
        const overlay = document.createElement('div')
        overlay.className = 'partial-edit-overlay'
        rows[5].append(overlay)
        expect(rows.map((r) => r.matches(cv))).toEqual([false, false, false, true, false, false])
        list.setAttribute(HOLD, '')
        expect(rows.map((r) => r.matches(cv))).toEqual([false, false, false, false, false, false])
    })

    test('G rows of a shell list never match', () => {
        const { styleRulesInSupports, cis } = sheetRules()
        const shell = document.createElement('div')
        shell.className = 'default-chat-screen'
        const list = document.createElement('div')
        list.setAttribute('data-part', 'chat-message-list')
        shell.append(list)
        const rows = Array.from({ length: 6 }, () => {
            const row = document.createElement('div')
            row.className = 'chat-message-container'
            list.append(row)
            return row
        })
        document.body.append(shell)
        for (const row of rows) {
            expect(row.matches(styleRulesInSupports[0].selectorText)).toBe(false)
            expect(row.matches(cis[0].selectorText)).toBe(false)
        }
    })
})

describe('G the hold counter and the frame helper', () => {
    let frames: Array<() => void> = []

    beforeEach(() => {
        frames = []
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length })
        vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {} })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.useRealTimers()
    })

    const runFrame = () => {
        const batch = frames
        frames = []
        batch.forEach((cb) => cb())
    }

    test('G T5 holds stack, a release is idempotent and elements are independent', () => {
        const a = document.createElement('div')
        const b = document.createElement('div')
        const first = holdRowLayout(a)
        const second = holdRowLayout(a)
        const other = holdRowLayout(b)
        expect(a.hasAttribute(HOLD)).toBe(true)
        first()
        first()
        expect(a.hasAttribute(HOLD)).toBe(true)
        second()
        expect(a.hasAttribute(HOLD)).toBe(false)
        expect(b.hasAttribute(HOLD)).toBe(true)
        other()
        expect(b.hasAttribute(HOLD)).toBe(false)
    })

    test('G T5 releaseRowHoldAfterFrames fires on the second frame, and a cancel stops it', () => {
        const release = vi.fn()
        releaseRowHoldAfterFrames(release, 2)
        runFrame()
        expect(release).not.toHaveBeenCalled()
        runFrame()
        expect(release).toHaveBeenCalledTimes(1)
        const cancelled = vi.fn()
        const cancel = releaseRowHoldAfterFrames(cancelled, 2)
        runFrame()
        cancel()
        runFrame()
        runFrame()
        expect(cancelled).not.toHaveBeenCalled()
    })

    test('G T5 the registry ignores unregistered bodies, ends a wait on the last report and on forget', () => {
        const row = document.createElement('div')
        row.className = 'chat-message-container'
        const body = document.createElement('span')
        row.append(body)
        noteRowBodyRendered(body)
        const settled = vi.fn()
        waitForRows([row], settled)
        noteRowBodyRendered(document.createElement('span'))
        expect(settled).not.toHaveBeenCalled()
        noteRowBodyRendered(body)
        expect(settled).toHaveBeenCalledTimes(1)
        noteRowBodyRendered(body)
        expect(settled).toHaveBeenCalledTimes(1)

        const second = document.createElement('div')
        const secondSettled = vi.fn()
        waitForRows([second], secondSettled)
        forgetRows([second])
        expect(secondSettled).toHaveBeenCalledTimes(1)
    })

    test('G holdUntilRowsRendered waits for every report, then two frames; the cap ends it; a comment-only run takes the frames only', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const list = document.createElement('div')
        const rows = [document.createElement('div'), document.createElement('div')]
        const bodies = rows.map((row) => {
            row.className = 'chat-message-container'
            const body = document.createElement('span')
            row.append(body)
            return body
        })
        holdUntilRowsRendered(list, rows)
        expect(list.hasAttribute(HOLD)).toBe(true)
        runFrame()
        runFrame()
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(true)
        noteRowBodyRendered(bodies[0])
        expect(list.hasAttribute(HOLD)).toBe(true)
        noteRowBodyRendered(bodies[1])
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(true)
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(false)

        const slow = document.createElement('div')
        slow.className = 'chat-message-container'
        holdUntilRowsRendered(list, [slow])
        vi.advanceTimersByTime(1499)
        runFrame()
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(true)
        vi.advanceTimersByTime(1)
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(true)
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)

        holdUntilRowsRendered(list, [])
        expect(list.hasAttribute(HOLD)).toBe(true)
        runFrame()
        runFrame()
        expect(list.hasAttribute(HOLD)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
    })

    test('G cancel releases at once and leaves no timer', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const list = document.createElement('div')
        const row = document.createElement('div')
        const ended = vi.fn()
        const hold = holdUntilRowsRendered(list, [row], ended)
        hold.cancel()
        expect(list.hasAttribute(HOLD)).toBe(false)
        expect(vi.getTimerCount()).toBe(0)
        expect(ended).toHaveBeenCalledTimes(1)
    })
})
