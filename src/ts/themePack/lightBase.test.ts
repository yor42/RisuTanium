// @vitest-environment jsdom
/**
 * The light base and its eligibility (D1a). A light-only pack gets the light reference base only when "light base + the
 * pack's canonical sheet" passes the unchanged validator, the base first. REAL: lightBase.ts over chat-light-base.css, the
 * apply core, intake over `zipPack` archives, the validator (`judgePackSheets`). FAKED: the page store (an in-memory read).
 *
 * TD9 is a regression reproducer for `['light']` (before the base every pack was dark). TD5 and TD7 are new-unit guards.
 * TD8, TD8b, TD10 and TD16 are compatibility guards: they pass before and after, because a pack that does not qualify keeps
 * today's dark base. TD18 pins the prefix-first order (it fails on the base only as a by-product). The judge-level facts
 * behind TD8b, TD16 and TD18 are in the sheets below: Origin Navy with a pinned on-accent passes a prefix that leaves out the
 * names the pack sets and fails the whole base; a mid-tone light pack passes alone and fails against the base; a header paint
 * that reads the muted text passes only with the base first.
 */
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BUILTIN_PACKS } from './builtins'
import { cr, parseConcrete } from './colour'
import { judgeAreaSheet, judgePackSheets, type PackSheetsJudgement } from './index'
import type { PackJudge } from './intake'
import { LIGHT_BASE_JUDGE_PREFIX, wantsLightBase } from './lightBase'
import { preparePackSheet, type Prepared } from './apply'
import { manifestText, zipPack } from './fixtures/packBuilder'

const world = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }))

vi.mock('../storage/store/appStore', () => ({
    getAppStore: async () => ({
        read: async (key: string) => ({ bytes: world.files.get(key) ?? null, version: null }),
    }),
}))
vi.mock('../globalApi.svelte', () => ({ getFileSrc: vi.fn() }))

const realJudge: PackJudge = async (sheets) => judgePackSheets(sheets)

function chatOf(id: string): string {
    const found = BUILTIN_PACKS.find((pack) => pack.id === id)
    if (!found) throw new Error(`no built-in ${id}`)
    return found.chatCss
}

function store(modes: readonly string[], chat: string): string {
    const bytes = zipPack({ 'manifest.json': manifestText({ modes }), 'chat.css': chat })
    const key = `assets/tp-${createHash('sha256').update(bytes).digest('hex')}.risutheme`
    world.files.set(key, bytes)
    return key
}

type Okay = Extract<Prepared, { ok: true }>

async function prepareArchive(modes: readonly string[], chat: string, judge: PackJudge = realJudge, isCurrent: () => boolean = () => true): Promise<Prepared | { ok: false; stale: true }> {
    return preparePackSheet({ kind: 'archive', key: store(modes, chat) }, judge, isCurrent)
}

async function baseOf(modes: readonly string[], chat: string, judge: PackJudge = realJudge): Promise<'light' | 'dark'> {
    const prepared = await prepareArchive(modes, chat, judge)
    expect('stale' in prepared).toBe(false)
    expect(prepared.ok).toBe(true)
    return (prepared as Okay).base
}

/** A light pack whose every colour the validator accepts alone and against the light base. */
const LIGHT_SHEET = ':root { --nexus-canvas: #fafafa; --color-surface-sheet: #ffffff; --color-surface-toast: #ffffff; --nexus-text: #000000; --nexus-text-secondary: #1a1d24; --nexus-text-muted: #000000; --nexus-ring: #102a60; --nexus-accent-rgb: 16 42 96; --nexus-accent: rgb(var(--nexus-accent-rgb)); --nexus-danger-rgb: 138 0 24; --nexus-danger: rgb(var(--nexus-danger-rgb)); --danger: #6a0012; --color-on-accent: #ffffff; --color-scheme: light; }\n'
/** Passes alone; against the base it fails because its canvas sits between the base ink and the pack ink. */
const MID_TONE_SHEET = ':root { --nexus-canvas: #969fae; --color-surface-sheet: #ffffff; --color-surface-toast: #ffffff; --nexus-text: #000000; --nexus-text-secondary: #1a1d24; --nexus-text-muted: #2a2d34; --nexus-ring: #102a60; --nexus-accent-rgb: 16 42 96; --nexus-accent: rgb(var(--nexus-accent-rgb)); --nexus-danger-rgb: 138 0 24; --nexus-danger: rgb(var(--nexus-danger-rgb)); --color-on-accent: #ffffff; --danger: #6a0012; --color-scheme: light; }\n'
/** The header reads the muted text on a mid paint. With the base first the pack's own muted (#000) is the applied value. */
const ORDER_SHEET = LIGHT_SHEET + '[data-part="chat-header"] { background-color: #9aa0b0 !important; color: var(--nexus-text-muted) !important; }\n'

