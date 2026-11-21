// @vitest-environment jsdom

/**
 * `PlaygroundImageTrans.svelte` value controls: the mode select has no visible text of its own and takes a
 * screen-reader-only name ("Mode", its own key); the
 * font-size number input is named by its visible label span. Mounts the REAL page with the real shared
 * inputs; request, util and alert modules are stubs.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

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

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

// The text areas are named by their own labelId in the shared input's file; the real one pulls in the
// highlighter and the whole store graph, which this page's select names do not need.
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundImageTrans, { target, props: {} }) as unknown as Record<string, unknown>
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

describe('PlaygroundImageTrans value control names', () => {
    const TABLE = [{ name: language.playground.imageTranslationMode }, { name: language.fontSize }]

    test('auto mode: the mode select and the font-size input are named', () => {
        const target = mountPage()
        expect(fieldNameProblems(target, TABLE)).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('manual mode: the names are unchanged with the image button rendered', () => {
        const target = mountPage()
        const select = target.querySelector('select') as HTMLSelectElement
        select.value = 'manual'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(Array.from(target.querySelectorAll('button')).some((b) => b.textContent?.trim() === language.image)).toBe(true)
        expect(fieldNameProblems(target, TABLE)).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
    })

    test('only the mode select uses a screen-reader-only name span', () => {
        const target = mountPage()
        expect(Array.from(target.querySelectorAll('span.sr-only[id]')).map((s) => s.textContent?.trim())).toEqual([language.playground.imageTranslationMode])
    })
})
