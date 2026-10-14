import type { JsonValue } from '../../blockFrame'
import {
    IL_REF_V, ASSET_REF_V,
    parseAssetList, parseInlayList, parseLegacyList, parseManifest, parseModuleIndex, parseShard,
    type AssetList, type CommitKey, type InlayList, type LegacyList, type ListRef, type Manifest, type ModuleEntry, type Ref, type ShardEntry,
} from '../../store2/format'
import { AssetRefCollector, overflowInlayList } from '../../store2/lists'
import type { AssetKeepSet, ClosureReader, Incomplete, KeepSetResult, NodeRead } from '../../store2/sweep'
import { COMPLETE } from '../../store2/sweep/types'

export * from './listsFixtures'

/**
 * Fixtures of the sweep tests: an in-memory closure whose units go through the
 * real parsers, so a version above known is `unreadable` exactly as in a build.
 */

const KEY_DIGITS = '0123456789abcdefghijklmnopqrstuv'

function digits(n: number, width: number): string {
    let out = ''
    let rest = n
    for (let i = 0; i < width; i++) {
        out = KEY_DIGITS[rest % 32] + out
        rest = Math.floor(rest / 32)
    }
    return out
}

export function unitTail(n: number): string {
    return `u-${digits(n, 26)}`
}

export function manifestKey(n: number): string {
    return `store2/m-${digits(1000, 7)}${digits(n, 19)}`
}

export function refOf(tail: string): Ref {
    return [tail, 10, 1]
}

export function listRefOf(tail: string, v: number = 1): ListRef {
    return [tail, 10, 1, v]
}

export function assetListOf(names: readonly string[]): AssetList {
    const collector = new AssetRefCollector()
    for (const name of names) {
        collector.add(name)
    }
    return collector.toList()
}

export function inlayListOf(ids: { u?: string[], h?: string, o?: string[] }): InlayList {
    return { v: IL_REF_V, u: ids.u ?? [], h: ids.h ?? '', o: ids.o ?? [] }
}

export interface CharacterSpec {
    u: string
    assets?: string[]
    /** Absent: the entry has no inlay list. */
    il?: InlayList
    /** Overrides the asset list body (a stale or newer version). */
    assetList?: AssetList
}

export interface ModuleSpec {
    id: string
    assets?: string[]
    il?: InlayList
}

export interface ManifestSpec {
    config?: string[]
    configAssetList?: AssetList
    configIl?: InlayList
    characters?: CharacterSpec[]
    modules?: ModuleSpec[]
    legacy?: { list: LegacyList, files: { key: string, status: 'ok' | 'unreadable' | 'gone' }[] }
}

function json(value: object): JsonValue {
    return JSON.parse(JSON.stringify(value))
}

/** An in-memory closure: `reader` serves what the tree holds, with per-unit failures and forced results. */
export class Tree {
    private next = 1
    private readonly bodies = new Map<string, JsonValue>()
    private readonly failures = new Map<string, 'missing' | 'crc-failed'>()
    private readonly forced = new Map<string, NodeRead<unknown>>()
    readonly reads = new Map<string, number>()

    private store(body: object): string {
        const tail = unitTail(this.next++)
        this.bodies.set(tail, json(body))
        return tail
    }

    assetList(list: AssetList): ListRef {
        return listRefOf(this.store(list), list.v)
    }

    inlayList(list: InlayList): ListRef {
        return listRefOf(this.store(list), list.v)
    }

