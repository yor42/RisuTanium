// @vitest-environment happy-dom

/**
 * The host App mounts for the memory modal flag: ChroMemory selected mounts the ChroMemory modal,
 * a V3 engine mounts the V3 modal, and any other engine mounts nothing and resets the flag, so
 * the V3 modal never creates `hypaV3Data` on a chat whose engine is not V3. (R) = regression
 * reproducer (the host does not exist on the base); (G) = guard.
 *
 * Mounts the REAL host over a `$state` database; both modals are stubs that record a mount and
 * what they were given, because only the host's choice is under test.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ mounts: [] as string[] }))

vi.mock('./ChroMemoryModal.svelte', () => ({ default: function Stub() { h.mounts.push('chro') } }))
vi.mock('./HypaV3Modal.svelte', () => ({ default: function Stub() { h.mounts.push('v3') } }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hypaV3ModalOpen: writable(true),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState, hypaV3ModalOpen } from 'src/ts/stores.svelte'
import MemoryModalHost from './MemoryModalHost.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function mountHost(db: Record<string, unknown>): void {
    DBState.db = { hanuraiEnable: false, hypav2: false, hypaV3: false, supaModelType: 'none', ...db } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(MemoryModalHost, { target, props: {} }))
    flushSync()
}

beforeEach(() => {
    h.mounts.length = 0
    hypaV3ModalOpen.set(true)
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('MemoryModalHost', () => {
    test('UI3 (R): ChroMemory on mounts the ChroMemory modal, even over V3 flags, and never the V3 modal', () => {
        mountHost({ ltmEngine: true, hypaV3: true })
        expect(h.mounts).toEqual(['chro'])
        expect(get(hypaV3ModalOpen)).toBe(true)
    })

    test('UI3 (G): a V3 engine mounts the V3 modal and leaves the flag alone', () => {
        mountHost({ hypaV3: true })
        expect(h.mounts).toEqual(['v3'])
        expect(get(hypaV3ModalOpen)).toBe(true)
    })

    test('UI3 (R): the flag with no engine mounts nothing and resets the flag', () => {
        mountHost({ ltmEngine: false })
        expect(h.mounts).toEqual([])
        expect(get(hypaV3ModalOpen)).toBe(false)
    })

    test('UI3 (R): the flag with a V2 engine mounts nothing and resets the flag', () => {
        mountHost({ hypav2: true, supaModelType: 'distilbart' })
        expect(h.mounts).toEqual([])
        expect(get(hypaV3ModalOpen)).toBe(false)
    })

    test('UI3 (G): the engine changing from V3 to ChroMemory swaps the modal', () => {
        mountHost({ hypaV3: true })
        expect(h.mounts).toEqual(['v3'])
        ;(DBState.db as unknown as Record<string, unknown>).ltmEngine = true
        flushSync()
        expect(h.mounts).toEqual(['v3', 'chro'])
    })
})
