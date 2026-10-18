// @vitest-environment node
/**
 * The production closure reader (`store2/sweep/backendReader.ts`): a unit is parsed only when it is stored and its length and
 * checksum are the ones its referrer holds. The units are real frames in the memory backend; nothing says anything about a
 * real store.
 *
 * The reader does not exist on the red base (the W5b commit), so a file here fails at import there, which proves nothing by
 * itself. A "reproducer" is red under the mutant named in the hand-back that removes the rule it pins; a "guard" pins a
 * behaviour another layer also upholds.
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import {
    encodeUnit, refOfFrame, UNIT_TYPE, type ListRef,
} from 'src/ts/storage/store2/format'
import { createBackendClosureReader } from 'src/ts/storage/store2/sweep/backendReader'
import { buildClosureAssetKeepSet } from 'src/ts/storage/store2/sweep'
import { assetListOf, commitKeyOf, manifestKey, unitTail } from './sweepFixtures'

const KEY = `store2/${unitTail(1)}`

/** An asset list stored under `KEY` and the reference its referrer would hold. */
function storedList(backend: MemoryBackend): { ref: ListRef, bytes: Uint8Array } {
    const list = assetListOf(['a.png'])
    const bytes = encodeUnit(UNIT_TYPE.assetList, list)
    backend.poke(KEY, bytes)
    const [tail, length, crc] = refOfFrame(KEY, bytes)
    return { ref: [tail, length, crc, list.v], bytes }
}

describe('a unit is parsed only when it matches its Ref', () => {
    test('reproducer: a stored unit with the right length and checksum is delivered', async () => {
        const backend = createMemoryBackend()
        const { ref } = storedList(backend)

        const read = await createBackendClosureReader(backend).assetList(ref)

        expect(read.status).toBe('ok')
        expect(read.status === 'ok' ? read.value : null).toEqual(assetListOf(['a.png']))
    })

    test('reproducer: an absent unit answers missing', async () => {
        const backend = createMemoryBackend()
        const { ref } = storedList(backend)
        backend.poke(KEY, null)

        const read = await createBackendClosureReader(backend).assetList(ref)

        expect(read.status).toBe('missing')
    })

    test('reproducer: a length that differs from the Ref answers crc-failed and the bytes are not parsed', async () => {
        const backend = createMemoryBackend()
        const { ref } = storedList(backend)
        const wrongLength: ListRef = [ref[0], ref[1] + 1, ref[2], ref[3]]

        const read = await createBackendClosureReader(backend).assetList(wrongLength)

        expect(read.status).toBe('crc-failed')
    })

    test('reproducer: a checksum that differs from the Ref answers crc-failed and the bytes are not parsed', async () => {
        const backend = createMemoryBackend()
        const { ref } = storedList(backend)
        const wrongCrc: ListRef = [ref[0], ref[1], (ref[2] ^ 1) >>> 0, ref[3]]

        const read = await createBackendClosureReader(backend).assetList(wrongCrc)

        expect(read.status).toBe('crc-failed')
    })

    test('guard: a unit of another type under the Ref is damaged, not delivered as the expected type', async () => {
        const backend = createMemoryBackend()
        const { ref } = storedList(backend)

        const read = await createBackendClosureReader(backend).inlayList(ref)

        expect(read.status).toBe('damaged')
    })

    test('guard: bytes too short to be a frame answer crc-failed when the length happens to match', async () => {
        const backend = createMemoryBackend()
        backend.poke(KEY, new Uint8Array([1, 2, 3]))

        const read = await createBackendClosureReader(backend).assetList([unitTail(1), 3, 0, 1])

        expect(read.status).toBe('crc-failed')
    })
})

describe('a failing backend makes the keep-set incomplete', () => {
    test('reproducer: a backend read that throws rejects the read, and the walk reports the node missing', async () => {
        const backend = createMemoryBackend()
        const reader = createBackendClosureReader(backend)
        backend.injectFault(1, 'fail')

        await expect(reader.manifest(manifestKey(1))).rejects.toThrow()

        const walked = await buildClosureAssetKeepSet({
            commitKey: commitKeyOf({ current: manifestKey(1) }),
            reader: createBackendClosureReader(failingBackend(backend)),
        })
        expect(walked.status).toBe('incomplete')
        expect(walked.status === 'incomplete' ? walked.reasons.map(reason => reason.code) : []).toContain('node-missing')
    })
})

function failingBackend(inner: Store2Backend): Store2Backend {
    return {
        ...inner,
        readUnits: async () => {
            throw new Error('The backend could not be read.')
        },
    }
}

describe('one read per unit', () => {
    test('guard: a unit named twice is fetched once, and a list is not a manifest', async () => {
        const backend = createMemoryBackend()
        const { ref } = storedList(backend)
        let fetches = 0
        const counted: Store2Backend = {
            ...backend,
            readUnits: keys => {
                fetches++
                return backend.readUnits(keys)
            },
        }
        const reader = createBackendClosureReader(counted)

        await reader.assetList(ref)
        await reader.assetList(ref)

        expect(fetches).toBe(1)
        expect(reader.manifests().size).toBe(0)
    })
})
