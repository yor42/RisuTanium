// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
    HEAD_KEY,
    characterBlockKey,
    characterKeySegment,
    fixedBlockKey,
    generationOfKey,
    isGenerationId,
    keptKey,
    newGenerationId,
    ownBlockKey,
    rootKey,
    stubsKey,
} from 'src/ts/storage/blockKeys'
import { indexedDbCreatableViolation, nodeCreatableViolation, tauriCreatableViolation } from 'src/ts/storage/store/keyRules'

const GENERATION = newGenerationId({ now: () => 1_700_000_000_000, randomBytes: () => Uint8Array.of(1, 2, 3, 4) })

function awkwardChaIds(): string[] {
    const ids = [
        '', 'a', 'A', 'a.', 'a ', '.', '..', '§playground', '§temp', 'root', 'preset', 'config', '__proto__', 'con', 'NUL', 'a/b', 'a\\b',
        'a:b', 'a<b>', 'a|b', 'a?b', 'a*b', 'a"b', '\0', 'x'.repeat(40), 'x'.repeat(41), 'y'.repeat(255), 'Y'.repeat(255), '가'.repeat(60),
        '😀'.repeat(60), 'é', 'é', 'İ', 'i', 'I', 'ı', 'ǅ', 'ǆ', 'Ǆ',
    ]
    let seed = 12345
    for (let i = 0; i < 400; i++) {
        let id = ''
        const length = 1 + (seed % 90)
        for (let j = 0; j < length; j++) {
            seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
            id += String.fromCodePoint(32 + (seed % 3000))
        }
        ids.push(id)
    }
    return ids
}

describe('k(chaId), memoised per chaId', () => {
    test('a name already seen is not encoded or hashed again, and the segment is the same string', () => {
        const long = `memo-${'q'.repeat(90)}`
        const first = characterKeySegment(long)
        const encode = vi.spyOn(TextEncoder.prototype, 'encode')
        try {
            expect(characterKeySegment(long)).toBe(first)
            expect(characterKeySegment('memo-short')).toBe(characterKeySegment('memo-short'))
            expect(encode).toHaveBeenCalledTimes(1)
        } finally {
            encode.mockRestore()
        }
    })

    test('the memoised segment is the hex of the name, or h plus its SHA-256, exactly as an uncached computation gives', () => {
        for (const id of ['', 'a', 'Z', 'x'.repeat(40), 'x'.repeat(41), '가'.repeat(30), '가'.repeat(31), '__proto__', 'constructor']) {
            const bytes = new TextEncoder().encode(id)
            const expected = bytes.length > 0 && bytes.length * 2 <= 80
                ? Buffer.from(bytes).toString('hex')
                : `h${createHash('sha256').update(bytes).digest('hex')}`
            expect(characterKeySegment(id)).toBe(expected)
            expect(characterKeySegment(id)).toBe(expected)
        }
    })

    test('two names never share a memoised segment', () => {
        expect(characterKeySegment('A')).not.toBe(characterKeySegment('a'))
        expect(characterKeySegment('__proto__')).not.toBe(characterKeySegment('constructor'))
    })
})

describe('k(chaId), invariant K', () => {
    const ids = Array.from(new Set(awkwardChaIds()))

    test('it is injective over awkward and random chaIds', () => {
        const seen = new Map<string, string>()
        for (const id of ids) {
            const segment = characterKeySegment(id)
            expect(seen.get(segment), `${JSON.stringify(id)} collides with ${JSON.stringify(seen.get(segment))}`).toBeUndefined()
            seen.set(segment, id)
        }
    })

    test('chaIds that differ only by case get segments that differ even after case folding', () => {
        const folded = new Map<string, string>()
        for (const id of ids) {
            const key = characterBlockKey(GENERATION, id).toLowerCase()
            expect(folded.get(key), `${JSON.stringify(id)} folds onto ${JSON.stringify(folded.get(key))}`).toBeUndefined()
            folded.set(key, id)
        }
        expect(characterKeySegment('a')).not.toBe(characterKeySegment('A'))
    })

    test('every key it builds is creatable on the Node server, the desktop file system and IndexedDB', () => {
        for (const id of ids) {
            const keys = [characterBlockKey(GENERATION, id), ownBlockKey(GENERATION, id)]
            for (const key of keys) {
                expect(nodeCreatableViolation(key), `${key} on Node`).toBeNull()
                expect(tauriCreatableViolation(key), `${key} on the desktop`).toBeNull()
                expect(indexedDbCreatableViolation(key), `${key} on IndexedDB`).toBeNull()
            }
        }
        for (const key of [HEAD_KEY, rootKey(GENERATION), keptKey(GENERATION), stubsKey(GENERATION), fixedBlockKey(GENERATION, 'pluginStorage')]) {
            expect(nodeCreatableViolation(key)).toBeNull()
            expect(tauriCreatableViolation(key)).toBeNull()
            expect(indexedDbCreatableViolation(key)).toBeNull()
        }
    })

    test('the segment of a 255-byte chaId is the hashed form and fits the Node key limit with the longest prefix', () => {
        const segment = characterKeySegment('y'.repeat(255))
        expect(segment).toBe(`h${createHash('sha256').update('y'.repeat(255)).digest('hex')}`)
        expect(nodeCreatableViolation(characterBlockKey(GENERATION, 'y'.repeat(255)))).toBeNull()
    })

    test('a short chaId is the lowercase hex of its UTF-8 and the longest hex form fits too', () => {
        expect(characterKeySegment('Ab')).toBe('4162')
        const longest = 'x'.repeat(40)
        expect(characterKeySegment(longest)).toBe(Buffer.from(longest).toString('hex'))
        expect(nodeCreatableViolation(characterBlockKey(GENERATION, longest))).toBeNull()
    })

    test('the empty chaId has a non-empty segment of its own', () => {
        expect(characterKeySegment('')).toBe(`h${createHash('sha256').update('').digest('hex')}`)
    })

    test('a fixed block name never takes the character path', () => {
        expect(ownBlockKey(GENERATION, 'preset')).toBe(fixedBlockKey(GENERATION, 'preset'))
        expect(ownBlockKey(GENERATION, 'root')).toBe(characterBlockKey(GENERATION, 'root'))
    })
})

describe('generation ids', () => {
    test('are valid, sort by creation time and are recognised inside keys', () => {
        const early = newGenerationId({ now: () => 1_700_000_000_000, randomBytes: () => Uint8Array.of(255, 255, 255, 255) })
        const late = newGenerationId({ now: () => 1_700_000_000_001, randomBytes: () => Uint8Array.of(0, 0, 0, 0) })
        expect(isGenerationId(early)).toBe(true)
        expect(early < late).toBe(true)
        expect(generationOfKey(rootKey(early))).toBe(early)
        expect(generationOfKey(HEAD_KEY)).toBeNull()
        expect(generationOfKey('blocks/not-a-generation/root')).toBeNull()
        expect(generationOfKey('assets/x')).toBeNull()
    })
})
