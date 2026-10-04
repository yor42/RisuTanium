// @vitest-environment happy-dom

/**
 * `PlaygroundTranslation.svelte` (the Playground's translation tool): the
 * output is in the "Translator Language" and is translated from the text in the
 * "Source Language" box, for a single run and for each chunk of a bulk run.
 *
 * Mounts the REAL component; `runTranslator` is a recording stub that returns
 * its text, so a passing test says nothing about a real translation backend.
 * The direction is read from the call: `runTranslator(text, reverse, from, to)`
 * with `reverse` true takes `from` as the language of the text and `to` as the
 * language wanted, as `tts.ts` and the Japanese-translation caller use it.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const translatorBox = vi.hoisted(() => ({
    runTranslator: vi.fn(async (text: string, _reverse: boolean, _from: string, _to: string, _options?: unknown): Promise<string> => text),
}))

vi.mock(import('src/ts/translator/translator'), () => ({
    runTranslator: translatorBox.runTranslator,
    LLMCacheStorage: { clear: vi.fn() },
}) as unknown as typeof import('src/ts/translator/translator'))

// The text area is a plain `<textarea>` that writes its text back to the bound `value`.
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({
    default: (anchor: Comment, props: { value: string }) => {
        const area = document.createElement('textarea')
        anchor.before(area)
        area.addEventListener('input', () => { props.value = area.value })
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getLanguageCodes: () => [
        { code: 'en', name: 'English' },
        { code: 'ja', name: 'Japanese' },
        { code: 'ko', name: 'Korean' },
    ],
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenize: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/tokenizer'))

//#endregion

import PlaygroundTranslation from './PlaygroundTranslation.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof mount> }> = []

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ target, app: mount(PlaygroundTranslation, { target, props: {} }) })
    flushSync()
    return target
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    const option = Array.from(select.options).find((o) => o.value === value)
    if (!option) throw new Error('language not offered: ' + value)
    option.selected = true
    // happy-dom does not match `:checked` on an option, which Svelte's select binding
    // queries to read the choice; answer that one query from the selected index.
    const query = select.querySelector.bind(select)
    select.querySelector = ((selector: string) =>
        selector === ':checked' ? select.options[select.selectedIndex] : query(selector)) as typeof select.querySelector
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
}

async function typeInto(area: HTMLTextAreaElement, value: string): Promise<void> {
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
}

/** Source "ja", output "ko", the given text, optionally the bulk box ticked. */
async function prepare(text: string, bulk: boolean): Promise<HTMLElement> {
    const target = mountPage()
    const [source, output] = Array.from(target.querySelectorAll('select'))
    await choose(source, 'ja')
    await choose(output, 'ko')
    await typeInto(target.querySelector('textarea') as HTMLTextAreaElement, text)
    if (bulk) {
        const box = target.querySelector('input[type="checkbox"]') as HTMLInputElement
        box.click()
        await settle()
    }
    return target
}

async function clickTranslate(target: HTMLElement): Promise<void> {
    const buttons = Array.from(target.querySelectorAll('button'))
    // The first button is Translate, the second clears the cache.
    buttons[0].click()
    await settle()
}

beforeEach(() => {
    translatorBox.runTranslator.mockClear()
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app).catch(() => {})
        target.remove()
    }
})

describe('the Playground translator direction', () => {
    test('regression reproducer: a single run translates from the source language into the translator language', async () => {
        const target = await prepare('konnichiwa', false)

        await clickTranslate(target)

        expect(translatorBox.runTranslator).toHaveBeenCalledTimes(1)
        const [text, reverse, from, to] = translatorBox.runTranslator.mock.calls[0]
        expect([text, reverse, from, to]).toEqual(['konnichiwa', true, 'ja', 'ko'])
    })

    test('regression reproducer: every chunk of a bulk run translates from the source language into the translator language', async () => {
        const target = await prepare('one\n\ntwo', true)

        await clickTranslate(target)

        expect(translatorBox.runTranslator).toHaveBeenCalledTimes(2)
        for (const call of translatorBox.runTranslator.mock.calls) {
            expect([call[1], call[2], call[3]]).toEqual([true, 'ja', 'ko'])
        }
        expect(translatorBox.runTranslator.mock.calls.map((call) => call[0])).toEqual(['one', 'two'])
    })
})
