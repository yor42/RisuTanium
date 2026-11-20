// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PatternWarning from './PatternWarning.svelte'
import { resetPickOpenerForTest } from '../../../ts/pickOpener'
import { spokenOpening, type PatternWarningDef } from './patternWarning'

const def: PatternWarningDef = {
    severity: 'caution',
    headline: 'Leave things out',
    consequences: ['Usage stats are left out', 'Prices are left out'],
    actions: { cancel: 'Cancel', primary: 'Go ahead' },
}

const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function open(overrides: Partial<PatternWarningDef> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PatternWarning, { target, props: { def: { ...def, ...overrides } as PatternWarningDef, onanswer: () => { } } })
    mounted.push({ target, app })
    flushSync()
    return target
}

function region(target: HTMLElement): HTMLElement | null {
    return target.querySelector<HTMLElement>('[data-part="pattern-dialog-announce"]')
}

beforeEach(() => {
    resetPickOpenerForTest()
    vi.useFakeTimers()
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app)
        target.remove()
    }
    vi.useRealTimers()
})

describe('spokenOpening', () => {
    // R307-8b
    test('joins the headline and the line with one space after closing punctuation, otherwise a full stop', () => {
        expect(spokenOpening('Import 2 files')).toBe('Import 2 files')
        expect(spokenOpening('Import 2 files', undefined)).toBe('Import 2 files')
        expect(spokenOpening('Import 2 files', '3 MiB')).toBe('Import 2 files. 3 MiB')
        expect(spokenOpening('  Import 2 files  ', '3 MiB')).toBe('Import 2 files. 3 MiB')
        for (const mark of ['.', '!', '?', '…', '。', '！', '？', ':', '：']) {
            expect(spokenOpening(`Leave out${mark}`, 'Stats')).toBe(`Leave out${mark} Stats`)
        }
        expect(spokenOpening('Leave out,', 'Stats')).toBe('Leave out,. Stats')
    })
})

describe('the dialog announce region', () => {
    // R307-1 (sheet form)
    test('sits inside the dialog, is empty at mount, and holds the opening text once after a frame plus the settle', async () => {
        const target = open()
        const dialog = target.querySelector<HTMLElement>('[data-part="pattern-dialog"]')!
        const live = region(target)!
        expect(live).not.toBeNull()
        expect(dialog.contains(live)).toBe(true)
        expect(live.getAttribute('role')).toBe('status')
        expect(live.classList.contains('sr-only')).toBe(true)
        expect(live.textContent).toBe('')
        let writes = 0
        const observer = new MutationObserver((records) => { writes += records.length })
        observer.observe(live, { childList: true, characterData: true, subtree: true })
        vi.advanceTimersByTime(150)
        await Promise.resolve()
        expect(live.textContent).toBe('')
        vi.advanceTimersByTime(100)
        flushSync()
        await Promise.resolve()
        expect(live.textContent).toBe('Leave things out. Usage stats are left out')
        vi.advanceTimersByTime(5000)
        flushSync()
        await Promise.resolve()
        expect(live.textContent).toBe('Leave things out. Usage stats are left out')
        expect(writes).toBe(1)
        observer.disconnect()
    })

    test('speaks the headline alone when the sheet has no consequence line', () => {
        const target = open({ consequences: undefined })
        vi.advanceTimersByTime(300)
        flushSync()
        expect(region(target)).not.toBeNull()
        expect(region(target)!.textContent).toBe('Leave things out')
    })

    test('a sheet closed before the settle never writes, and leaves no timer behind', async () => {
        const target = open()
        const live = region(target)!
        expect(live).not.toBeNull()
        const entry = mounted.pop()!
        await unmount(entry.app)
        entry.target.remove()
        vi.advanceTimersByTime(1000)
        expect(live.textContent).toBe('')
        expect(vi.getTimerCount()).toBe(0)
    })
})
