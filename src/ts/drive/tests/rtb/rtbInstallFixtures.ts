/**
 * Fixtures of the `.rtb` restore copy stage (CHORE-128 S12a-1): an in-memory byte store that logs every call and keeps a
 * piece writer's value invisible until `finish` (the contract's semantics), and a plan built from a real writer file by
 * S11's own verification and asset planning.
 *
 * Producer-built: the file (`writeRtbFile` over `writeRtb`), its directory, `verifyRtb` and `planAssets`.
 * Hand-made: the store, its failure hooks, the listing and the platform limits the plan is asked with.
 */
import { planAssets, type AssetPlanDeps, type CreatableRule, type SizedListing } from 'src/ts/drive/rtb/rtbAssetPlan'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import type { RangeSource } from 'src/ts/drive/rtb/rangeSource'
import type { RtbCopyPlan } from 'src/ts/drive/rtbRestoreCopy'
import type { ByteStore, PieceWriter, ReadResult, StoreCondition, WriteResult } from 'src/ts/storage/store/contract'
import { rangeSourceOfBytes } from './sparseSource'

export interface MemoryStoreOptions {
    /** False leaves `openWriter` out, as the transitional store does. */
    writer?: boolean
    /** An error to throw from `write` of this key, or null. */
    failWrite?: (key: string) => Error | null
    /** An error to throw from the n-th `write` of a piece writer opened for `key`, or null. */
    failPiece?: (key: string, piece: number) => Error | null
    /** An error to throw when a writer is opened for `key`, or null. */
    failOpen?: (key: string) => Error | null
    /** An error to throw from `read` of this key, or null. */
    failRead?: (key: string) => Error | null
}

/** A `ByteStore` over a map. `log` records every call as `call:key`. */
export class MemoryByteStore implements ByteStore {
    readonly capabilities = { conditionalWrites: false }
    readonly files = new Map<string, Uint8Array>()
    readonly log: string[] = []
    openWriter?: (key: string) => PieceWriter

    constructor(private readonly options: MemoryStoreOptions = {}, seed: Readonly<Record<string, Uint8Array>> = {}) {
        for (const [key, bytes] of Object.entries(seed)) {
            this.files.set(key, bytes.slice())
        }
        if (options.writer !== false) {
            this.openWriter = (key) => this.open(key)
        }
    }

    async read(key: string): Promise<ReadResult> {
        this.log.push(`read:${key}`)
        const failure = this.options.failRead?.(key) ?? null
        if (failure !== null) {
            throw failure
        }
        const held = this.files.get(key)
        return { bytes: held === undefined ? null : held.slice(), version: null }
    }

    async write(key: string, bytes: Uint8Array, _condition: StoreCondition): Promise<WriteResult> {
        this.log.push(`write:${key}`)
        const failure = this.options.failWrite?.(key) ?? null
        if (failure !== null) {
            throw failure
        }
        this.files.set(key, bytes.slice())
        return { version: null }
    }

    async delete(key: string, _condition: StoreCondition): Promise<void> {
        this.log.push(`delete:${key}`)
        this.files.delete(key)
    }

    async deleteMany(entries: readonly { key: string }[]): Promise<void> {
        for (const entry of entries) {
            this.log.push(`delete:${entry.key}`)
            this.files.delete(entry.key)
        }
    }

    async list(prefix: string): Promise<string[]> {
        return [...this.files.keys()].filter((key) => key.startsWith(prefix))
    }

    async has(key: string): Promise<boolean> {
        return this.files.has(key)
    }

    private open(key: string): PieceWriter {
        this.log.push(`open:${key}`)
        const failure = this.options.failOpen?.(key) ?? null
        if (failure !== null) {
            throw failure
        }
        const pieces: Uint8Array[] = []
        let ended = false
        return {
            write: async (data) => {
                const piece = pieces.length
                const broken = this.options.failPiece?.(key, piece) ?? null
                if (broken !== null) {
                    throw broken
                }
                this.log.push(`piece:${key}`)
                pieces.push(data.slice())
            },
            finish: async (finalKey) => {
                this.log.push(`finish:${key}`)
                const total = pieces.reduce((sum, piece) => sum + piece.length, 0)
                const whole = new Uint8Array(total)
                let at = 0
                for (const piece of pieces) {
                    whole.set(piece, at)
                    at += piece.length
                }
                this.files.set(finalKey ?? key, whole)
                ended = true
            },
            abort: async () => {
                if (!ended) {
                    this.log.push(`abort:${key}`)
                }
            },
        }
    }
}

export interface PlanOptions {
    /** The target's sized listing the plan skips against; none by default. */
    listing?: SizedListing | null
    rule?: CreatableRule
    /** Makes the plan a Node page's: the asset limit and the inlay limit. */
    node?: { assetLimit: number, inlayLimit: number }
    /** Wraps the source the plan reads through (a logging or failing source). */
    source?: (bytes: Uint8Array) => RangeSource
}

/** The `.rtb` bytes, verified and planned the way `prepareRtbRestore` does, as the part of the plan the copy reads. */
export async function planOfBytes(bytes: Uint8Array, options: PlanOptions = {}): Promise<RtbCopyPlan> {
    const source = options.source?.(bytes) ?? rangeSourceOfBytes(bytes)
    const verdict = await verifyRtb(source)
    if (verdict.kind !== 'ok') {
        throw new Error(`the fixture file is ${verdict.kind}`)
    }
    const deps: AssetPlanDeps = {
        isNodeStore: () => options.node !== undefined,
        probePieceStore: async () => { },
        assetLimit: () => options.node?.assetLimit ?? Number.MAX_SAFE_INTEGER,
        inlayLimit: () => options.node?.inlayLimit ?? Number.MAX_SAFE_INTEGER,
        rule: async () => options.rule ?? { kind: 'indexeddb', platform: 'posix' },
        sizedListing: async () => options.listing ?? null,
    }
    const { assets, inlays } = await planAssets(verdict.verified.index, verdict.verified.inlays, deps)
    return { source, index: verdict.verified.index, assets, inlays }
}
