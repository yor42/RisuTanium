// @vitest-environment node
/**
 * The recovery screen's candidate list and offers: decided by key form and
 * values alone. The listing runs over the memory backend, which is the
 * reference for what `listStore2` returns; no body is ever read.
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, Store2BackendFailureError } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newStagingId, stagingPrefix, timeDigits, UNIT_TYPE, type CommitKey } from 'src/ts/storage/store2/format'
import {
    candidatePage, CANDIDATE_PAGE_SIZE, listRecoveryCandidates, recoveryCandidates, screenOffers,
} from 'src/ts/storage/store2/recovery'
import { createClock, testEnv } from './commitFixtures'
import { plantUnit, traced } from './fenceFixtures'

const STAGE_A = '0123456789abcdef'
const STAGE_B = 'fedcba9876543210'

function manifestKey(seconds: number, filler = '0'): string {
    return `store2/m-${timeDigits(seconds)}${filler.repeat(19)}`
}

function stagedManifestKey(stage: string, seconds: number, filler = '0'): string {
    return `store2/g-${stage}-m${timeDigits(seconds)}${filler.repeat(9)}`
}

function stagedUnitKey(stage: string): string {
    return `store2/g-${stage}-u${'0'.repeat(16)}`
}

function parsedWithStaging(prefix: string | null): ReturnType<typeof classifyCommitRead> {
    const env = testEnv(createClock(), 1)
    const key: CommitKey = firstCommitKey({
        current: null,
        staging: prefix === null ? null : { owner: '0'.repeat(26), prefix, startedAt: 1, label: 'recovery' },
    }, env)
    return classifyCommitRead({ bytes: encodeUnit(UNIT_TYPE.commit, key) })
}

describe('recovery candidates', () => {
    test('both shapes are listed newest first across a time-digit boundary', () => {
        // 31 seconds is "0000000v", 32 is "00000010": a plain string sort of the digits is a time sort.
        const older = manifestKey(31)
        const newerStaged = stagedManifestKey(STAGE_A, 32)
        const oldest = stagedManifestKey(STAGE_B, 5)
        const newest = manifestKey(40_000)
        const listing = [oldest, older, newest, newerStaged]
        expect(recoveryCandidates(listing, { status: 'absent' })).toEqual([newest, newerStaged, older, oldest])
    })

    test('only manifests are offered: shards, units, staged units and malformed keys are not', () => {
        const manifest = manifestKey(100)
        const listing = [
            manifest,
            `store2/s-${'0'.repeat(26)}`,
            `store2/u-${'0'.repeat(26)}`,
            stagedUnitKey(STAGE_A),
            'store2/m-short',
            `store2/g-${STAGE_A}-m${'0'.repeat(3)}`,
            'store2/readme',
        ]
        expect(recoveryCandidates(listing, { status: 'absent' })).toEqual([manifest])
    })

    test('a staged manifest under the standing prefix is not offered, one under another prefix is', () => {
        const standing = stagedManifestKey(STAGE_A, 500)
        const other = stagedManifestKey(STAGE_B, 400)
        const plain = manifestKey(300)
        const commit = parsedWithStaging(stagingPrefix(STAGE_A))
        expect(commit.status).toBe('parsed')
        expect(recoveryCandidates([standing, other, plain], commit)).toEqual([other, plain])
    })

    test('a parsed key without a marker excludes nothing', () => {
        const staged = stagedManifestKey(STAGE_A, 500)
        expect(recoveryCandidates([staged], parsedWithStaging(null))).toEqual([staged])
    })

    test('an unparsable commit key excludes nothing, a staged manifest included', () => {
        const staged = stagedManifestKey(STAGE_A, 500)
        const plain = manifestKey(300)
        const damaged = classifyCommitRead({ bytes: Uint8Array.from([1, 2, 3, 4]) })
        expect(damaged.status).toBe('damaged')
        expect(recoveryCandidates([plain, staged], damaged)).toEqual([staged, plain])
    })

    test('the listing is the only backend call: no unit body is read', async () => {
        const inner = createMemoryBackend()
        await plantUnit(inner, manifestKey(10), Uint8Array.from([1]))
        await plantUnit(inner, stagedManifestKey(STAGE_A, 20), Uint8Array.from([2]))
        const recorded = traced(inner)
        const listing = await listRecoveryCandidates(recorded.backend, { status: 'absent' })
        expect(listing).toEqual({ status: 'listed', candidates: [stagedManifestKey(STAGE_A, 20), manifestKey(10)] })
        expect(recorded.log).toEqual(['listStore2'])
    })

    test('a failed listing is reported, never read as no candidates', async () => {
        const recorded = traced(createMemoryBackend(), { failList: true })
        const listing = await listRecoveryCandidates(recorded.backend, { status: 'absent' })
        expect(listing.status).toBe('failed')
        if (listing.status === 'failed') {
            expect(listing.cause).toBeInstanceOf(Store2BackendFailureError)
        }
    })
})

describe('candidate pages', () => {
    const ordered = Array.from({ length: 120 }, (_, i) => manifestKey(1000 - i))

    test('the newest 50 come first and "older" continues to the end', () => {
        const first = candidatePage(ordered)
        expect(CANDIDATE_PAGE_SIZE).toBe(50)
        expect(first.keys).toEqual(ordered.slice(0, 50))
        expect(first.nextOffset).toBe(50)
        const second = candidatePage(ordered, first.nextOffset ?? 0)
        expect(second.keys).toEqual(ordered.slice(50, 100))
        const third = candidatePage(ordered, second.nextOffset ?? 0)
        expect(third.keys).toEqual(ordered.slice(100))
        expect(third.nextOffset).toBeNull()
    })

    test('exactly one page has no continuation', () => {
        expect(candidatePage(ordered.slice(0, 50)).nextOffset).toBeNull()
        expect(candidatePage([]).keys).toEqual([])
    })
})

describe('screen offers', () => {
    const base = { tooNew: false, candidateCount: 3, upstreamMainFile: false, candidatePassed: false }

    test('the initial state offers a pick, the .bin import and a fresh start, and no conversion without an upstream file', () => {
        expect(screenOffers(base)).toEqual({ readOnly: false, pick: true, convert: false, import: true, freshStart: true })
    })

    test('with an upstream main file and no candidate validated, conversion, import and a fresh start are all offered', () => {
        const offers = screenOffers({ ...base, upstreamMainFile: true })
        expect(offers).toMatchObject({ convert: true, import: true, freshStart: true })
    })

    test('the .bin import is offered while candidates exist and after one passed', () => {
        expect(screenOffers(base).import).toBe(true)
        expect(screenOffers({ ...base, candidatePassed: true }).import).toBe(true)
        expect(screenOffers({ ...base, candidateCount: 0 }).import).toBe(true)
    })

    test('a fresh start is withdrawn once a candidate passed validation in this session', () => {
        expect(screenOffers({ ...base, candidatePassed: true }).freshStart).toBe(false)
    })

    test('the conversion is offered only while an upstream main file is known to exist', () => {
        expect(screenOffers({ ...base, upstreamMainFile: true }).convert).toBe(true)
        expect(screenOffers({ ...base, upstreamMainFile: null }).convert).toBe(false)
        expect(screenOffers({ ...base, upstreamMainFile: false }).convert).toBe(false)
    })

    test('no candidates offers no pick', () => {
        expect(screenOffers({ ...base, candidateCount: 0 }).pick).toBe(false)
    })

    test('a too-new state is read-only and offers nothing', () => {
        expect(screenOffers({ ...base, tooNew: true, upstreamMainFile: true })).toEqual({
            readOnly: true, pick: false, convert: false, import: false, freshStart: false,
        })
    })
})

describe('staging ids', () => {
    test('a generated prefix is a standing-prefix shape', () => {
        const prefix = stagingPrefix(newStagingId(testEnv(createClock(), 3)))
        expect(prefix).toMatch(/^store2\/g-[0-9a-v]{16}-$/)
    })
})
