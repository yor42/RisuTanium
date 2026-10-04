// @vitest-environment happy-dom

/**
 * `PlaygroundImageTrans.svelte` labels its font-size field in the active UI language.
 *
 * Mounts the REAL `PlaygroundImageTrans.svelte`. The request, util and alert modules are
 * mocks, so nothing leaves the test. Titles beginning "regression reproducer:" fail against
 * the version that shows the fixed identifier "fontSize".
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, afterEach } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/util'), () => ({
    jsonOutputTrimmer: vi.fn((s: string) => s),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

//#endregion

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function labels(): string[] {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundImageTrans, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return Array.from(target.querySelectorAll('span.text-lg')).map((s) => s.textContent?.trim() ?? '')
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('the font-size label of the image translation page', () => {
    test('regression reproducer: English labels the field "Font Size"', () => {
        const texts = labels()
        expect(texts).toContain('Font Size')
        expect(texts).not.toContain('fontSize')
    })

    test('compatibility guard: the neighbouring font label stays "Font"', () => {
        expect(labels()).toContain('Font')
    })

    test('regression reproducer: Korean labels the field with the Korean locale value', () => {
        changeLanguage('ko')
        expect(languageKorean.fontSize).not.toBe(languageEnglish.fontSize)
        expect(labels()).toContain(languageKorean.fontSize)
    })
})
