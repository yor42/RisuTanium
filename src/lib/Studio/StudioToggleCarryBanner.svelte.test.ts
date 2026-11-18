// @vitest-environment jsdom
/**
 * The saved-values banner over a real toggle builder with a fake text port and an in-memory value place. Only the
 * visible contract is asserted: the group and its label, one line per item, the buttons for each kind of question, the
 * disabled state of a not-editable owner, and that nothing takes focus.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: {} } }))
vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    const base = helpers.studioLanguageMock()
    const withArguments = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const own: Record<string, unknown> = {}
    for (const key of [
        'studioTgCarryAskKey', 'studioTgCarryAskOptions', 'studioTgCarryAskKind', 'studioTgCarryAskDrop', 'studioTgCarryAskUnclear',
        'studioTgCarryAskOptionsLate', 'studioTgCarryAskOptionsLateRenamed', 'studioTgCarryOverwrite', 'studioTgCarryShared', 'studioTgCarryOldStays',
        'studioTgSummarySelect', 'studioTgSummaryGroup',
    ]) own[key] = withArguments(key)
    return { language: new Proxy(base, { get: (target, key) => typeof key === 'string' && key in own ? own[key] : Reflect.get(target, key) }) }
})

import { characterOwnerKey } from '../../ts/studio/history/ownerPhase'
import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import type { ToggleTextPort } from '../../ts/studio/edit/toggleTextPort'
import { createToggleBuilder, type CarryDeps, type ToggleBuilder } from '../../ts/studio/toggleBuilder.svelte'
import { resetToggleCarrySessionForTests } from '../../ts/studio/toggleCarryPending'
import { parseDefinition } from '../../ts/studio/toggleDef'
import StudioToggleCarryBanner from './StudioToggleCarryBanner.svelte'
import StudioToggleRow from './StudioToggleRow.svelte'

interface Rig {
    builder: ToggleBuilder
    port: ToggleTextPort & { text: string }
    stored: Record<string, string>
}

function rigOf(initial: string, values: Record<string, string> = {}, reachKind: 'own' | 'loaded' = 'own'): Rig {
    const stored = { ...values }
    const port: ToggleTextPort & { text: string } = {
        owner: characterOwnerKey('A'),
        text: initial,
        begin() {},
        read() { return port.text },
        view() { return { editable: true, banner: null, restricted: false } },
        write(next): StudioResult | null {
            port.text = next
            return { ok: true }
        },
        closeOpenStep() {},
    }
    const deps: CarryDeps = {
        reach: () => ({ places: [{ ref: { kind: 'global' }, entries: stored }], others: [] }),
        values: {
            read: (_ref, key) => stored[key],
            write: (_ref, key, value) => {
                if (value === undefined) delete stored[key]
                else stored[key] = value
            },
            mark() {},
        },
        starSource: 'character:A',
        stars: { has: () => false, rename() {} },
        reachKind,
    }
    return { builder: createToggleBuilder(port, { keyEditsLive: true, stem: 'x', appKeys: new Set<string>(), carry: deps }), port, stored }
}

const mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

function show(rig: Rig, editable: boolean, actions: { carry(): void, answer(): void, undo(): void } = { carry() {}, answer() {}, undo() {} }, error = ''): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({ app: mount(StudioToggleCarryBanner, { target: host, props: { builder: rig.builder, editable, error, actions } }), host })
    flushSync()
    return host
}

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    localStorage.clear()
    resetToggleCarrySessionForTests()
})

const first = (text: string) => parseDefinition(text).lines[0].id
const part = (host: HTMLElement, name: string) => host.querySelector<HTMLElement>(`[data-part="${name}"]`)

describe('F-A the saved-values banner', () => {
    test('a rename shows a labelled group, one line per item, the reach lines and Carry and Leave; focus stays where it was', () => {
        const rig = rigOf('a=Mode\nb=B\n', { toggle_a: '1' })
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        outside.focus()
        rig.builder.setKey(first('a=Mode\nb=B\n'), 'c')
        rig.builder.checkpoint()
        const host = show(rig, true)
        const group = part(host, 'studio-toggle-carry')
        expect(group?.getAttribute('role')).toBe('group')
        const title = document.getElementById(group?.getAttribute('aria-labelledby') ?? '')
        expect(title?.textContent).toBe('studioTgCarryTitle')
        expect(part(host, 'studio-toggle-carry-line')?.textContent).toBe('studioTgCarryAskKey(a,c)')
        expect(part(host, 'studio-toggle-carry-old-stays')?.textContent).toBe('studioTgCarryOldStays(a)')
        expect(part(host, 'studio-toggle-carry-reach')?.textContent).toBe('studioTgCarryReachOwn')
        expect(part(host, 'studio-toggle-carry-loadouts')?.textContent).toBe('studioTgCarryLoadouts')
        expect(part(host, 'studio-toggle-carry-yes')).not.toBeNull()
        expect(part(host, 'studio-toggle-carry-no')).not.toBeNull()
        expect(part(host, 'studio-toggle-carry-ok')).toBeNull()
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })

    test('a module owner names the loaded characters, a character owner its own chats', () => {
        const rig = rigOf('a=Mode\nb=B\n', {}, 'loaded')
        rig.builder.setKey(first('a=Mode\nb=B\n'), 'c')
        rig.builder.checkpoint()
        expect(part(show(rig, true), 'studio-toggle-carry-reach')?.textContent).toBe('studioTgCarryReachLoaded')
    })

    test('a question with nothing to carry shows OK only', () => {
        const rig = rigOf('a=Mode\nb=B\n')
        rig.port.text = 'y=Mode\nz=Mode\nb=B\n'
        rig.builder.resync(rig.port.text)
        rig.builder.checkpoint()
        const host = show(rig, true)
        expect(part(host, 'studio-toggle-carry-line')?.dataset.kind).toBe('unclear')
        expect(part(host, 'studio-toggle-carry-ok')).not.toBeNull()
        expect(part(host, 'studio-toggle-carry-yes')).toBeNull()
    })

    test('buttons are disabled while the owner is not editable, and clicking calls the actions', () => {
        const rig = rigOf('a=Mode\nb=B\n')
        rig.builder.setKey(first('a=Mode\nb=B\n'), 'c')
        rig.builder.checkpoint()
        const calls: string[] = []
        const host = show(rig, false, { carry: () => calls.push('carry'), answer: () => calls.push('answer'), undo: () => calls.push('undo') })
        expect((part(host, 'studio-toggle-carry-yes') as HTMLButtonElement).disabled).toBe(true)
        expect((part(host, 'studio-toggle-carry-no') as HTMLButtonElement).disabled).toBe(true)
        const live = show(rig, true, { carry: () => calls.push('carry'), answer: () => calls.push('answer'), undo: () => calls.push('undo') })
        part(live, 'studio-toggle-carry-yes')?.click()
        part(live, 'studio-toggle-carry-no')?.click()
        expect(calls).toEqual(['carry', 'answer'])
    })

    test('a carried result line offers Undo, and a refusal text shows as an alert', () => {
        const rig = rigOf('a=Mode\nb=B\n', { toggle_a: '1' })
        rig.builder.setKey(first('a=Mode\nb=B\n'), 'c')
        rig.builder.checkpoint()
        expect(rig.builder.carryValues().ok).toBe(true)
        const host = show(rig, true, undefined, 'refusal text')
        expect(part(host, 'studio-toggle-carry')).toBeNull()
        expect(part(host, 'studio-toggle-carry-result')).not.toBeNull()
        expect(part(host, 'studio-toggle-carry-undo')).not.toBeNull()
        expect(part(host, 'studio-toggle-carry-error')?.textContent).toBe('refusal text')
    })

    test('a late renumbering is named and offers OK only', () => {
        const text = 'p=Pick=select=x,y\n'
        const rig = rigOf(text, { toggle_p: '0' })
        rig.builder.setOptions(first(text), ['y', 'x'], 'single')
        rig.builder.dispose()
        const later = createToggleBuilder(rig.port, { keyEditsLive: true, stem: 'x', appKeys: new Set<string>(), carry: {
            reach: () => ({ places: [], others: [] }), values: { read: () => undefined, write() {}, mark() {} }, starSource: 'character:A', stars: { has: () => false, rename() {} }, reachKind: 'loaded',
        } })
        const host = show({ ...rig, builder: later }, true)
        expect(part(host, 'studio-toggle-carry-line')?.textContent).toBe('studioTgCarryAskOptionsLate(p)')
        expect(part(host, 'studio-toggle-carry-ok')).not.toBeNull()
    })
})

describe('the row flag', () => {
    const line = parseDefinition('a=Mode\n').lines[0]
    const base = { line, level: 1, expandable: false, expanded: false, memberCount: 0, selected: false, tabbable: true, flags: '', onactivate() {}, onfocus() {}, ontoggle() {}, onmenu() {}, onaddin() {} }

    test('a flagged row names the saved-values title in its title and label; an unflagged row has no flag', () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        mounted.push({ app: mount(StudioToggleRow, { target: host, props: { ...base, carryFlag: true } }), host })
        flushSync()
        const flag = part(host, 'studio-toggle-flag')
        expect(flag?.getAttribute('title')).toBe('studioTgCarryTitle')
        expect(flag?.getAttribute('aria-hidden')).toBe('true')
        expect(part(host, 'studio-toggle-row')?.getAttribute('aria-label')).toContain('studioTgCarryTitle')

        const plain = document.createElement('div')
        document.body.appendChild(plain)
        mounted.push({ app: mount(StudioToggleRow, { target: plain, props: base }), host: plain })
        flushSync()
        expect(part(plain, 'studio-toggle-flag')).toBeNull()
    })
})