    addManifest(spec: ManifestSpec, n: number): string {
        const key = manifestKey(n)
        const entries: ShardEntry[] = (spec.characters ?? []).map(c => ({
            u: c.u, type: 'character', name: c.u, chaId: c.u, creatorNotes: '', chatPage: 0, firstMsgIndex: 0,
            core: refOf(unitTail(0)), lore: null, scripts: null,
            al: this.assetList(c.assetList ?? assetListOf(c.assets ?? [])),
            il: c.il ? this.inlayList(c.il) : null,
            dsp: false, chats: [],
        }))
        const shardTail = this.store({ v: 1, entries })
        const modules: ModuleEntry[] = (spec.modules ?? []).map(m => ({
            id: m.id, unit: refOf(unitTail(0)), al: this.assetList(assetListOf(m.assets ?? [])),
            il: m.il ? this.inlayList(m.il) : null, name: m.id, description: '', hasToggle: false, dsp: false,
        }))
        const indexTail = this.store({ v: 1, entries: modules })
        const dummy = refOf(unitTail(0))
        const manifest: Manifest = {
            fmt: 1, req: [], seq: n, createdAt: 0, shardCount: 1, shards: [refOf(shardTail)],
            fixed: {
                config: dummy,
                configAl: this.assetList(spec.configAssetList ?? assetListOf(spec.config ?? [])),
                il: this.inlayList(spec.configIl ?? inlayListOf({})),
                statics: dummy, order: dummy, loadouts: dummy,
                moduleIndex: refOf(indexTail),
                presets: [], plugins: [], pluginStorage: { buckets: 0, refs: [] },
                legacyKeep: spec.legacy
                    ? { unit: refOf(this.store(spec.legacy.list)), v: spec.legacy.list.v, files: spec.legacy.files }
                    : null,
            },
        }
        this.bodies.set(key, json(manifest))
        return key
    }

    /** Makes the unit a read fails with `status` (a CRC mismatch or a missing unit). */
    fail(tail: string, status: 'missing' | 'crc-failed'): void {
        this.failures.set(tail, status)
    }

    /** Makes a read return `result` as is, bypassing the parser. */
    force(tail: string, result: NodeRead<unknown>): void {
        this.forced.set(tail, result)
    }

    tailOf(ref: Ref): string {
        return ref[0]
    }

    private serve<T>(tail: string, parse: (value: JsonValue) => NodeRead<T>): Promise<NodeRead<T>> {
        this.reads.set(tail, (this.reads.get(tail) ?? 0) + 1)
        const forced = this.forced.get(tail)
        if (forced !== undefined) {
            return Promise.resolve(forced as NodeRead<T>)
        }
        const failure = this.failures.get(tail)
        if (failure !== undefined) {
            return Promise.resolve({ status: failure, reason: `${tail} ${failure}` })
        }
        const body = this.bodies.get(tail)
        if (body === undefined) {
            return Promise.resolve({ status: 'missing', reason: `${tail} is not stored` })
        }
        return Promise.resolve(parse(body))
    }

    readonly reader: ClosureReader = {
        manifest: key => this.serve(key, parseManifest),
        shard: ref => this.serve(ref[0], parseShard),
        moduleIndex: ref => this.serve(ref[0], parseModuleIndex),
        assetList: ref => this.serve(ref[0], parseAssetList),
        inlayList: ref => this.serve(ref[0], parseInlayList),
        legacyList: ref => this.serve(ref[0], parseLegacyList),
    }
}

export function commitKeyOf(over: Omit<Partial<CommitKey>, 'current'> & { current?: string | null } = {}): CommitKey {
    const { current, ...rest } = over
    return {
        fmt: 1, req: [], seq: 1, epoch: '0'.repeat(26),
        current: current === null ? null : { key: current ?? manifestKey(1), at: 0 },
        retained: [], pins: [], staging: null, convertedFrom: null, convertedAt: null,
        ...rest,
    }
}

export function legacyListOf(over: Partial<LegacyList> = {}): LegacyList {
    return { v: ASSET_REF_V, iv: IL_REF_V, files: [], h: '', l: [], i: inlayListOf({}), ...over }
}

export { overflowInlayList }

/** A complete asset keep-set holding exactly `names`, for the decision tests that take one; real sets come from the builder. */
export function keepHolding(...names: string[]): AssetKeepSet {
    return { [COMPLETE]: true, holds: name => names.includes(name) }
}

/** The reasons of an incomplete result, none for a complete one (the harness has no strict null checks, so a complete test does not narrow). */
export function reasonsOf(result: KeepSetResult<unknown>): Incomplete[] {
    return result.status === 'incomplete' ? result.reasons : []
}

export function reasonCodes(result: KeepSetResult<unknown>): string[] {
    return reasonsOf(result).map(reason => reason.code)
}
