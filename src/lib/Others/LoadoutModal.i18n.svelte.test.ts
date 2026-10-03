// @vitest-environment happy-dom

/**
 * `LoadoutModal.svelte` labels its "Load:" option buttons, headings and saved-loadout card
 * in the UI language, read when the component initialises. The language is set before mount
 * and restored to English afterwards. The option buttons toggle and apply the same English
 * keys (modules, globalVariables, preset, persona) in every language.
 *
 * Mounts the REAL component over a `$state` stand-in for `DBState`. MOCKED: `applyLoadout`
 * (a spy, so nothing is applied) and `getCurrentCharacter`.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work.
 * Tests starting `regression reproducer:` fail while a label is a hard-coded English literal.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const spies = vi.hoisted(() => ({ applyLoadout: vi.fn() }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        loadoutModalStore: { open: true },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/loadout'), () => ({
    applyLoadout: spies.applyLoadout,
    saveCurrentLoadout: vi.fn(),
}) as unknown as typeof import('src/ts/loadout'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import LoadoutModal from './LoadoutModal.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountModal(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(LoadoutModal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const buttonTexts = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())

function buttonWithText(target: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
    if (!found) throw new Error('no button with text: ' + text)
    return found
}

beforeEach(() => {
    spies.applyLoadout.mockReset()
    DBState.db = {
        loadoutApplyOptions: { modules: true, globalVariables: true, preset: true, persona: true },
        loadouts: [
            { id: 'l1', name: 'My loadout', presetName: 'Preset A', lastUsed: 1, favorite: false },
        ],
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('LoadoutModal option labels', () => {
    test('regression reproducer: Korean shows the Load option labels and headings in Korean', () => {
        changeLanguage('ko')
        const ko = languageKorean
        expect(ko.loadoutModal.globalVariables).not.toBe(languageEnglish.loadoutModal.globalVariables)
        expect(ko.loadoutModal.preset).not.toBe(languageEnglish.loadoutModal.preset)

        const target = mountModal()
        const texts = buttonTexts(target)
        for (const label of [ko.modules, ko.loadoutModal.globalVariables, ko.loadoutModal.preset, ko.persona]) {
            expect(texts).toContain(label)
        }
        for (const english of ['Global Variables', 'Preset']) {
            expect(texts).not.toContain(english)
        }

        const text = target.textContent ?? ''
        expect(text).toContain(ko.loadoutModal.selectLoadout)
        expect(text).toContain(ko.loadoutModal.loadLabel)
        expect(text).toContain(ko.loadoutModal.allLoadouts)
        expect(text).toContain(ko.loadoutModal.presetLabel)
        expect(text).toContain(ko.uiCommon.save)
        for (const english of ['Select Loadout', 'Load:', 'All Loadouts', 'Preset:']) {
            expect(text).not.toContain(english)
        }
    })

    test('guard: Korean option buttons toggle and apply the English option keys', () => {
        changeLanguage('ko')
        const target = mountModal()

        // The option button is found by its translated label, else by the English literal.
        const presetButton = buttonTexts(target).includes(languageKorean.loadoutModal.preset) ? languageKorean.loadoutModal.preset : 'Preset'
        buttonWithText(target, presetButton).click()
        flushSync()
        expect(DBState.db.loadoutApplyOptions).toEqual({
            modules: true,
            globalVariables: true,
            preset: false,
            persona: true,
        })

        ;(target.querySelector('button.flex-1') as HTMLButtonElement).click()
        expect(spies.applyLoadout).toHaveBeenCalledTimes(1)
        expect(spies.applyLoadout.mock.calls[0][1]).toEqual(['modules', 'globalVariables', 'persona'])
    })

    test('guard: English shows the English option labels', () => {
        const target = mountModal()
        const texts = buttonTexts(target)
        for (const label of ['Modules', 'Global Variables', 'Preset', 'Persona']) {
            expect(texts).toContain(label)
        }
        expect(target.textContent).toContain('Select Loadout')
        expect(target.textContent).toContain('Load:')
    })
})
