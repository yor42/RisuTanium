// @vitest-environment jsdom
/**
 * `StudioToggleEditor.svelte`: the row-type select sits in a wrapping label; the name comes from the inner text span, never
 * from the wrapping label. REAL: the editor over a real toggle builder, the language table and the checker. The group
 * row shows a static type text instead of a select.
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
import { fieldNameProblems, unnamedControls } from '../a11yNames.test-helpers'
import StudioToggleEditor from './StudioToggleEditor.svelte'

let mounted: Array<{ app: ReturnType<typeof mount>, host: HTMLElement }> = []

function show(text: string): HTMLElement {
    const port: ToggleTextPort = {
        owner: characterOwnerKey('A'),
        begin() {},
        read: () => text,
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

afterEach(async () => {
    for (const entry of mounted) {
        await unmount(entry.app)
        entry.host.remove()
    }
    mounted = []
})

const typeSelects = (host: HTMLElement) => host.querySelectorAll('[data-part="studio-toggle-kind"]').length

// The row's text fields (key, label, one per option): text fields outside the value-control set of #334.
const TEXT_FIELD = '<input type=text class="min-h-11 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor">'

describe('StudioToggleEditor value-control names', () => {
    test.each([
        ['k=Label=select=a,b\n', 4],
        ['k=Label\n', 2],
    ] as const)('regression reproducer: the type select of %j is named by its type text', (text, textFields) => {
        const host = show(text)
        expect(typeSelects(host)).toBe(1)
        expect(fieldNameProblems(host, [{ name: language.studioTgType }])).toEqual([])
        expect(unnamedControls(host, { fields: true, values: true })).toEqual(Array.from({ length: textFields }, () => TEXT_FIELD))
    })

    test('compatibility guard: a group row has no type select to name', () => {
        const host = show('g=Group=group\n')
        expect(typeSelects(host)).toBe(0)
        expect(fieldNameProblems(host, [])).toEqual([])
    })
})
