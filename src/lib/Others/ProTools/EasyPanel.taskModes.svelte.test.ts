// @vitest-environment jsdom

/**
 * T-R13 / T-C9 (#929, S1a): the Easy Panel "run" button writes the per-task modes through the shared helper, so modes and flag
 * change together, and it keeps a mix that is already set. The REAL panel is mounted; its collaborators that render nothing
 * here are mocked, as in `EasyPanel.parts.svelte.test.ts`.
 *
 * Titles: `reproducer` fails on the pre-change base (it writes the flag alone); `guard` passes before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    const easyPanelStore = $state({ open: true })
    return { DBState: state, easyPanelStore, selIdState: { selId: 0 } } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

vi.mock('src/lib/UI/ModelList.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/Setting/Pages/Advanced/CustomModelsSettings.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/Setting/Pages/ClaudeThinkingSeparateParams.svelte', () => ({ default: () => { } }))
vi.mock('src/lib/UI/GUI/SliderInput.svelte', () => ({ default: () => { } }))
vi.mock('../AllSeperateParameters.svelte', () => ({ default: () => { } }))

import { language } from 'src/lang'
import { DBState, easyPanelStore } from 'src/ts/stores.svelte'
import EasyPanel from './EasyPanel.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountWith(db: Record<string, unknown>): HTMLElement {
    DBState.db = db as unknown as Database
    easyPanelStore.open = true
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(EasyPanel, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function clickRun(root: HTMLElement) {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.run)
    if (!button) throw new Error('no run button')
    button.click()
    flushSync()
}

function modesOf(): unknown {
    return (DBState.db as unknown as { seperateParameters?: { taskModes?: unknown } }).seperateParameters?.taskModes
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const OWN = { memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' }
const MIX = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }

describe('EasyPanel run', () => {
    test('reproducer: run on a database with the flag off writes all four modes own with the flag, and the other requirements', () => {
        const root = mountWith({ seperateParametersEnabled: false, seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {} } })

        clickRun(root)

        const db = DBState.db as unknown as Record<string, unknown>
        expect(modesOf()).toEqual(OWN)
        expect(db.seperateParametersEnabled).toBe(true)
        expect(db.doNotChangeSeperateModels).toBe(true)
        expect(db.epEnabled).toBe(true)
        expect(db.disableSeperateParameterChangeOnPresetChange).toBe(true)
    })

    test('reproducer: run on a database with no container gives it the empty members and the modes', () => {
        const root = mountWith({})

        clickRun(root)

        expect(modesOf()).toEqual(OWN)
        expect((DBState.db as unknown as Record<string, unknown>).seperateParametersEnabled).toBe(true)
    })

    test('guard: run over a mix with another requirement unmet keeps the modes and the flag', () => {
        const root = mountWith({
            seperateParametersEnabled: true,
            seperateParameters: { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {}, taskModes: { ...MIX } },
        })

        clickRun(root)

        expect(modesOf()).toEqual(MIX)
        expect((DBState.db as unknown as Record<string, unknown>).seperateParametersEnabled).toBe(true)
        expect((DBState.db as unknown as Record<string, unknown>).epEnabled).toBe(true)
    })
})
