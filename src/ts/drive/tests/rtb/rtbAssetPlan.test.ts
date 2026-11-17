// @vitest-environment node
/**
 * The asset and inlay plan of a `.rtb` restore (CHORE-128 S11, P.2), over a real writer file's directory and fake store
 * calls. Every store call is injected, so the tests also state what the plan may ask of a store: one sized listing and
 * nothing else.
 *
 * Labels: compatibility guards of a new contract (no pre-fix base); each turns red on a named scratch mutant.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { assetEntryName } from 'src/ts/drive/rtb/assetName'
import { creatableViolation, nodeLimits, planAssets, type AssetPlanDeps, type CreatableRule, type SizedListing } from 'src/ts/drive/rtb/rtbAssetPlan'
import { verifyRtb, type VerifiedRtb } from 'src/ts/drive/rtb/rtbVerify'
import { rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { inlayFixture, writeRtbFile } from './rtbRestoreFixtures'
import { rangeSourceOfBytes } from './sparseSource'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const encoder = new TextEncoder()
const HASH = `${'a1'.repeat(32)}.png`
const HASH_OTHER = `${'b2'.repeat(32)}.png`
const LITERAL = 'logo.png'
const LITERAL_OTHER = 'sub/Banner.png'
const NODE_LONG = `${'n'.repeat(118)}.png`
const TAURI_DOT = 'trailing.'
const IDB_DOT = '.hidden'
const INLAY_A = '0123abcd-0123-4123-a123-0123456789ab'
const INLAY_B = '0123abcd-0123-4123-a123-0123456789cd'

let world: RtbWorld
let ok: VerifiedRtb

const assets: Record<string, Uint8Array> = {
    [HASH]: encoder.encode('hash-body'),
    [HASH_OTHER]: encoder.encode('other-hash-body'),
    [LITERAL]: encoder.encode('literal-body'),
    [LITERAL_OTHER]: encoder.encode('banner-body'),
    [NODE_LONG]: encoder.encode('long-name'),
    [TAURI_DOT]: encoder.encode('dot-end'),
    [IDB_DOT]: encoder.encode('dot-start'),
}

beforeAll(async () => {
    world = await rtbWorld({ layout: 1 })
    const file = await writeRtbFile({
        world,
        assets,
        inlays: [inlayFixture(INLAY_A, 'small'), inlayFixture(INLAY_B, 'a-much-longer-inlay-body-of-forty-bytes!!')],
    })
    const verdict = await verifyRtb(rangeSourceOfBytes(file.bytes))
    if (verdict.kind !== 'ok') {
        throw new Error(`the fixture file is ${verdict.kind}`)
    }
    ok = verdict.verified
})

const sizeOf = (key: string): number => assets[key].length

interface Stub {
    deps: AssetPlanDeps
    calls: string[]
}

function stub(over: Omit<Partial<AssetPlanDeps>, 'rule'> & { rule?: CreatableRule, listing?: SizedListing | null | Error } = {}): Stub {
    const calls: string[] = []
    const { rule, listing, ...rest } = over
    const deps: AssetPlanDeps = {
        isNodeStore: () => false,
        probePieceStore: async () => { calls.push('probe') },
        assetLimit: () => Number.MAX_SAFE_INTEGER,
        inlayLimit: () => Number.MAX_SAFE_INTEGER,
        rule: async () => rule ?? { kind: 'indexeddb', platform: 'posix' },
        sizedListing: async () => {
            calls.push('listing')
            if (listing instanceof Error) {
                throw listing
            }
            return listing ?? null
        },
        ...rest,
    }
    return { deps, calls }
}

const namesOfCopy = (plan: { copy: Uint32Array }): string[] => Array.from(plan.copy, (entry) => ok.index.name(entry))

describe('uncreatable names (T9)', () => {
    test('each store\'s own rule names a key it cannot create, and an uncreatable key is listed there only (guard; MS10 fails it)', async () => {
        const node = await planAssets(ok.index, ok.inlays, stub({ rule: { kind: 'node', platform: 'posix' }, isNodeStore: () => true, assetLimit: () => 4, probePieceStore: async () => { } }).deps)
        expect(node.assets.uncreatable.map((item) => item.key)).toContain(NODE_LONG)
        const tauri = await planAssets(ok.index, ok.inlays, stub({ rule: { kind: 'tauri', platform: 'posix' } }).deps)
        // a segment that starts with a dot is refused by every store; one that ends with a dot only by the desktop's
        expect(tauri.assets.uncreatable.map((item) => item.key).sort()).toEqual([IDB_DOT, TAURI_DOT].sort())
        const idb = await planAssets(ok.index, ok.inlays, stub({ rule: { kind: 'indexeddb', platform: 'posix' } }).deps)
        expect(idb.assets.uncreatable.map((item) => item.key)).toEqual([IDB_DOT])
        // excluded from the copy, and a key that is also oversize is listed as uncreatable only
        expect(namesOfCopy(idb.assets)).not.toContain(assetEntryName(IDB_DOT))
        expect(node.assets.oversize.map((item) => item.key)).not.toContain(NODE_LONG)
        expect(node.assets.oversize.length).toBeGreaterThan(0)
    })

    test('the rule is the store\'s pre-write predicate for the key under assets/ (guard)', () => {
        expect(creatableViolation({ kind: 'node', platform: 'posix' }, `assets/${NODE_LONG}`)).not.toBeNull()
        expect(creatableViolation({ kind: 'node', platform: 'posix' }, `assets/${LITERAL}`)).toBeNull()
        expect(creatableViolation({ kind: 'tauri', platform: 'windows' }, `assets/${TAURI_DOT}`)).not.toBeNull()
        expect(creatableViolation({ kind: 'opfs-transitional', platform: 'posix' }, `assets/${IDB_DOT}`)).not.toBeNull()
    })
})

describe('skip modes (T10)', () => {
    const listing = (items: [string, number][]): SizedListing => ({ kind: 'node-sized', items: items.map(([key, size]) => ({ key: `assets/${key}`, size })) })

    test('a hash name of equal size is present; other sizes, literals and absent names are copied (guard; MS11 fails the size row)', async () => {
        const { deps, calls } = stub({
            listing: listing([
                [HASH, sizeOf(HASH)],
                [HASH_OTHER, sizeOf(HASH_OTHER) + 1],
                [LITERAL, sizeOf(LITERAL)],
                [LITERAL_OTHER, sizeOf(LITERAL_OTHER) + 1],
            ]),
        })
        const { assets: plan } = await planAssets(ok.index, ok.inlays, deps)
        const copied = new Map(Array.from(plan.copy, (entry, i) => [ok.index.name(entry), plan.mode[i]]))
        expect(plan.present).toBe(1)
        expect(copied.has(assetEntryName(HASH))).toBe(false)
        expect(copied.get(assetEntryName(HASH_OTHER))).toBe(0)
        expect(copied.get(assetEntryName(LITERAL))).toBe(1)
        expect(copied.get(assetEntryName(LITERAL_OTHER))).toBe(0)
        expect(plan.listing).toBe('node-sized')
        expect(calls.filter((call) => call === 'listing')).toHaveLength(1)
    })

    test('no listing, a null listing and a failing listing all write every asset, and a failure is logged (guard)', async () => {
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => { })
        for (const listingCase of [null, new Error('listing failed')]) {
            const { assets: plan } = await planAssets(ok.index, ok.inlays, stub({ listing: listingCase }).deps)
            expect(plan.listing).toBe('none')
            expect(plan.present).toBe(0)
            expect(Array.from(plan.mode).every((mode) => mode === 0)).toBe(true)
        }
        expect(quiet).toHaveBeenCalledTimes(1)
        quiet.mockRestore()
    })

    test('the plan holds typed arrays of at most five bytes per copied asset and no listing (guard)', async () => {
        const { assets: plan } = await planAssets(ok.index, ok.inlays, stub({ listing: listing([[HASH, sizeOf(HASH)]]) }).deps)
        expect(plan.copy.byteLength + plan.mode.byteLength).toBe(5 * plan.copy.length)
        expect(Object.keys(plan).sort()).toEqual(['copy', 'copyBytes', 'limit', 'listing', 'mode', 'oversize', 'present', 'uncreatable'])
    })
})

describe('Node limits and oversize (T11)', () => {
    /** A Node store whose asset limit depends on the recorded piece capability, as `storeAssetLimitBytes` does. */
    function nodeStub(): Stub & { recorded: () => boolean } {
        let recorded = false
        const made = stub({
            isNodeStore: () => true,
            // The capability is recorded only after the probe's reply: a limit read before it has settled sees the smaller one.
            probePieceStore: async () => {
                await Promise.resolve()
                recorded = true
            },
            assetLimit: () => recorded ? 1000 : 10,
            inlayLimit: () => recorded ? 1000 : 10,
        })
        return { ...made, recorded: () => recorded }
    }

    test('the limit is read after the piece-store probe: bodies the probed limit takes are not named (guard; MS13 fails it)', async () => {
        const made = nodeStub()
        const { assets: plan, inlays } = await planAssets(ok.index, ok.inlays, made.deps)
        expect(made.recorded()).toBe(true)
        expect(plan.limit).toBe(1000)
        expect(inlays.limit).toBe(1000)
        expect(plan.oversize).toEqual([])
        expect(inlays.oversize).toEqual([])
    })

    test('items over the limits are named, are left out of the copy and its sizes, and no limit applies off Node (guard)', async () => {
        const made = stub({ isNodeStore: () => true, assetLimit: () => 12, inlayLimit: () => 20 })
        const { assets: plan, inlays } = await planAssets(ok.index, ok.inlays, made.deps)
        expect(plan.oversize.map((item) => item.key)).toEqual([HASH_OTHER])
        expect(plan.limit).toBe(12)
        expect(inlays.oversize.map((pair) => pair.id)).toEqual([INLAY_B])
        expect(inlays.copy.map((pair) => pair.id)).toEqual([INLAY_A])
        expect(inlays.copyBytes).toBe(encoder.encode('small').length)
        const off = await planAssets(ok.index, ok.inlays, stub().deps)
        expect(off.assets.limit).toBeNull()
        expect(off.assets.oversize).toEqual([])
        expect(off.inlays.limit).toBeNull()
    })

    test('a limit that changes between two runs changes the outcome, because it is never cached (guard)', async () => {
        let limit = 1000
        const deps = stub({ isNodeStore: () => true, assetLimit: () => limit, inlayLimit: () => limit }).deps
        expect((await planAssets(ok.index, ok.inlays, deps)).assets.oversize).toEqual([])
        limit = 5
        expect((await planAssets(ok.index, ok.inlays, deps)).assets.oversize.length).toBeGreaterThan(0)
    })

    test('nodeLimits asks nothing of a store that is not the Node server (guard)', async () => {
        const made = stub()
        expect(await nodeLimits(made.deps)).toBeNull()
        expect(made.calls).toEqual([])
    })
})

describe('scale figures (T12, plan part)', () => {
    test('copied bytes count write and compare items and inlays; present, oversize and uncreatable items are excluded (guard)', async () => {
        const listing: SizedListing = { kind: 'node-sized', items: [{ key: `assets/${HASH}`, size: sizeOf(HASH) }, { key: `assets/${LITERAL}`, size: sizeOf(LITERAL) }] }
        const { assets: plan, inlays } = await planAssets(ok.index, ok.inlays, stub({ listing, rule: { kind: 'indexeddb', platform: 'posix' } }).deps)
        const expected = Object.entries(assets).filter(([key]) => key !== HASH && key !== IDB_DOT).reduce((sum, [, bytes]) => sum + bytes.length, 0)
        expect(plan.copyBytes).toBe(expected)
        expect(plan.copy.length).toBe(Object.keys(assets).length - 2)
        expect(inlays.copy.length).toBe(2)
        expect(inlays.copyBytes).toBe(encoder.encode('small').length + encoder.encode('a-much-longer-inlay-body-of-forty-bytes!!').length)
    })
})
