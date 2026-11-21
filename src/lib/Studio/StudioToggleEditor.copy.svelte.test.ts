// @vitest-environment jsdom
/**
 * `StudioToggleEditor.svelte`: the copy-snippet button copies the toggle variable through the shared copy helper, so it
 * works on a page without the clipboard API, and it shows the copied indicator only when something was copied. REAL: the
 * editor over a real toggle builder and the language table. MOCKED: the clipboard API and `document.execCommand`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        frozenSaveKeysStore: writable([]),
    }
})

import { language } from 'src/lang'
import type { ToggleTextPort } from 'src/ts/studio/edit/toggleTextPort'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createToggleBuilder } from 'src/ts/studio/toggleBuilder.svelte'
import StudioToggleEditor from './StudioToggleEditor.svelte'

let mounted: Array<{ app: ReturnType<typeof mount>, host: HTMLElement }> = []
let copied: string[] = []

function show(): HTMLElement {
    const port: ToggleTextPort = {
        owner: characterOwnerKey('A'),
        begin() {},
        read: () => 'k=Label\n',
        view: () => ({ editable: true, banner: null, restricted: false }),
        write: () => ({ ok: true }),
        closeOpenStep() {},
    }
    const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'x', appKeys: new Set<string>() })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const id = builder.def.lines[0].id
    mounted.push({ app: mount(StudioToggleEditor, { target: host, props: { builder, editable: true, id, actions: { changeKind() {}, remove() {}, closeStep() {} } } }), host })
    flushSync()
    return host
}

function copyButton(host: HTMLElement): HTMLButtonElement {
    const button = host.querySelector<HTMLButtonElement>('[data-part="studio-toggle-copy"]')
    if (!button) {
        throw new Error('copy button not found')
    }
    return button
}

function stubExecCommand(result: boolean): void {
    Object.defineProperty(document, 'execCommand', {
        value: vi.fn(() => {
            copied.push(document.querySelector('textarea')?.value ?? '')
            return result
        }),
        configurable: true,
    })
}

beforeEach(() => {
    copied = []
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

afterEach(async () => {
    for (const entry of mounted) {
        await unmount(entry.app)
        entry.host.remove()
    }
    mounted = []
    Reflect.deleteProperty(document, 'execCommand')
    Reflect.deleteProperty(navigator, 'clipboard')
})

describe('StudioToggleEditor copy snippet without the clipboard API', () => {
    test('regression reproducer: C5 the variable is copied through execCommand and the indicator shows', async () => {
        stubExecCommand(true)
        const host = show()
        expect(copyButton(host).textContent?.trim()).toBe(language.studioTgCopySnippet)

        copyButton(host).click()
        await vi.waitFor(() => expect(copyButton(host).textContent?.trim()).toBe(language.studioTgCopied))

        expect(copied).toEqual(['{{getglobalvar::toggle_k}}'])
    })

    test('regression reproducer: C6 no indicator when nothing was copied', async () => {
        stubExecCommand(false)
        const host = show()

        copyButton(host).click()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()

        expect(copied).toEqual(['{{getglobalvar::toggle_k}}'])
        expect(copyButton(host).textContent?.trim()).toBe(language.studioTgCopySnippet)
    })

    test('compatibility guard: with the clipboard API the text goes to it and the indicator shows', async () => {
        const writeText = vi.fn(async (_text: string) => {})
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
        const host = show()

        copyButton(host).click()
        await vi.waitFor(() => expect(copyButton(host).textContent?.trim()).toBe(language.studioTgCopied))

        expect(writeText).toHaveBeenCalledWith('{{getglobalvar::toggle_k}}')
    })
})
