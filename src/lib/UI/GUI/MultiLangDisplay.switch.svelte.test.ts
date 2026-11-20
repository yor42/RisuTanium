// @vitest-environment jsdom

/**
 * `MultiLangDisplay.svelte` shows its language switch only when it offers a real choice (MC-2809):
 * a lone untagged text, one language, or the untagged text beside one language shows that text with
 * no buttons; two or more languages keep the switch, with the user's language first and selected.
 * The parser is replaced by a JSON stand-in so each case names its language map directly; the real
 * parser always adds an 'xx' entry, which the fixtures mirror.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const db = vi.hoisted(() => ({ language: 'en' }))

vi.mock('src/ts/gui/colorscheme', async () => {
    const { ColorSchemeTypeStore } = await import('src/ts/gui/surfaceTone')
    return { ColorSchemeTypeStore }
})
vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: async (text: string) => `<p>${text}</p>`,
}))
vi.mock('src/ts/util', () => ({
    parseMultilangString: (value: string) => JSON.parse(value) as Record<string, string>,
    toLangName: (code: string) => `name:${code}`,
}))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db },
}))

import MultiLangDisplay from './MultiLangDisplay.svelte'

let app: ReturnType<typeof MultiLangDisplay> | undefined

async function show(langs: Record<string, string>): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(MultiLangDisplay, { target, props: { value: JSON.stringify(langs) } })
    flushSync()
    await tick()
    return target
}

const switchLabels = (target: HTMLElement) => Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())
const bodyText = (target: HTMLElement) => target.querySelector('.chattext')?.textContent?.trim()

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
    db.language = 'en'
})

describe('MultiLangDisplay language switch', () => {
    test('a lone untagged text shows with no switch', async () => {
        const target = await show({ xx: 'only text' })
        expect(switchLabels(target)).toEqual([])
        expect(bodyText(target)).toBe('only text')
    })

    test('one language beside the untagged remainder shows that language with no switch', async () => {
        const target = await show({ en: 'english text', xx: '' })
        expect(switchLabels(target)).toEqual([])
        expect(bodyText(target)).toBe('english text')
    })

    test('a single language that is neither the user language nor English is still the one shown', async () => {
        const target = await show({ ja: 'japanese text', xx: '' })
        expect(switchLabels(target)).toEqual([])
        expect(bodyText(target)).toBe('japanese text')
    })

    test('two languages keep the switch, and the untagged remainder gets no button', async () => {
        const target = await show({ en: 'english text', ko: 'korean text', xx: '' })
        expect(switchLabels(target)).toEqual(['name:en', 'name:ko'])
        expect(bodyText(target)).toBe('english text')
    })

    test('the user language comes first and is selected when present', async () => {
        db.language = 'ko'
        const target = await show({ en: 'english text', ko: 'korean text', xx: '' })
        expect(switchLabels(target)).toEqual(['name:ko', 'name:en'])
        expect(bodyText(target)).toBe('korean text')
        ;(target.querySelectorAll('button')[1] as HTMLButtonElement).click()
        flushSync()
        expect(bodyText(target)).toBe('english text')
    })
})
