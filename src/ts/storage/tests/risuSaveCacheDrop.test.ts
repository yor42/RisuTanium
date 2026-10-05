// @vitest-environment node
/**
 * `dropRisuSaveCache` (`src/ts/storage/risuSaveCacheDrop.ts`) deletes the
 * legacy block cache database once the profile is a block profile. It is best
 * effort and never awaited: a delete that stays blocked, one that rejects and
 * one that throws on the spot must all leave the boot untouched.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const drops = vi.hoisted(() => ({
    created: [] as Array<Record<string, unknown>>,
    dropped: [] as Array<Record<string, unknown>>,
    behaviour: 'resolves' as 'resolves' | 'never' | 'rejects' | 'throws' | 'create-throws',
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: (options: Record<string, unknown>) => {
            drops.created.push(options)
            if (drops.behaviour === 'create-throws') {
                throw new Error('no storage')
            }
            return {
                dropInstance: (target: Record<string, unknown>) => {
                    drops.dropped.push(target)
                    if (drops.behaviour === 'never') {
                        return new Promise<void>(() => { })
                    }
                    if (drops.behaviour === 'rejects') {
                        return Promise.reject(new Error('the delete was refused'))
                    }
                    if (drops.behaviour === 'throws') {
                        throw new Error('drop failed on the spot')
                    }
                    return Promise.resolve()
                },
            }
        },
    },
}))

import { dropRisuSaveCache } from 'src/ts/storage/risuSaveCacheDrop'

beforeEach(() => {
    drops.created.length = 0
    drops.dropped.length = 0
    drops.behaviour = 'resolves'
})

describe('dropRisuSaveCache', () => {
    test('deletes the whole risuSaveCache database: a bare { name } drop, the shape that removes the database and not one object store', () => {
        dropRisuSaveCache()

        expect(drops.created).toEqual([{ name: 'risuSaveCache' }])
        expect(drops.dropped).toEqual([{ name: 'risuSaveCache' }])
    })

    test('a delete that stays blocked does not hold the caller: it returns at once with nothing to wait for', () => {
        drops.behaviour = 'never'

        expect(dropRisuSaveCache()).toBeUndefined()
        expect(drops.dropped.length).toBe(1)
    })

    test.each(['rejects', 'throws', 'create-throws'] as const)('a delete that %s is swallowed: no throw and no unhandled rejection', async (behaviour) => {
        drops.behaviour = behaviour
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)

        expect(() => dropRisuSaveCache()).not.toThrow()
        await new Promise((resolve) => setTimeout(resolve, 10))
        process.off('unhandledRejection', onUnhandled)

        expect(unhandled).toEqual([])
    })
})
