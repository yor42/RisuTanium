// @vitest-environment jsdom

/**
 * `PlaygroundTranslation.svelte` value controls: the source and target language selects each carry a
 * screen-reader-only name span with the visible label's text, because the visible label text element is
 * already the name of the text area beside it and two controls never share a naming element. The bulk and
 * keep-context checkboxes are named by their own `label`. Mounts the REAL page with the real shared inputs;
 * the translator, tokenizer and module helpers are stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    state: { db: { modules: [], enabledModules: [], characters: [], personas: [], moduleIntergration: '', translatorType: 'google' } },
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: h.state,
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
}))
vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => h.state.db,
    getCurrentCharacter: () => null,
    getCurrentChat: () => null,
}))
vi.mock('src/ts/util', () => ({
    checkPersonaBinded: () => false,
}))
vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
}))
vi.mock('src/ts/translator/translator', () => ({
    runTranslator: vi.fn(async (text: string) => text),
    LLMCacheStorage: { clear: vi.fn() },
}))
vi.mock('src/ts/globalApi.svelte', () => ({
    getLanguageCodes: () => [{ code: 'en', name: 'English' }, { code: 'ko', name: 'Korean' }],
}))
vi.mock('src/ts/tokenizer', () => ({
    tokenize: async () => 0,
}))

// The text areas are named by their own labelId in the shared input's file; the real one pulls in the
// highlighter and the whole store graph, which this page's select names do not need.
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PlaygroundTranslation from './PlaygroundTranslation.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundTranslation, { target, props: {} }) as unknown as Record<string, unknown>
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

describe('PlaygroundTranslation value control names', () => {
    const TABLE = [{ name: language.sourceLanguage }, { name: language.translatorLanguage }]

    test('both language selects are named; the bulk-off branch has no keep-context checkbox', () => {
        const target = mountPage()
        expect(fieldNameProblems(target, TABLE)).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('the bulk-on branch keeps both selects named and names the keep-context checkbox', () => {
        const target = mountPage()
        const bulk = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))[0]
        bulk.click()
        flushSync()
        expect(target.querySelectorAll('input[type="checkbox"]').length).toBe(2)
        expect(fieldNameProblems(target, TABLE)).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('each select name is a screen-reader-only span with a distinct id', () => {
        const target = mountPage()
        const spans = Array.from(target.querySelectorAll('span.sr-only[id]'))
        expect(spans.map((s) => s.textContent?.trim())).toEqual([language.sourceLanguage, language.translatorLanguage])
        expect(new Set(spans.map((s) => s.id)).size).toBe(2)
    })
})