let secondCalls = 0

beforeEach(() => {
    world.files.clear()
    secondCalls = 0
})

afterEach(() => {
    world.files.clear()
})

describe('the judge prefix', () => {
    test('TD7: the light base, as the judge reads it, passes alone and keeps the label names out', () => {
        const alone = judgeAreaSheet('chat', LIGHT_BASE_JUDGE_PREFIX, undefined, 'chat')
        expect(alone.result.ok).toBe(true)
        expect(LIGHT_BASE_JUDGE_PREFIX).not.toContain('--pattern-')
        expect(LIGHT_BASE_JUDGE_PREFIX.startsWith(':root {')).toBe(true)
        expect(LIGHT_BASE_JUDGE_PREFIX).toContain('--nexus-warm: #7a3b12')
    })

    test('TD7: the base inks keep their planned contrast on the canvas and on the sheet', () => {
        const value = (name: string): string => new RegExp(`${name}: ([^;]+);`).exec(LIGHT_BASE_JUDGE_PREFIX)![1].trim()
        const colour = (text: string): number[] => {
            const parsed = parseConcrete(text)
            if (parsed === null) throw new Error(`unparsable ${text}`)
            return parsed
        }
        const canvas = colour(value('--nexus-canvas'))
        const sheet = colour(value('--color-surface-sheet'))
        const floors: Array<[string, string, number]> = [
            ['--nexus-text', value('--nexus-text'), 14],
            ['--nexus-text-secondary', value('--nexus-text-secondary'), 8.5],
            ['--nexus-text-muted', value('--nexus-text-muted'), 6.5],
            ['--color-placeholder', value('--color-placeholder'), 6.5],
            ['--nexus-ring', value('--nexus-ring'), 7],
            ['--nexus-danger-rgb', `rgb(${value('--nexus-danger-rgb')})`, 5.9],
            ['--nexus-warning-rgb', `rgb(${value('--nexus-warning-rgb')})`, 5.5],
        ]
        for (const [name, text, floor] of floors) {
            expect(cr(colour(text), canvas), `${name} on the canvas`).toBeGreaterThanOrEqual(floor)
            expect(cr(colour(text), sheet), `${name} on the sheet`).toBeGreaterThanOrEqual(floor)
        }
    })

    test('TD5: every light built-in passes the base-first concatenation', () => {
        const lights = BUILTIN_PACKS.filter((pack) => wantsLightBase(pack.modes))
        expect(lights.map((pack) => pack.id).sort()).toEqual(['builtin:banana-cocoa', 'builtin:office-sheet', 'builtin:scratch-white'])
        for (const pack of lights) {
            const canonical = judgeAreaSheet('chat', pack.chatCss, undefined, 'chat').canonical
            const whole = judgeAreaSheet('chat', `${LIGHT_BASE_JUDGE_PREFIX}\n${canonical}`, undefined, 'chat')
            expect(whole.result.ok, pack.id).toBe(true)
        }
    })
})

describe('wantsLightBase', () => {
    test('exactly the single label light', () => {
        expect(wantsLightBase(['light'])).toBe(true)
        expect(wantsLightBase(['light', 'dark'])).toBe(false)
        expect(wantsLightBase(['dark', 'light'])).toBe(false)
        expect(wantsLightBase(['dark'])).toBe(false)
        expect(wantsLightBase([])).toBe(false)
    })
})

describe('TD9: the base follows the pack modes', () => {
    test.each([
        ['builtin:scratch-white', 'light'],
        ['builtin:office-sheet', 'light'],
        ['builtin:banana-cocoa', 'light'],
        ['builtin:origin-navy', 'dark'],
    ] as const)('built-in %s gets the %s base', async (id, expected) => {
        const pack = BUILTIN_PACKS.find((candidate) => candidate.id === id)!
        const prepared = await preparePackSheet({ kind: 'builtin', pack }, realJudge, () => true)
        expect(prepared.ok && (prepared as Okay).base).toBe(expected)
    })

    test('an archive labelled exactly light gets the light base; any other label keeps the dark one', async () => {
        const scratch = chatOf('builtin:scratch-white')
        expect(await baseOf(['light'], scratch)).toBe('light')
        expect(await baseOf(['light', 'dark'], scratch)).toBe('dark')
        expect(await baseOf(['dark', 'light'], scratch)).toBe('dark')
        expect(await baseOf(['dark'], scratch)).toBe('dark')
    })

    test('the second judgement runs only for a pack labelled exactly light', async () => {
        const counting: PackJudge = async (sheets) => {
            secondCalls += 1
            return judgePackSheets(sheets)
        }
        const scratch = chatOf('builtin:scratch-white')
        await baseOf(['dark'], scratch, counting)
        const darkCalls = secondCalls
        secondCalls = 0
        await baseOf(['light'], scratch, counting)
        expect(secondCalls).toBe(darkCalls + 1)
    })
})

