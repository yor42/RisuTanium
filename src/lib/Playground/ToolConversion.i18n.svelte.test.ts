// @vitest-environment happy-dom

/**
 * `ToolConversion.svelte` marks a file of an unsupported type with a red badge worded in the
 * active UI language, while a supported file keeps a badge with its own type code.
 *
 * Mounts the REAL `ToolConversion.svelte`. The file picker, the prompt module and the alert
 * module are mocks. Titles beginning "regression reproducer:" fail against the version that
 * prints the internal sentinel "NOTSUPPORTED" in the badge.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//#region module mocks

const mocks = vi.hoisted(() => ({ selectMultipleFile: vi.fn() }))

vi.mock(import('src/ts/util'), () => ({
    selectMultipleFile: mocks.selectMultipleFile,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/prompt'), () => ({
    detectPromptJSONType: (text: string) => text.startsWith('supported') ? 'STINST' : 'NOTSUPPORTED',
    promptConvertion: vi.fn(),
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import ToolConversion from './ToolConversion.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Mounts the page, adds one file per entry and returns the badge texts, red and blue separately. */
async function badges(...entries: Array<[string, string]>): Promise<{ red: string[], blue: string[] }> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ToolConversion, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    mocks.selectMultipleFile.mockResolvedValueOnce(
        entries.map(([name, text]) => ({ name, data: new TextEncoder().encode(text) })),
    )
    // The first button of the page is "Add", whose text follows the language.
    target.querySelector('button')!.click()
    await sleep(20)
    flushSync()
    const texts = (cls: string) => Array.from(target.querySelectorAll(`span.${cls}`)).map((s) => s.textContent?.trim() ?? '')
    return { red: texts('bg-red-500'), blue: texts('bg-blue-500') }
}

beforeEach(() => mocks.selectMultipleFile.mockReset())

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('the type badge of a listed prompt file', () => {
    test('regression reproducer: English words the unsupported badge "Not supported"', async () => {
        expect(await badges(['bad.json', 'nope'])).toEqual({ red: ['Not supported'], blue: [] })
        expect(languageEnglish.playground.notSupported).toBe('Not supported')
    })

    test('compatibility guard: a supported file shows its type code in the blue badge and no red badge', async () => {
        expect(await badges(['good.json', 'supported-good'])).toEqual({ red: [], blue: ['STINST'] })
    })

    test('regression reproducer: Korean words the unsupported badge with the Korean locale value', async () => {
        changeLanguage('ko')
        expect(languageKorean.playground.notSupported).not.toBe(languageEnglish.playground.notSupported)
        expect(await badges(['bad.json', 'nope'], ['good.json', 'supported-good'])).toEqual({
            red: [languageKorean.playground.notSupported],
            blue: ['STINST'],
        })
    })
})
