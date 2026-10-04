// @vitest-environment happy-dom

/**
 * `RegexData.svelte` labels its flag buttons, field captions and accordion heading in the UI
 * language, read when the component initialises. The language is set before mount and
 * restored to English afterwards. A flag button stores the same English flag token
 * (`g`, `<move_top>`, ...) in `value.flag` whatever its label says.
 *
 * Mounts the REAL component over a `$state` script. MOCKED: the alert module (the remove
 * confirm is never reached), the highlighter and hotkey modules the output textarea imports and the stores module reduced to the stores these inputs read.
 *
 * Tests whose title starts with `guard:` pass with or without the translation work.
 * Tests starting `regression reproducer:` fail while a label is a hard-coded English literal.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { customscript } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    ReloadGUIPointer: writable(0),
    disableHighlight: writable(true),
    popUpEditorStore: writable(null),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/gui/highlight'), () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 0),
    removeHighlight: vi.fn(),
    AllCBS: [],
}) as unknown as typeof import('src/ts/gui/highlight'))

vi.mock(import('src/ts/hotkey'), () => ({
    hotkeyMatches: vi.fn(() => false),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/alert'))

import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import RegexData from './RegexData.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountOpenedScript(): { target: HTMLElement, script: customscript } {
    const script = $state<customscript>({
        comment: '',
        in: '',
        out: '',
        type: 'editoutput',
        flag: 'g',
        ableFlag: true,
    })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(RegexData, { target, props: { value: script, idx: 0 } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, script }
}

/** The button showing the first of 	exts that is on screen: the translated label, else the English literal. */
function buttonWithText(target: HTMLElement, ...texts: string[]): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => texts.includes(b.textContent?.trim() ?? ''))
    if (!found) throw new Error('no button with text: ' + texts.join(' / '))
    return found
}

function openFlags(target: HTMLElement, ...heading: string[]): void {
    ;(target.querySelector('button.endflex') as HTMLButtonElement).click()
    flushSync()
    buttonWithText(target, ...heading).click()
    flushSync()
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('RegexData flag labels', () => {
    test('regression reproducer: Korean shows the unnamed-script fallback, captions and flag labels in Korean', () => {
        changeLanguage('ko')
        const ko = languageKorean.sidebarUi
        const { target } = mountOpenedScript()
        expect(target.textContent).toContain(ko.unnamedScript)
        expect(target.textContent).not.toContain('Unnamed Script')

        openFlags(target, ko.flagsHeading)
        const text = target.textContent ?? ''
        for (const [translated, english] of [
            [ko.modificationType, 'Modification Type'],
            [ko.normalFlag, 'Normal Flag'],
            [ko.orderFlag, 'Order Flag'],
            [ko.customFlag, 'Custom Flag'],
            [ko.flagGlobal, 'Global (g)'],
            [ko.flagCaseInsensitive, 'Case Insensitive (i)'],
            [ko.flagMoveTop, 'Move Top'],
            [ko.flagNoNewlineSubfix, 'No Newline Subfix'],
        ]) {
            expect(translated).not.toBe(english)
            expect(text).toContain(translated)
            expect(text).not.toContain(english)
        }
        expect(text).not.toContain('FLAGS')
    })

    test('guard: clicking a Korean-labelled flag button stores the English flag token', () => {
        changeLanguage('ko')
        const ko = languageKorean.sidebarUi
        const { target, script } = mountOpenedScript()
        openFlags(target, ko.flagsHeading, 'FLAGS')

        buttonWithText(target, ko.flagMoveTop, 'Move Top').click()
        flushSync()
        expect(script.flag).toBe('g<move_top>')

        buttonWithText(target, ko.flagCaseInsensitive, 'Case Insensitive (i)').click()
        flushSync()
        expect(script.flag).toBe('g<move_top>i')

        buttonWithText(target, ko.flagGlobal, 'Global (g)').click()
        flushSync()
        expect(script.flag).toBe('<move_top>i')
    })

    test('guard: English shows the English labels and stores the same flag token', () => {
        const { target, script } = mountOpenedScript()
        expect(target.textContent).toContain('Unnamed Script')
        openFlags(target, 'FLAGS')
        expect(target.textContent).toContain(languageEnglish.sidebarUi.flagMoveTop)

        buttonWithText(target, 'Move Top').click()
        flushSync()
        expect(script.flag).toBe('g<move_top>')
    })
})
