// @vitest-environment jsdom

/**
 * `RealmPopUp.svelte`: the capability, block, report and copy-link icon buttons are named, their
 * glyphs are hidden, and the tags, the creator link and the hovers use scheme tokens (the dimmed
 * scrim `bg-black/50` stays, E2). Mounts the REAL component; mocks follow `RealmPopUp.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { hubType } from 'src/ts/characterCards'

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertInput: vi.fn(async () => 'a report'),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    downloadRisuHub: vi.fn(),
    getRealmInfo: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { hideAllImages: false } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, textColourTokens, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import RealmPopUp from './RealmPopUp.svelte'

const SCRIM = [/^bg-black\/50$/]

function makeChara(over: Partial<hubType> = {}): hubType {
    return {
        name: 'chara',
        desc: '',
        download: '',
        id: 'chara-id',
        img: '',
        tags: ['alpha', 'beta'],
        viewScreen: 'none',
        hasLore: true,
        hasEmotion: true,
        hasAsset: true,
        hot: 0,
        license: '',
        type: 'character',
        creator: 'creator-id',
        original: 'orig-id',
        authorname: 'Author',
        ...over,
    } as hubType
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPopUp(over: Partial<hubType> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(RealmPopUp, { target, props: { openedData: makeChara(over) } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const buttons = (target: HTMLElement) => Array.from(target.querySelectorAll('button')) as HTMLButtonElement[]

describe('RealmPopUp accessible names and colours', () => {
    test('regression reproducer: the icon buttons carry their meaning as the name', () => {
        const target = mountPopUp()
        // The second button is MultiLangDisplay's own language switch, named by its text and not part of this component.
        const names = buttons(target).map(controlName).filter((_, index) => index !== 1)
        expect(names).toEqual([
            language.uiCommon.forked,
            language.alerts.characterHasEmotion,
            language.alerts.characterHasAssets,
            language.alerts.characterHasLore,
            language.blockRealmCreator,
            language.realmReport,
            language.realmCopyLink,
            language.Chat,
        ])
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('regression reproducer: the glyphs are hidden', () => {
        expect(exposedIcons(mountPopUp())).toEqual([])
    })

    test('regression reproducer: no default-palette class is left beyond the scrim', () => {
        expect(paletteClasses(mountPopUp(), { allow: SCRIM })).toEqual([])
        expect(paletteClasses(mountPopUp({ creator: undefined, original: undefined, hasLore: false, hasAsset: false, hasEmotion: false }), { allow: SCRIM })).toEqual([])
    })

    test('regression reproducer: every icon button hovers to a token different from its rest, danger ones to draculared', () => {
        const target = mountPopUp()
        const all = buttons(target).filter((b) => b.querySelector('svg') !== null)
        const neutral = [all[0], all[1], all[2], all[5]]
        const danger = [all[3], all[4]]
        for (const button of neutral) {
            const { rest, hover } = textColourTokens(button.querySelector('svg')!.parentElement!)
            expect(rest).toBe('textcolor2')
            expect(hover).toBe('textcolor')
        }
        for (const button of danger) {
            const { rest, hover } = textColourTokens(button.querySelector('svg')!.parentElement!)
            expect(rest).toBe('textcolor2')
            expect(hover).toBe('draculared')
        }
    })
})