describe('the second judgement is the eligibility proof', () => {
    test('TD8: a dark sheet labelled light, with the sheet and toast unset, keeps the dark base', async () => {
        const dark = ':root { --nexus-canvas: #101018; --nexus-text: #f0f0f0; --color-scheme: dark; }\n'
        expect(await baseOf(['light'], dark)).toBe('dark')
        expect(await baseOf(['light'], chatOf('builtin:origin-navy'))).toBe('dark')
    })

    test('TD8b: Origin Navy with a pinned on-accent, labelled light, keeps the dark base', async () => {
        const sheet = `${chatOf('builtin:origin-navy')}\n:root { --color-on-accent: #001018; }\n`
        const alone = judgeAreaSheet('chat', sheet, undefined, 'chat')
        expect(alone.result.ok).toBe(true)
        expect(await baseOf(['light'], sheet)).toBe('dark')
    })

    test('TD16: a mid-tone light pack passes alone, keeps the dark base and still applies', async () => {
        expect(judgeAreaSheet('chat', MID_TONE_SHEET, undefined, 'chat').result.ok).toBe(true)
        const prepared = await prepareArchive(['light'], MID_TONE_SHEET)
        expect(prepared.ok && (prepared as Okay).text).toContain('--nexus-canvas')
        expect((prepared as Okay).base).toBe('dark')
    })

    test('TD18: the base goes first, so a pack that sets its own muted text for a header paint is eligible', async () => {
        expect(judgeAreaSheet('chat', ORDER_SHEET, undefined, 'chat').result.ok).toBe(true)
        expect(await baseOf(['light'], ORDER_SHEET)).toBe('light')
        const canonical = judgeAreaSheet('chat', ORDER_SHEET, undefined, 'chat').canonical
        expect(judgeAreaSheet('chat', `${canonical}\n${LIGHT_BASE_JUDGE_PREFIX}`, undefined, 'chat').result.ok).toBe(false)
    })

    test('the applied text is the first judgement text; the prefix never reaches it', async () => {
        const prepared = await prepareArchive(['light'], chatOf('builtin:scratch-white'))
        const text = (prepared as Okay).text!
        expect(text).not.toContain('--nexus-warm: #7a3b12')
        expect(text).toBe(judgeAreaSheet('chat', chatOf('builtin:scratch-white'), undefined, 'chat').canonical)
    })
})

describe('TD10: a second judgement that does not answer keeps the dark base', () => {
    const scratch = (): string => chatOf('builtin:scratch-white')

    function secondOnly(second: () => Promise<PackSheetsJudgement>): PackJudge {
        let calls = 0
        return async (sheets) => {
            calls += 1
            if (calls === 1) return judgePackSheets(sheets)
            return second()
        }
    }

    test('it throws', async () => {
        expect(await baseOf(['light'], scratch(), secondOnly(async () => { throw new Error('worker lost') }))).toBe('dark')
    })

    test('it answers a refusal or no area', async () => {
        const refused: PackSheetsJudgement = { ok: false, areas: { chat: { result: { ok: false, errors: [], name: 'chat' }, canonical: '', resources: [], fontFaceBlocks: [], warnings: [] } } }
        expect(await baseOf(['light'], scratch(), secondOnly(async () => refused))).toBe('dark')
        expect(await baseOf(['light'], scratch(), secondOnly(async () => ({ ok: false, areas: {} })))).toBe('dark')
    })

    test('it answers after the call went stale: the result is stale, not light', async () => {
        let current = true
        const judge = secondOnly(async () => {
            current = false
            return judgePackSheets({ chat: LIGHT_BASE_JUDGE_PREFIX })
        })
        const prepared = await prepareArchive(['light'], scratch(), judge, () => current)
        expect(prepared).toEqual({ ok: false, stale: true })
    })
})
