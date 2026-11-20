// @vitest-environment jsdom

/**
 * The selected primary Button paints the scheme's `selected` fill, and its text is the derived
 * on-selected role: the scheme text colour where that reaches 4.5:1 on the fill, otherwise black or
 * white. The fixtures are the real producers: the real Button mounted from source, the Tailwind
 * output of `src/styles.css` compiled for it, and the real `updateColorScheme` over every preset,
 * all resolved per element by the cascade model.
 *
 * T1 and T4 are regression reproducers (the fill was a class that emits no rule; the text was the
 * scheme text colour whatever the fill). T2 is a compatibility guard that passes before and after.
 *
 * MOCKED: alert, database, globalApi, util, stores, the system bars and the app store. Hover is not
 * extended by the on-selected rule and is not observable here.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { cr, parseConcrete } from 'src/ts/themePack/colour'
import {
    CascadeModel, classCandidates, compileAppStyles, compileRules, normaliseColours, readRepoFile,
    type ModelSheet, type RuleSet,
} from 'src/styles/tests/cascadeModel'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
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
    getFileSrc: vi.fn(async () => ''),
    readImage: vi.fn(),
    fetchNative: vi.fn(),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    aiLawApplies: vi.fn(() => false),
    aiWatermarkingLawApplies: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({} as Record<number, number>),
    CurrentTriggerIdStore: writable(null),
    HideIconStore: writable(false),
    createSimpleCharacter: vi.fn(() => null),
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { colorSchemeList, colorSchemePresets, updateColorScheme } from 'src/ts/gui/colorscheme'
import Button from './Button.svelte'

let tailwind: ModelSheet
let rules: RuleSet
const buttons = new Map<string, HTMLElement>()
const instances: unknown[] = []

function mountButton(label: string, props: Record<string, unknown>): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    instances.push(mount(Button, { target, props }))
    flushSync()
    const el = target.querySelector<HTMLElement>('button')
    if (el === null) throw new Error(`no button for ${label}`)
    buttons.set(label, el)
}

beforeAll(async () => {
    tailwind = await compileAppStyles(classCandidates(readRepoFile('src/lib/UI/GUI/Button.svelte')))
    rules = compileRules([tailwind])
    mountButton('selected primary', { styled: 'primary', selected: true })
    mountButton('unselected primary', { styled: 'primary', selected: false })
    mountButton('outlined', { styled: 'outlined' })
    mountButton('selected danger', { styled: 'danger', selected: true })
}, 120000)

afterAll(async () => {
    for (const instance of instances.splice(0)) await unmount(instance as never).catch(() => {})
})

function applyScheme(name: string): void {
    h.db.colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

const hexOf = (value: string | undefined): string => normaliseColours(value ?? '', '#000000ff')
const painted = (label: string): Record<string, string> => new CascadeModel(rules, {}).painted(buttons.get(label)!)
const rgb = (hex8: string) => parseConcrete(hex8.slice(0, 7))!

describe('T1: the selected primary Button paints the scheme selected fill', () => {
    test('the compiled sheet is live: the fill utility and the on-selected rule exist', () => {
        expect(tailwind.css).toContain('.bg-selected')
        expect(tailwind.css).toContain('.risu-on-selected')
    })

    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        expect(hexOf(painted('selected primary')['background-color'])).toBe(hexOf(colorSchemePresets[name].selected))
    })
})

describe('T4: the selected primary text reads at 4.5:1 or more on its painted fill', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const p = painted('selected primary')
        const fill = hexOf(p['background-color'])
        const text = hexOf(p['color'])
        expect(cr(rgb(text), rgb(fill)), `${name} text ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5)
    })

    test.each(colorSchemeList)('%s: the text is the scheme text colour wherever that already reaches 4.5:1', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        const tx = hexOf(scheme.textcolor)
        const fill = hexOf(scheme.selected)
        if (cr(rgb(tx), rgb(fill)) < 4.5) return
        expect(hexOf(painted('selected primary')['color'])).toBe(tx)
    })
})

describe('T2: the other variants keep their fill and text (compatibility guard)', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        const unselected = painted('unselected primary')
        expect(hexOf(unselected['background-color'])).toBe(hexOf(scheme.darkbutton))
        expect(hexOf(unselected['color'])).toBe(hexOf(scheme.textcolor))
        const outlined = painted('outlined')
        expect([undefined, 'transparent']).toContain(outlined['background-color'])
        expect(hexOf(outlined['color'])).toBe(hexOf(scheme.textcolor2))
        expect(buttons.get('selected danger')!.classList.contains('bg-red-800')).toBe(true)
        expect(buttons.get('selected danger')!.classList.contains('risu-on-selected')).toBe(false)
    })
})
