// @vitest-environment jsdom
/**
 * The opt-in checkbox of each skipped owner in the toggle uses list is named through aria-label equal to the visible
 * "also update" text for that owner. REAL: StudioToggleUses and the real language table. MOCKED: the reach scan, the
 * plan, the update run and the history service, so the list mounts over one fixed plan with two skipped owners.
 */
import { flushSync, mount, unmount, type ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { characters: [], modules: [] } } }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('src/ts/studio/history/studioHistoryService.svelte', () => ({ getStudioHistoryService: () => null }))
vi.mock('src/ts/studio/studioScreen.svelte', () => ({ selectStudioNode: vi.fn() }))
vi.mock('src/ts/studio/toggleUpdateAllRun.svelte', () => ({
    currentUpdate: () => null,
    readShownReach: () => ({ owners: [{ key: 'character:c1', name: 'Alice' }, { key: 'module:M1', name: 'Module One' }] }),
    runUpdateAll: vi.fn(),
    undoLastUpdate: vi.fn(),
}))
vi.mock('src/ts/studio/toggleUpdateAll', () => ({
    scanReach: () => ({}),
    planFromScan: () => ({
        writes: [], blocked: [], listed: [], count: 0, unreached: [],
        skipped: [{ owner: 'character:c1', key: 'a', count: 2 }, { owner: 'module:M1', key: 'a', count: 1 }],
    }),
}))

import { language } from 'src/lang'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'
import StudioToggleUses from './StudioToggleUses.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement
afterEach(async () => { if (app) await unmount(app); app = undefined; host?.remove() })

describe('StudioToggleUses form control names', () => {
    test('each opt-in checkbox carries aria-label equal to its visible text for that owner, and no aria-labelledby', () => {
        host = document.createElement('div')
        document.body.appendChild(host)
        const builder = { usesRenames: [{ from: 'a', to: 'b' }], usesKept: false, dismissUses: vi.fn(), noteUpdated: vi.fn(), owner: 'character:c1' }
        app = mount(StudioToggleUses, {
            target: host,
            // Partial doubles: the list reads only the builder fields above; the toast helper and host are never reached.
            props: { builder, target: { kind: 'character', chaId: 'c1' }, chaId: 'c1', editable: true, announce: vi.fn(), toasts: {}, host: {} } as unknown as ComponentProps<typeof StudioToggleUses>,
        })
        flushSync()
        const boxes = [...host.querySelectorAll<HTMLInputElement>('[data-part="studio-toggle-uses-optin"]')]
        expect(boxes.map((box) => box.getAttribute('aria-label'))).toEqual([language.studioTgUsesAlsoUpdate('Alice'), language.studioTgUsesAlsoUpdate('Module One')])
        for (const box of boxes) {
            expect(box.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
        }
        expect(unnamedControls(host, { fields: true })).toEqual([])
    })
})
