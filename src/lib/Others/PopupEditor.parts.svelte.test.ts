// @vitest-environment jsdom

/**
 * `PopupEditor.svelte` carries the overlay vocabulary on its real elements (W1-T7a): the backdrop root names the overlay, the frame, header,
 * title and controls nest inside it, the X is `modal-close` and still closes the editor. Mocks are those of `PopupEditor.valueNames.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
import { popUpEditorStore } from '../../ts/stores.svelte'
import PopupEditor from './PopupEditor.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountEditor(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PopupEditor, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    popUpEditorStore.open = true
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('PopupEditor overlay parts', () => {
    test('the backdrop is the identity root and holds the frame, header, title and controls', () => {
        const target = mountEditor()
        const rootEl = target.firstElementChild as HTMLElement
        expect(rootEl.getAttribute('data-part')).toBe('modal-popup-editor')
        const frame = rootEl.querySelector(':scope > [data-part="modal-frame"]')
        expect(frame).not.toBeNull()
        const header = frame!.querySelector(':scope > [data-part="modal-header"]')
        expect(header).not.toBeNull()
        const title = header!.querySelector(':scope > [data-part="modal-title"]')
        expect(title?.tagName).toBe('H2')
        expect(title?.textContent).toBe(language.othersUi.popupEditor)
        expect(header!.querySelector(':scope > [data-part="modal-controls"]')).not.toBeNull()
        expect(frame!.querySelector(':scope > [data-part="modal-body"]')).not.toBeNull()
    })

    test('the language select, the preview button and the X carry their names, and the X still closes the editor', () => {
        const target = mountEditor()
        expect(target.querySelector('[data-part="modal-field"]')?.tagName).toBe('SELECT')
        expect(target.querySelector('[data-part="modal-action"]')?.tagName).toBe('BUTTON')
        const close = target.querySelector('[data-part="modal-close"]') as HTMLButtonElement
        expect(close.tagName).toBe('BUTTON')
        expect(close.textContent?.trim()).toBe('X')
        close.click()
        expect(popUpEditorStore.open).toBe(false)
    })

    test('previewing shows the text box and the footer row under the body', () => {
        const target = mountEditor()
        ;(target.querySelector('[data-part="modal-action"]') as HTMLButtonElement).click()
        flushSync()
        const body = target.querySelector('[data-part="modal-body"]') as HTMLElement
        expect(body.querySelector('[data-part="modal-text"]')).not.toBeNull()
        expect(body.querySelector('[data-part="modal-footer"]')).not.toBeNull()
    })
})
