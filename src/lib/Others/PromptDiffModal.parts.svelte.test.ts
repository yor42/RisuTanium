// @vitest-environment jsdom

/**
 * `PromptDiffModal.svelte` carries the overlay vocabulary on its frame, header and close button ONLY (#438 W3-4, MC-4165 PQ-2). The REAL component
 * is mounted over two synthetic presets; each element is found by tag, role, aria-label or structure, never by its part, and the part is asserted
 * on it together with its direct parent. The outline tests pin the whole nesting in every format and view state, so a part that is dropped,
 * renamed, swapped with its parent or a sibling, moved into a comment or moved inward or outward fails; the guards pin that the diff view and the
 * option controls stay unclaimed.
 *
 * Tests starting `acceptance:` fail on the base (every part is absent). Tests starting `guard:` pass before and after.
 * MOCKED: `getDatabase` (a plain database holding two synthetic presets) and the Android Back registry, as in `PromptDiffModal.names.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: {} as unknown }))

vi.mock(import('../../ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../../ts/storage/database.svelte'))

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

import { language } from 'src/lang'
import PromptDiffModal from './PromptDiffModal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await sleep(20)
        flushSync()
    }
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(onClose: () => void = () => {}): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1, onClose } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

const bodyLines = (changed: string) =>
    Array.from({ length: 30 }, (_, i) => (i === 15 ? changed : `line ${i}`)).join('\n')

function plain(name: string | undefined, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', text, ...(name === undefined ? {} : { name }) }
}

type Prefs = { diffStyle: string, formatStyle: string, viewStyle: string, showOnlyChanges: boolean }

function useDb(prefs: Prefs): void {
    dbBox.db = {
        promptDiffPrefs: { isGrouped: false, contextRadius: 1, ...prefs },
        botPresets: [
            { promptTemplate: [plain('Main', bodyLines('old')), plain(undefined, 'same'), plain('Gone', 'removed body')] },
            { promptTemplate: [plain('Main', bodyLines('new')), plain(undefined, 'same'), plain('Extra', 'added body')] },
        ],
    } as unknown as Database
}

const STATES: Prefs[] = []
for (const formatStyle of ['card', 'raw']) {
    for (const viewStyle of ['unified', 'split']) {
        for (const diffStyle of ['line', 'intraline']) {
            for (const showOnlyChanges of [false, true]) {
                STATES.push({ diffStyle, formatStyle, viewStyle, showOnlyChanges })
            }
        }
    }
}

beforeEach(() => {
    useDb({ diffStyle: 'line', formatStyle: 'card', viewStyle: 'unified', showOnlyChanges: false })
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const partOf = (el: Element | null): string | null => el?.getAttribute('data-part') ?? null

/** The names of the parted elements as a nested string: `name(child child)`; an element without a part is looked through. */
function outline(el: Element): string {
    const inner = Array.from(el.children).map(outline).filter((text) => text !== '').join(' ')
    const name = partOf(el)
    if (name === null) return inner
    return inner === '' ? name : `${name}(${inner})`
}

const closeOf = (target: HTMLElement): HTMLElement => target.querySelector(`button[aria-label="${language.uiCommon.close}"]`) as HTMLElement
const legacyOf = (target: HTMLElement): HTMLInputElement => target.querySelector(`input[type="checkbox"][aria-label="${language.promptDiff.legacy}"]`) as HTMLInputElement

describe('PromptDiffModal overlay parts', { timeout: 60_000 }, () => {
    test('acceptance: the backdrop layer, frame, header and close', async () => {
        const target = await mountModal()
        const layer = target.firstElementChild as HTMLElement
        expect(partOf(layer)).toBe('modal-prompt-diff')
        const dialog = target.querySelector('[role="dialog"]') as HTMLElement
        expect(partOf(dialog)).toBe('modal-frame')
        expect(dialog.parentElement).toBe(layer)
        const header = dialog.firstElementChild as HTMLElement
        expect(partOf(header)).toBe('modal-header')
        expect(header.parentElement).toBe(dialog)
        const close = closeOf(target)
        expect(partOf(close)).toBe('modal-close')
        expect(close.parentElement).toBe(header)
    })

    test.each(STATES.map((state, index) => [index, JSON.stringify(state), state] as const))('acceptance: state %i %s carries exactly the four parts', async (_index, _label, state) => {
        useDb(state)
        const target = await mountModal()
        expect(outline(target)).toBe('modal-prompt-diff(modal-frame(modal-header(modal-close)))')
    })

    test('acceptance: with the Legacy checkbox ticked the outline is the same four parts', async () => {
        const target = await mountModal()
        const legacy = legacyOf(target)
        expect(legacy.checked).toBe(false)
        legacy.click()
        await settle()
        expect(legacyOf(target).checked).toBe(true)
        expect(outline(target)).toBe('modal-prompt-diff(modal-frame(modal-header(modal-close)))')
    })

    test('guard: the diff body and the option row carry no part, in every state', async () => {
        for (const state of STATES) {
            useDb(state)
            const target = await mountModal()
            const dialog = target.querySelector('[role="dialog"]') as HTMLElement
            const header = dialog.firstElementChild as HTMLElement
            const body = dialog.children[1] as HTMLElement
            expect(body, JSON.stringify(state)).toBeTruthy()
            expect(partOf(body)).toBeNull()
            expect(body.querySelector('[data-part]')).toBeNull()
            const optionRow = header.firstElementChild as HTMLElement
            expect(optionRow).not.toBe(closeOf(target))
            expect(partOf(optionRow)).toBeNull()
            expect(optionRow.querySelector('[data-part]')).toBeNull()
            for (const control of Array.from(target.querySelectorAll('input[type="radio"], input[type="checkbox"], input[type="range"]'))) {
                expect(partOf(control)).toBeNull()
            }
        }
    })

    test('guard: the close button calls onClose once and writes the view preferences', async () => {
        const onClose = vi.fn()
        const target = await mountModal(onClose)
        closeOf(target).click()
        flushSync()
        expect(onClose).toHaveBeenCalledTimes(1)
        const prefs = (dbBox.db as { promptDiffPrefs: Prefs }).promptDiffPrefs
        expect(prefs.diffStyle).toBe('line')
        expect(prefs.formatStyle).toBe('card')
    })
})
