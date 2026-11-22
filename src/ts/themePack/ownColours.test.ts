/**
 * The own-colours trigger (`ownColours.on`): the readability predicate, the verdict carried from the judge through the
 * driver, the fail-closed paths and the Settings switch in `colorschemeCore.ts`. `DBState.db` is a plain object here, as in
 * the neighbouring colour-scheme tests. REAL: colorschemeCore, the driver (`activePack.svelte.ts`) and the judge client's
 * reader. MOCKED: the apply core's prepare and commit, so a prepared outcome can carry a chosen verdict.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    prepared: null as unknown,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock('./apply', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./apply')>()),
    preparePackSheet: vi.fn(async () => h.prepared),
    commitPackSheet: vi.fn(() => ({ ok: true })),
    setPackSheetColours: vi.fn(),
    resetPackSheetForTests: vi.fn(),
}))

import { CustomCSSStore } from '../stores.svelte'
import { PACK_SCHEME_NAME, colorSchemePresets, defaultColorScheme, schemeReadable, setPackSchemeProvider, setSettingsOwnColours, updateColorScheme, type ColorScheme } from '../gui/colorschemeCore'
import { isLite } from '../lite'
import { BUILTIN_PACKS } from './builtins'
import { packDefaultScheme } from './packColours'
import { readJudgement } from './judgeClient'
import { judgeAreaSheet } from './index'
import { ownColours, resetOwnColoursForTests, triggersOwnColours } from './ownColours.svelte'
import { packSafe } from './packSafeFlag.svelte'
import { resetThemePackApplyForTests, startThemePackApply } from './activePack.svelte'

const READABLE: ColorScheme = {
    bgcolor: '#21222c', darkbg: '#191a21', borderc: '#bd93f9', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#a0a4b8', darkBorderc: '#343746', darkbutton: '#282a36', type: 'dark',
}
// textcolor2 #888888 on bgcolor #333333 is 3.56:1.
const F1: ColorScheme = { ...READABLE, bgcolor: '#333333', darkbg: '#2a2a2a', textcolor: '#eeeeee', textcolor2: '#888888' }

function prop(name: string): string {
    return document.documentElement.style.getPropertyValue(name)
}

function packDb(scheme: ColorScheme): void {
    for (const key of Object.keys(h.db)) {
        Reflect.deleteProperty(h.db, key)
    }
    Object.assign(h.db, {
        colorSchemeName: PACK_SCHEME_NAME,
        colorScheme: structuredClone(scheme),
        themePackSchemeSnapshot: { name: 'ocean', scheme: structuredClone(colorSchemePresets.ocean) },
        customColorScheme: structuredClone(defaultColorScheme),
        textTheme: 'standard',
        customTextTheme: {},
        font: 'default',
        customCSS: '',
    })
}

beforeEach(() => {
    packDb(READABLE)
    resetOwnColoursForTests()
    document.documentElement.removeAttribute('style')
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    setPackSchemeProvider(null)
    isLite.set(false)
    packSafe.on = false
    resetThemePackApplyForTests()
    vi.restoreAllMocks()
})

describe('schemeReadable', () => {
    test('the default, dark and light presets and every built-in pack scheme are readable', () => {
        for (const name of ['default', 'dark', 'light'] as const) {
            expect(schemeReadable(colorSchemePresets[name]), name).toBe(true)
        }
        for (const pack of BUILTIN_PACKS) {
            const chat = judgeAreaSheet('chat', pack.chatCss, undefined, 'chat')
            for (const base of ['dark', 'light'] as const) {
                const scheme = packDefaultScheme(chat.canonical, base)
                expect(scheme, pack.slug).not.toBeNull()
                expect(schemeReadable(scheme!), `${pack.slug} ${base}`).toBe(true)
            }
        }
    })

    test('a preset whose secondary text is under the floor is unreadable', () => {
        expect(schemeReadable(colorSchemePresets.nature)).toBe(false)
    })

    test('a scheme under the floor is unreadable', () => {
        expect(schemeReadable(F1)).toBe(false)
        expect(schemeReadable({ ...READABLE, textcolor: '#222222' })).toBe(false)
        expect(schemeReadable({ ...READABLE, darkbg: '#a0a4b8' })).toBe(false)
    })

    test('a translucent backdrop is read composited over black', () => {
        expect(schemeReadable({ ...READABLE, bgcolor: 'rgb(255 255 255 / 0.05)' })).toBe(true)
        expect(schemeReadable({ ...READABLE, textcolor: '#ffffff', bgcolor: '#fff' })).toBe(false)
    })

    test('a field that cannot be read makes the scheme unreadable', () => {
        for (const field of ['textcolor', 'textcolor2', 'bgcolor', 'darkbg'] as const) {
            for (const bad of ['not-a-colour', '']) {
                expect(schemeReadable({ ...READABLE, [field]: bad }), `${field}=${JSON.stringify(bad)}`).toBe(false)
            }
        }
    })
})

describe('the trigger computed by updateColorScheme', () => {
    test('no pack: off, and the user scheme paints', () => {
        h.db.colorSchemeName = 'ocean'
        ownColours.verdict = true
        updateColorScheme()
        expect(ownColours.on).toBe(false)
        expect(prop('--risu-theme-bgcolor')).toBe(colorSchemePresets.ocean.bgcolor)
    })

    test('no pack on a built-in preset whose scheme is unreadable: off, with no snapshot to paint', () => {
        for (const key of Object.keys(h.db)) {
            Reflect.deleteProperty(h.db, key)
        }
        Object.assign(h.db, {
            colorSchemeName: 'nature',
            colorScheme: structuredClone(colorSchemePresets.nature),
            customColorScheme: structuredClone(defaultColorScheme),
            textTheme: 'standard',
            customTextTheme: {},
            font: 'default',
            customCSS: '',
        })
        expect(schemeReadable(colorSchemePresets.nature)).toBe(false)
        updateColorScheme()
        expect(ownColours.on).toBe(false)
    })

    test('a readable pack with no verdict: off in every phase, before and after the provider is registered', () => {
        updateColorScheme()
        expect(ownColours.on).toBe(false)
        setPackSchemeProvider(() => READABLE)
        updateColorScheme()
        expect(ownColours.on).toBe(false)
    })

    test('an unreadable stored scheme is on before any provider, and an unreadable live one is on', () => {
        packDb(F1)
        updateColorScheme()
        expect(ownColours.on).toBe(true)
        packDb(READABLE)
        setPackSchemeProvider(() => F1)
        updateColorScheme()
        expect(ownColours.on).toBe(true)
    })

    test('a verdict applies only with a live pack provider', () => {
        ownColours.verdict = true
        updateColorScheme()
        expect(ownColours.on).toBe(false)
        setPackSchemeProvider(() => READABLE)
        updateColorScheme()
        expect(ownColours.on).toBe(true)
        ownColours.verdict = false
        updateColorScheme()
        expect(ownColours.on).toBe(false)
    })

    test('an unreadable scheme is on with a verdict too, and without a provider', () => {
        packDb(F1)
        ownColours.verdict = true
        updateColorScheme()
        expect(ownColours.on).toBe(true)
    })

    test('pack safe mode and lite are never on', () => {
        packDb(F1)
        packSafe.on = true
        updateColorScheme()
        expect(ownColours.on).toBe(false)
        packSafe.on = false
        isLite.set(true)
        updateColorScheme()
        expect(ownColours.on).toBe(false)
    })

    test('an unparseable stored colour fails closed: on, with the 27 root properties still written', () => {
        packDb({ ...READABLE, textcolor: 'not-a-colour' })
        updateColorScheme()
        expect(ownColours.on).toBe(true)
        expect(prop('--risu-theme-textcolor')).toBe('not-a-colour')
        expect(prop('--risu-theme-bgcolor')).toBe(READABLE.bgcolor)
        expect(prop('--risu-theme-role-focus-ring')).not.toBe('')
    })

    test('a throw in the trigger computation fails closed under the pack scheme and the paint still runs', async () => {
        const { getDatabase } = await import('../storage/database.svelte')
        vi.mocked(getDatabase).mockImplementationOnce(() => { throw new Error('boom') })
        updateColorScheme()
        expect(ownColours.on).toBe(true)
        expect(console.error).toHaveBeenCalled()
        expect(prop('--risu-theme-bgcolor')).toBe(READABLE.bgcolor)
    })

    test('a throw in the trigger computation is off for a user with no pack', async () => {
        h.db.colorSchemeName = 'ocean'
        const { getDatabase } = await import('../storage/database.svelte')
        vi.mocked(getDatabase).mockImplementationOnce(() => { throw new Error('boom') })
        updateColorScheme()
        expect(ownColours.on).toBe(false)
    })

    test('the island variables are the no-pack scheme with the backdrops opaque, under the painted names', () => {
        packDb(F1)
        h.db.themePackSchemeSnapshot = { name: 'retired-x', scheme: { ...colorSchemePresets.ocean, bgcolor: 'rgb(255 0 0 / 0.5)' } }
        updateColorScheme()
        expect(ownColours.on).toBe(true)
        expect(ownColours.vars['--risu-theme-bgcolor']).toBe('#800000')
        expect(ownColours.vars['--risu-theme-textcolor']).toBe(colorSchemePresets.ocean.textcolor)
        const painted = Object.keys(ownColours.vars).sort()
        expect(painted).toHaveLength(27)
        const style = document.documentElement.style
        const all: string[] = []
        for (let i = 0; i < style.length; i++) {
            if (style[i].startsWith('--risu-theme-')) all.push(style[i])
        }
        expect(painted).toEqual(all.sort())
    })
})

describe('the Settings switch', () => {
    test('with the own colours on, opening Settings paints the no-pack scheme and closing restores the pack', () => {
        packDb(F1)
        h.db.themePackSchemeSnapshot = { name: 'ocean', scheme: structuredClone(colorSchemePresets.ocean) }
        updateColorScheme()
        expect(prop('--risu-theme-textcolor2')).toBe(F1.textcolor2)
        setSettingsOwnColours(true)
        expect(prop('--risu-theme-textcolor2')).toBe(colorSchemePresets.ocean.textcolor2)
        expect(ownColours.on).toBe(true)
        setSettingsOwnColours(false)
        expect(prop('--risu-theme-textcolor2')).toBe(F1.textcolor2)
    })

    test('with the own colours off it paints nothing, open or closed', () => {
        updateColorScheme()
        const spy = vi.spyOn(document.documentElement.style, 'setProperty')
        setSettingsOwnColours(true)
        setSettingsOwnColours(false)
        expect(spy).not.toHaveBeenCalled()
        expect(ownColours.on).toBe(false)
    })

    test('a readable pack with a live provider keeps the pack scheme at the root across a repaint while Settings is open', () => {
        setPackSchemeProvider(() => READABLE)
        updateColorScheme()
        expect(ownColours.on).toBe(false)
        setSettingsOwnColours(true)
        updateColorScheme()
        expect(ownColours.on).toBe(false)
        expect(prop('--risu-theme-textcolor2')).toBe(READABLE.textcolor2)
        setSettingsOwnColours(false)
        expect(prop('--risu-theme-textcolor2')).toBe(READABLE.textcolor2)
    })

    test('a repeated state repaints nothing', () => {
        packDb(F1)
        updateColorScheme()
        setSettingsOwnColours(true)
        const spy = vi.spyOn(document.documentElement.style, 'setProperty')
        setSettingsOwnColours(true)
        expect(spy).not.toHaveBeenCalled()
    })

    test('a trigger that turns on while Settings is open paints the own scheme at once', () => {
        updateColorScheme()
        setSettingsOwnColours(true)
        expect(prop('--risu-theme-textcolor2')).toBe(READABLE.textcolor2)
        packDb(F1)
        h.db.themePackSchemeSnapshot = { name: 'ocean', scheme: structuredClone(colorSchemePresets.ocean) }
        updateColorScheme()
        expect(prop('--risu-theme-textcolor2')).toBe(colorSchemePresets.ocean.textcolor2)
    })

    test('a throw in the repaint is logged and never escapes', () => {
        packDb(F1)
        updateColorScheme()
        const error = new Error('css store failed')
        vi.spyOn(CustomCSSStore, 'set').mockImplementation(() => { throw error })
        expect(() => setSettingsOwnColours(true)).not.toThrow()
        expect(console.error).toHaveBeenCalledWith(error)
        expect(prop('--risu-theme-textcolor2')).toBe(colorSchemePresets.ocean.textcolor2)
    })
})

describe('the verdict carried from the judge', () => {
    const area = judgeAreaSheet('chat', '[data-part="chat-shell"] { color: red }', undefined, 'chat')
    const wire = (rule: unknown) => ({
        ok: true,
        areas: { chat: { ...area, warnings: [{ selector: 's', prop: 'color', why: 'w', rule }] } },
    })

    test('readJudgement keeps a known rule and drops any other', () => {
        for (const rule of ['contrast', 'readability', 'layout'] as const) {
            expect(readJudgement(wire(rule))?.areas.chat?.warnings[0].rule).toBe(rule)
        }
        for (const rule of ['other', 5, null, undefined]) {
            const warning = readJudgement(wire(rule))?.areas.chat?.warnings[0]
            expect(warning).toEqual({ selector: 's', prop: 'color', why: 'w' })
            expect(warning !== undefined && 'rule' in warning).toBe(false)
        }
    })

    test('only contrast and readability trigger; layout and untagged do not', () => {
        expect(triggersOwnColours([{ rule: 'contrast' }])).toBe(true)
        expect(triggersOwnColours([{ rule: 'layout' }, { rule: 'readability' }])).toBe(true)
        expect(triggersOwnColours([{ rule: 'layout' }, {}])).toBe(false)
        expect(triggersOwnColours([])).toBe(false)
    })

    async function applied(trigger: boolean): Promise<void> {
        h.prepared = {
            ok: true, blobs: [], skippedAreas: [], defaultScheme: READABLE, elements: [],
            ...(trigger ? { ownColourTrigger: true } : {}),
        }
        h.db.activeThemePack = 'builtin:banana-cocoa'
        startThemePackApply()
        for (let attempt = 0; attempt < 50; attempt++) {
            flushSync()
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
    }

    test('the driver writes the verdict before its repaint, so the first paint after the commit is on', async () => {
        await applied(true)
        expect(ownColours.verdict).toBe(true)
        expect(ownColours.on).toBe(true)
    })

    test('a prepared outcome with no trigger leaves the own colours off', async () => {
        await applied(false)
        expect(ownColours.verdict).toBe(false)
        expect(ownColours.on).toBe(false)
    })

    test('a broken pack clears the verdict', async () => {
        ownColours.verdict = true
        h.prepared = { ok: false, reason: 'refused' }
        h.db.activeThemePack = 'builtin:banana-cocoa'
        startThemePackApply()
        for (let attempt = 0; attempt < 50; attempt++) {
            flushSync()
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        expect(ownColours.verdict).toBe(false)
        expect(ownColours.on).toBe(false)
    })
})
