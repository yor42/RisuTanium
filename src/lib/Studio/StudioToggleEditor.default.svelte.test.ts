// @vitest-environment jsdom
/**
 * `StudioToggleEditor.svelte`: the default controls of a checkbox and a choice row, the upstream note beneath them and
 * the rewrite-loss banner that must not fire for a default the editor itself writes. REAL: the editor over a real toggle
 * builder, the language table and the checker; the port keeps the text it was written.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
import { drainMicrotasks } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import StudioToggleEditor from './StudioToggleEditor.svelte'

let mounted: Array<{ app: ReturnType<typeof mount>, host: HTMLElement }> = []

function show(initial: string, editable = true) {
    let text = initial.replace(/\r?\n$/, '')
    const port: ToggleTextPort = {
        owner: characterOwnerKey('A'),
        begin() {},
        read: () => text,
        view: () => ({ editable, banner: null, restricted: false }),
        write: (next) => { text = next; return { ok: true } },
        closeOpenStep() {},
    }
    const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'x', appKeys: new Set<string>() })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const id = builder.def.lines[0].id
    mounted.push({ app: mount(StudioToggleEditor, { target: host, props: { builder, editable, id, actions: { changeKind() {}, remove() {}, closeStep() {} } } }), host })
    flushSync()
    return { host, text: () => text }
}

afterEach(async () => {
    for (const entry of mounted) {
        await unmount(entry.app)
        entry.host.remove()
    }
    mounted = []
})

const part = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`[data-part="${name}"]`)
const checkbox = (host: HTMLElement) => part(host, 'studio-toggle-default-on') as HTMLInputElement
const picker = (host: HTMLElement) => part(host, 'studio-toggle-default') as HTMLSelectElement

describe('T5.3 the default controls', () => {
    test('new-behaviour guard: the checkbox reflects the default and writes it both ways', () => {
        const { host, text } = show('k=K===1\n')
        expect(checkbox(host).checked).toBe(true)
        checkbox(host).click()
        flushSync()
        expect(text()).toBe('k=K')
        expect(checkbox(host).checked).toBe(false)
        checkbox(host).click()
        flushSync()
        expect(text()).toBe('k=K===1')
    })

    test('new-behaviour guard: the picker lists none plus the options, reflects the default and writes the chosen option', () => {
        const { host, text } = show('m=M=select=a,b=b\n')
        expect(Array.from(picker(host).options).map((option) => [option.value, option.textContent])).toEqual([['-1', language.studioTgDefaultNone], ['0', 'a'], ['1', 'b']])
        expect(picker(host).value).toBe('1')
        picker(host).value = '0'
        picker(host).dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(text()).toBe('m=M=select=a,b=a')
        picker(host).value = '-1'
        picker(host).dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(text()).toBe('m=M=select=a,b')
        expect(picker(host).value).toBe('-1')
    })

    test('new-behaviour guard: an option whose text is empty is not offered as a default (G3-3)', () => {
        const { host } = show('m=M=select=a,,b\n')
        expect(Array.from(picker(host).options).map((option) => option.value)).toEqual(['-1', '0', '2'])
    })

    test('new-behaviour guard: the controls are disabled when the editor is not editable, and text rows have none', () => {
        const off = show('k=K===1\n', false)
        expect(checkbox(off.host).disabled).toBe(true)
        const text = show('t=T=text\n')
        expect(checkbox(text.host)).toBeNull()
        expect(picker(text.host)).toBeNull()
        expect(part(text.host, 'studio-toggle-default-note')).toBeNull()
    })

    test('new-behaviour guard: the upstream caveat shows under the default control of a checkbox and of a choice (MC-3014)', () => {
        for (const row of ['k=K\n', 'm=M=select=a,b\n']) {
            const { host } = show(row)
            expect(part(host, 'studio-toggle-default-note')?.textContent).toBe(language.studioTgDefaultUpstream)
        }
    })

    test('new-behaviour guard: the default controls have accessible names', () => {
        expect(checkbox(show('k=K\n').host).closest('label')?.textContent).toContain(language.studioTgDefaultOn)
        expect(picker(show('m=M=select=a,b\n').host).closest('label')?.textContent).toContain(language.studioTgDefault)
    })
})

describe('T5.3 the rewrite-loss banner', () => {
    test.each(['k=K===1\n', 'k=K===0\n', 'k=K===1\r\n', 'm=M=select=a,b=b\n'])('regression reproducer: no banner for %j', (row) => {
        expect(part(show(row).host, 'studio-toggle-rewrite-loss')).toBeNull()
    })

    test('new-behaviour guard: a select default that is not an option shows the banner', () => {
        expect(part(show('m=M=select=a,b=z\n').host, 'studio-toggle-rewrite-loss')).not.toBeNull()
    })
})

describe('StudioToggleEditor writeOption live read', () => {
    test('reproducer: teardown flush after unmount reads live select options instead of inert derived options', async () => {
        let text = 'm=M=select=a,b'
        const port: ToggleTextPort = {
            owner: characterOwnerKey('A'),
            begin() {},
            read: () => text,
            view: () => ({ editable: true, banner: null, restricted: false }),
            write: (next) => { text = next; return { ok: true } },
            closeOpenStep() {},
        }
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'x', appKeys: new Set<string>() })
        const host = document.createElement('div')
        document.body.appendChild(host)
        const id = builder.def.lines[0].id
        const app = mount(StudioToggleEditor, {
            target: host,
            props: { builder, editable: true, id, actions: { changeKind() {}, remove() {}, closeStep() {} } },
        })
        flushSync()

        const firstOption = host.querySelectorAll<HTMLInputElement>('[data-part="studio-toggle-option"]')[0]
        firstOption.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        firstOption.value = 'a_edited'
        firstOption.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }))
        flushSync()

        const destroying = unmount(app)
        // Update option 1 after destroy began so any inert `$derived` options snapshot still holds `'b'`.
        expect(builder.setOptions(id, ['a', 'b_updated'])).toEqual({ ok: true })
        await destroying
        await drainMicrotasks()
        host.remove()

        expect(text).toBe('m=M=select=a_edited,b_updated')
    })
})
