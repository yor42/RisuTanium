/**
 * The resident walk of the inlay sweep (`store2/sweep/inlayResident.ts`): which of the asked ids the page's database
 * refers to, and the refusal to answer when a value was nested too deep to follow while an id was still unmatched.
 *
 * The walk is the real `IdMatcher`, `Scanner`, `walkStrings` and `Pacer` of the legacy clean-up module; only the page
 * modules that module imports are doubles. The walk does not exist on the base, so an import failure there proves
 * nothing: each test is a guard that the mutant named beside it turns red (M19: `tooDeep` ignored).
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const stub: Record<string, unknown> = {}
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({ getDatabase: vi.fn() }) as unknown as typeof import('src/ts/storage/database.svelte'))

import { Pacer } from 'src/ts/process/files/inlayCleanup'
import { residentInlaysOf } from 'src/ts/storage/store2/sweep/inlayResident'

const uuid = (n: number): string => `0a1b2c3d-1111-4222-8333-${String(n).padStart(12, '0')}`
const A = uuid(1)
const B = uuid(2)
const C = uuid(3)

/** `depth` nested single-key objects around `leaf`. */
function nested(depth: number, leaf: unknown): unknown {
    let value = leaf
    for (let i = 0; i < depth; i++) {
        value = { next: value }
    }
    return value
}

describe('residentInlaysOf', () => {
    test('T14 unit: a shallow database gives the asked ids it mentions, in any string or key', async () => {
        const database = { characters: [{ chats: [{ message: [{ data: `before {{inlayed::${A}}} after` }] }] }], [`key-${B}`]: 1 }

        const mentioned = await residentInlaysOf(database, [A, B, C], new Pacer())

        expect(mentioned === null ? null : [...mentioned].sort()).toEqual([A, B].sort())
    })

    test('T14 unit: a database that mentions none of them gives an empty set, not null', async () => {
        const mentioned = await residentInlaysOf({ mainPrompt: 'nothing here' }, [A], new Pacer())

        expect(mentioned === null ? null : [...mentioned]).toEqual([])
    })

    test('T14 unit: a value nested past the walk limit while an id is unmatched gives null', async () => {
        const database = { deep: nested(101, `{{inlayed::${A}}}`) }

        expect(await residentInlaysOf(database, [A], new Pacer())).toBeNull()
    })

    test('T14 unit: too-deep nesting does not matter once every asked id was matched', async () => {
        // The walk pops the last pushed value first, so the deep branch is followed (and reported) before the shallow string.
        const database = { shallow: `{{inlayed::${A}}}`, deep: nested(101, 'text') }

        const mentioned = await residentInlaysOf(database, [A], new Pacer())

        expect(mentioned === null ? null : [...mentioned]).toEqual([A])
    })
})
