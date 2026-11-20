// @vitest-environment jsdom

/**
 * `PopupEditor.svelte`: the editor-language select has no visible label, so an sr-only span holding the existing
 * `language.language` text names it. REAL: the editor, the language table and the checker. MOCKED: the stores module, the
 * parser, the tokenizer, the toggle sidebar and the Monaco editor, none of which this test reaches.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', () => ({
    DBState: { db: { globalChatVariables: {} } },
    popUpEditorStore: { open: true, value: '', mode: 'default', language: 'markdown' },
}))
vi.mock('src/ts/parser/parser.svelte', () => ({ ParseMarkdown: vi.fn(), risuChatParser: vi.fn(() => '') }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: vi.fn(async () => 0) }))
vi.mock('src/ts/storage/database.svelte', () => ({ getCurrentCharacter: vi.fn() }))
vi.mock('../SideBars/Toggles.svelte', () => ({ default: () => {} }))
vi.mock('./MonacoEditor.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from '../a11yNames.test-helpers'
import PopupEditor from './PopupEditor.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const KNOWN_UNNAMED: string[] = []

describe('PopupEditor value-control names', () => {
    test('regression reproducer: the editor-language select is named by the language label', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(PopupEditor, { target, props: {} }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        expect(fieldNameProblems(target, [{ name: language.language }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
