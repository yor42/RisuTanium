// @vitest-environment jsdom
/**
 * The switch of a check row in the toggles panel is named through aria-label equal to the row label. REAL: ToggleRow.
 * MOCKED: the language table (every key renders as its own name).
 * The inline text field of a text row is excluded from the field assertion: it is named only by aria-labelledby
 * without the description link, and it is not part of the A3c plan list.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PanelValueRow } from '../../ts/chatShell/togglePanel'
import { controls, controlName } from '../a11yNames.test-helpers'

vi.mock('../../lang', () => ({ language: new Proxy({}, { get: (_target, key) => (key === 'chatShellTogglesMenu' ? (label: string) => `menu:${label}` : String(key)) }) }))
// The row's imports reach the stores through the toggle panel module; plain stand-ins keep that import cycle quiet.
vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selIdState: { selId: -1 },
        selectedCharID: store(-1),
        MobileGUI: store(false),
        settingsOpen: store(false),
        ReloadGUIPointer: store(0),
    }
})
import ToggleRow from './ToggleRow.svelte'

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })

function show(row: PanelValueRow, value: string): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ToggleRow, {
        target,
        props: { row, value, badges: [], chatOnly: false, menuOpen: false, editing: false, draft: '', onset: vi.fn(), onpick: vi.fn(), onedit: vi.fn(), ondraft: vi.fn(), oncommit: vi.fn(), onmenu: vi.fn(), onreset: vi.fn(), onrevert: vi.fn() },
    })
    flushSync()
}

describe('ToggleRow form control names', () => {
    test.each(['0', '1'])('the check row switch (value %s) carries aria-label equal to the row label and no aria-labelledby', (value) => {
        show({ type: 'row', uid: 'u1', key: 'toggle_a', label: 'Alpha mode', kind: 'check', options: [] }, value)
        const box = target.querySelector<HTMLInputElement>('input[data-part="toggle-switch"]')!
        expect(box.getAttribute('aria-label')).toBe('Alpha mode')
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(box)).toBe('Alpha mode')
        expect(controls(target, { fields: true }).filter((el) => controlName(el) === '')).toEqual([])
    })
})
