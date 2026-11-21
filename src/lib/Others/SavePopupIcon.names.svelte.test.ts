// @vitest-environment jsdom

/**
 * `SavePopupIcon.svelte`: each of the four alert branches (read-only page, stopped saving, frozen
 * chaId, held save) is a button named by the saving-issue key, its glyph is hidden, and the alert
 * and the saving gradient use scheme tokens. Mounts the REAL component; mocks follow
 * `SavePopupIcon.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { FrozenSaveKeyInfo } from '../../ts/stores.svelte'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { heldSaveStore } from 'src/ts/storage/saveHold'

//#region module mocks

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const saving = $state({ state: false })
    return { saving, getSavingStoppedDetail: () => '' } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        savingStoppedReason: writable(''),
        peerWaitingStatus: writable(false),
        frozenSaveKeysStore: writable<FrozenSaveKeyInfo[]>([]),
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { DBState, savingStoppedReason, frozenSaveKeysStore } from '../../ts/stores.svelte'
import { saving } from 'src/ts/globalApi.svelte'
import { language } from '../../lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import SavePopupIcon from './SavePopupIcon.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountIcon(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SavePopupIcon, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const branches: Array<[string, () => void]> = [
    ['read-only page', () => setPageStorageMode({ kind: 'read-only', reason: 'backend-unavailable' })],
    ['stopped saving', () => savingStoppedReason.set('replaced')],
    ['frozen chaId', () => frozenSaveKeysStore.set([{ names: ['A', 'B'] } as unknown as FrozenSaveKeyInfo])],
    ['held save', () => heldSaveStore.set([{ name: 'Held', kind: 'unusable-id', archived: false }] as never)],
]

beforeEach(() => {
    saving.state = false
    savingStoppedReason.set('')
    frozenSaveKeysStore.set([])
    heldSaveStore.set([])
    DBState.db = {} as unknown as Database
    resetPageStorageModeForTests()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    resetPageStorageModeForTests()
})

describe('SavePopupIcon accessible names and colours', () => {
    test.each(branches)('regression reproducer: the %s button is named by the saving-issue key and its glyph is hidden', (_name, arrange) => {
        arrange()
        const target = mountIcon()
        const buttons = Array.from(target.querySelectorAll('button'))
        expect(buttons).toHaveLength(1)
        expect(controlName(buttons[0])).toBe(language.savingIssueDetails)
        expect(unnamedControls(target, { fields: true })).toEqual([])
        expect(exposedIcons(target)).toEqual([])
    })

    test.each(branches)('regression reproducer: the %s button uses the scheme alert fill with a ring on hover', (_name, arrange) => {
        arrange()
        const target = mountIcon()
        expect(paletteClasses(target)).toEqual([])
        const button = target.querySelector('button') as HTMLButtonElement
        expect(button.classList.contains('bg-draculared')).toBe(true)
        expect(button.classList.contains('text-bgcolor')).toBe(true)
        expect(button.classList.contains('hover:ring-2')).toBe(true)
        expect(button.classList.contains('hover:ring-textcolor')).toBe(true)
    })

    test('regression reproducer: the saving gradient uses scheme tokens', () => {
        DBState.db = { showSavingIcon: true } as unknown as Database
        saving.state = true
        const target = mountIcon()
        expect(target.querySelector('svg')).not.toBeNull()
        expect(paletteClasses(target)).toEqual([])
    })
})
