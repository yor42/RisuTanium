// @vitest-environment jsdom
/**
 * The module merge's confirm (MC-1201) on its own: every character with hits named with its count, the archived and
 * unfinished lines only when they apply, the lookalike warning always, Cancel focused first, and the two buttons calling
 * only their own handler. Feature guards: the component is new.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/lang', () => {
    const call = (key: string) => (...args: (string | number)[]) => `${key}(${args.join(',')})`
    const table: Record<string, unknown> = {}
    for (const key of ['studioAssetMergeConfirmHit', 'studioAssetMergeConfirmUnfinished', 'studioAssetMergeArchivedCharacters']) table[key] = call(key)
    return { language: new Proxy(table, { get: (target, key) => (typeof key === 'symbol' ? undefined : key in target ? target[key] : key) }) }
})

import type { ConfirmFacts } from '../../../ts/studio/assets/mergeCommit'
import StudioAssetMergeConfirm from './StudioAssetMergeConfirm.svelte'

let mounted: { app: ReturnType<typeof mount>, host: HTMLElement }[] = []

const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const part = (name: string) => parts(name)[0]

function show(facts: ConfirmFacts): { merged: number, cancelled: number } {
    const calls = { merged: 0, cancelled: 0 }
    const host = document.createElement('div')
    document.body.appendChild(host)
    mounted.push({
        host,
        app: mount(StudioAssetMergeConfirm, {
            target: host,
            props: { facts, nameOf: (id: string) => `name-${id}`, onmerge: () => { calls.merged += 1 }, oncancel: () => { calls.cancelled += 1 } },
        }),
    })
    flushSync()
    return calls
}

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
})

describe('the confirm', () => {
    test('names every character with hits and its count, and always says the lookalike warning', () => {
        show({ hits: [{ chaId: 'a', count: 3 }, { chaId: 'b', count: 1 }], archived: 0, finished: true })
        expect(parts('studio-asset-merge-confirm-hit').map((line) => line.textContent)).toEqual(['studioAssetMergeConfirmHit(name-a,3)', 'studioAssetMergeConfirmHit(name-b,1)'])
        expect(part('studio-asset-merge-confirm-warning').textContent).toBe('studioAssetMergeConfirmWarning')
        expect(parts('studio-asset-merge-confirm-unfinished')).toHaveLength(0)
        expect(parts('studio-asset-merge-confirm-archived')).toHaveLength(0)
    })

    test('says how many characters were not checked when some are archived', () => {
        show({ hits: [], archived: 4, finished: true })
        expect(part('studio-asset-merge-confirm-archived').textContent).toBe('studioAssetMergeArchivedCharacters(4)')
    })

    test('says "not finished" with the characters found so far while the scan runs', () => {
        show({ hits: [{ chaId: 'a', count: 1 }], archived: 0, finished: false })
        expect(part('studio-asset-merge-confirm-unfinished').textContent).toBe('studioAssetMergeConfirmUnfinished(1)')
    })

    test('Cancel has the first focus and each button calls only its own handler', () => {
        const calls = show({ hits: [], archived: 0, finished: false })
        expect(document.activeElement).toBe(part('studio-asset-merge-confirm-cancel'))
        part('studio-asset-merge-confirm-cancel').click()
        expect(calls).toEqual({ merged: 0, cancelled: 1 })
        part('studio-asset-merge-confirm-merge').click()
        expect(calls).toEqual({ merged: 1, cancelled: 1 })
    })

    test('is marked critical, as the warning it carries is', () => {
        show({ hits: [], archived: 0, finished: true })
        expect(part('studio-asset-merge-confirm').hasAttribute('data-part-critical')).toBe(true)
    })
})
