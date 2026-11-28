// The module toggle port at port level: its live text and its visibility follow the first holder of the raw id only. A
// stub first holder reads as empty and hidden even when a resident copy follows it; the UI cannot reach that state, so
// this is the port's own contract. No history service is built.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RisuModule } from 'src/ts/process/modules'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'

vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { modules: [], characters: [] } } }))
vi.mock('src/ts/studio/history/studioHistoryService.svelte', () => ({
    beginOwnerVisit: vi.fn(),
    ensureStudioHistory: vi.fn(),
    getStudioHistoryService: () => null,
    historyBannerText: () => null,
}))
vi.mock('../presetTarget', () => ({ presetOwnerKey: vi.fn(), presetStateOf: vi.fn(), presetToggleText: vi.fn() }))

import { DBState } from 'src/ts/stores.svelte'
import { moduleTogglePort } from '../toggleTextPort'

function put(...modules: unknown[]): void {
    DBState.db.modules = modules as unknown as RisuModule[]
}

beforeEach(() => {
    put()
})

describe('moduleTogglePort reads only the first holder of the id', () => {
    test('T10 a stub first holder reads empty and hidden even when a resident copy follows', () => {
        put(stubModule('M'), { id: 'M', name: 'copy', customModuleToggle: 'a=A' })
        const port = moduleTogglePort('M')
        expect(port.read()).toBe('')
        expect(port.view()).toEqual({ editable: false, banner: null, restricted: true })
    })

    test('a resident first holder is read and shown, whatever its twin holds', () => {
        put({ id: 'M', name: 'first', customModuleToggle: 'a=A' }, { id: 'M', name: 'copy', customModuleToggle: 'b=B' })
        const port = moduleTogglePort('M')
        expect(port.read()).toBe('a=A')
        expect(port.view().restricted).toBe(false)
    })

    test('a resident first holder followed by a stub is still read', () => {
        put({ id: 'M', name: 'first', customModuleToggle: 'a=A' }, stubModule('M'))
        expect(moduleTogglePort('M').read()).toBe('a=A')
    })

    test('a missing id reads empty and hidden, and a non-string text reads empty', () => {
        put({ id: 'M', customModuleToggle: 5 })
        expect(moduleTogglePort('gone').read()).toBe('')
        expect(moduleTogglePort('gone').view().restricted).toBe(true)
        expect(moduleTogglePort('M').read()).toBe('')
    })
})
