// @vitest-environment jsdom

/**
 * `PlaygroundTokenizer.svelte` value controls: the tokenizer select is named by its visible tokenizer label
 * text through `aria-labelledby`, with that label first in `aria-describedby`. Mounts the REAL page with the
 * real shared inputs; the tokenizer module is a stub with a fixed list.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/tokenizer'), () => ({
    encodeWithTokenizer: vi.fn(async () => []),
    tokenizerList: [['tik', 'tiktoken'], ['llama', 'Llama']],
}) as unknown as typeof import('src/ts/tokenizer'))

// The text areas are named by their own labelId in the shared input's file; the real one pulls in the
// highlighter and the whole store graph, which this page's select names do not need.
vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PlaygroundTokenizer from './PlaygroundTokenizer.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PlaygroundTokenizer value control names', () => {
    test('the tokenizer select is named by its visible label and no field is unnamed', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(PlaygroundTokenizer, { target, props: {} }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        expect(fieldNameProblems(target, [{ name: language.tokenizer }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual([])
        expect(target.querySelectorAll('span.sr-only').length).toBe(0)
    })
})
