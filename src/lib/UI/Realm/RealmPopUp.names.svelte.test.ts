// @vitest-environment jsdom

/**
 * `RealmPopUp.svelte`: every button in the detail dialog is named, its glyphs are hidden, and the
 * tags, the creator link and the danger actions use scheme tokens (the dimmed
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
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
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

// The detail is a dialog: a named close button, the primary import, Copy link, and Report and Block
// inside the More disclosure. Capability marks are text badges, so they are not buttons any more.
describe('RealmPopUp accessible names and colours', () => {
    test('every button carries its meaning as the name and nothing is left unnamed', () => {
        const target = mountPopUp()
        const names = buttons(target).map(controlName)
        for (const name of [
            language.uiCommon.forked,
            language.uiCommon.close,
            language.realmImportAndChat,
            language.realmCopyLink,
            language.realmReport,
            language.blockRealmCreator,
        ]) {
            expect(names).toContain(name)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('the glyphs are hidden', () => {
        expect(exposedIcons(mountPopUp())).toEqual([])
    })

    test('no default-palette class is left beyond the scrim', () => {
        expect(paletteClasses(mountPopUp(), { allow: SCRIM })).toEqual([])
        expect(paletteClasses(mountPopUp({ creator: undefined, original: undefined, hasLore: false, hasAsset: false, hasEmotion: false }), { allow: SCRIM })).toEqual([])
    })

    test('Report and Block are the danger actions, in draculared', () => {
        const target = mountPopUp()
        for (const name of [language.realmReport, language.blockRealmCreator]) {
            const button = buttons(target).find((b) => controlName(b) === name)!
            expect(button.classList.contains('text-draculared')).toBe(true)
        }
    })
})
