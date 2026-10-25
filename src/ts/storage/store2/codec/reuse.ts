import { encodeUnit, newManifestKey, newShardKey, newUnitKey, readRef, refOfFrame, UNIT_TYPE, type KeyEnv, type UnitType } from '../format'
import { Sha256 } from '../../../assetHash'
import { MEASURE } from '../../../process/memory/measureFlag'
import type { KeyMint } from '../commit'
import {
    CodecError, isWrittenUnit,
    type EncodedTree, type EncodedUnit, type PreviousEncoding, type ReusableUnit, type SplitRecorder, type WrittenUnit,
} from './types'

/** Which key shape a new unit gets. */
export type UnitKeyKind = 'unit' | 'shard' | 'manifest'

const KEY_ATTEMPTS = 8

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/** Hex digits of the SHA-256 kept as a unit's digest: 128 bits. */
const DIGEST_HEX_LENGTH = 32

/** The collision-resistant digest reuse compares: the first 128 bits of the SHA-256 of the framed bytes. */
export function unitDigest(bytes: Uint8Array): string {
    return new Sha256().update(bytes).digestHex().slice(0, DIGEST_HEX_LENGTH)
}

/**
 * Whether `bytes` is the unit `prior` describes: the same type, framed length,
 * payload CRC and digest. A Ref's CRC verifies the bytes of a known key; it does
 * not prove two contents equal, so a prior unit with no digest is never reused.
 * When the previous bytes were kept (only a written unit's are, see `previousFrom`) the comparison is also byte for byte.
 */
function isSameUnit(prior: ReusableUnit, type: UnitType, bytes: Uint8Array, digest: string): boolean {
    if (prior.type !== type || prior.digest === undefined) {
        return false
    }
    const fresh = readRef(refOfFrame(prior.key, bytes))
    if (prior.ref[1] !== fresh.bytes || prior.ref[2] !== fresh.crc) {
        return false
    }
    if (prior.digest !== digest) {
        return false
    }
    return prior.bytes === undefined || sameBytes(prior.bytes, bytes)
}

/** A reuse-only sink met a unit that is not the previous encoding's: the encode stops there. */
export class UnitNotReusedError extends CodecError {
    constructor(public readonly identity: string) {
        super('input', `The unit "${identity}" is not the previous encoding's unit.`)
        this.name = 'UnitNotReusedError'
    }
}

export interface UnitSinkOptions {
    /**
     * The sink only checks reuse: it copies no key of the previous encoding (its cost would grow with every unit of the
     * profile) and throws `UnitNotReusedError` at the first unit that is not reused. It never hands out a key.
     */
    reuseOnly?: boolean
    /** Measurement builds only: counts each put and the time its framing and digest take. */
    split?: SplitRecorder
}

/**
 * Collects the units of one encode. A unit whose bytes equal the previous
 * encoding's unit at the same identity keeps that unit's key and is flagged
 * `reused`, so a change that leaves a unit unchanged writes no bytes for it;
 * every other unit gets a fresh key.
 */
export class UnitSink {
    readonly units: EncodedUnit[] = []
    private readonly identities = new Set<string>()
    private readonly keys = new Set<string>()
    private readonly reuseOnly: boolean
    private declare readonly split: SplitRecorder | undefined

    constructor(
        private readonly env: KeyEnv,
        private readonly previous: PreviousEncoding | null,
        private readonly mint?: KeyMint,
        options: UnitSinkOptions = {},
    ) {
        this.reuseOnly = options.reuseOnly === true
        if (MEASURE && options.split !== undefined) {
            this.split = options.split
        }
        if (previous !== null && !this.reuseOnly) {
            for (const unit of previous.units.values()) {
                this.keys.add(unit.key)
            }
        }
    }

    private freshKey(kind: UnitKeyKind): string {
        for (let attempt = 0; attempt < KEY_ATTEMPTS; attempt++) {
            const key = this.mint !== undefined
                ? (kind === 'shard' ? this.mint.shard() : kind === 'manifest' ? this.mint.manifest() : this.mint.unit())
                : (kind === 'shard' ? newShardKey(this.env) : kind === 'manifest' ? newManifestKey(this.env) : newUnitKey(this.env))
            if (!this.keys.has(key)) {
                return key
            }
        }
        throw new CodecError('input', 'The key generator returned only keys that are already in use.')
    }

    /** Frames `body` as a unit of `type` at `identity`, reusing the previous key when the bytes are unchanged. */
    put(identity: string, type: UnitType, body: object, kind: UnitKeyKind = 'unit'): EncodedUnit {
        const started = MEASURE && this.split !== undefined ? this.split.now() : 0
        const bytes = encodeUnit(type, body)
        const framed = MEASURE && this.split !== undefined ? this.split.now() : 0
        const digest = unitDigest(bytes)
        if (MEASURE && this.split !== undefined) {
            this.split.splitUnitCost(framed - started, this.split.now() - framed)
        }
        const prior = this.previous?.units.get(identity)
        if (prior !== undefined && isSameUnit(prior, type, bytes, digest)) {
            return this.record(identity, type, prior.key, bytes, digest, true)
        }
        if (this.reuseOnly) {
            throw new UnitNotReusedError(identity)
        }
        return this.record(identity, type, this.freshKey(kind), bytes, digest, false)
    }

    /** A write-once unit (the manifest): always a fresh key. */
    putFresh(identity: string, type: UnitType, body: object, kind: UnitKeyKind): EncodedUnit {
        if (this.reuseOnly) {
            throw new UnitNotReusedError(identity)
        }
        const started = MEASURE && this.split !== undefined ? this.split.now() : 0
        const bytes = encodeUnit(type, body)
        const framed = MEASURE && this.split !== undefined ? this.split.now() : 0
        const digest = unitDigest(bytes)
        if (MEASURE && this.split !== undefined) {
            this.split.splitUnitCost(framed - started, this.split.now() - framed)
        }
        return this.record(identity, type, this.freshKey(kind), bytes, digest, false)
    }

    private record(identity: string, type: UnitType, key: string, bytes: Uint8Array, digest: string, reused: boolean): EncodedUnit {
        if (this.identities.has(identity)) {
            throw new CodecError('input', `The unit identity "${identity}" is used twice in one encode.`)
        }
        this.identities.add(identity)
        this.keys.add(key)
        const ref = refOfFrame(key, bytes)
        // A reused unit drops the frame here: the tree outlives the pass's `put` calls and must not pin it.
        const unit: EncodedUnit = reused
            ? { identity, key, type, ref, digest, reused: true }
            : { identity, key, type, bytes, ref, digest, reused: false }
        this.units.push(unit)
        return unit
    }
}

/** The units an encode must write: the new ones. The manifest is always new, so it is part of the answer. */
export function unitsToWrite(tree: EncodedTree): WrittenUnit[] {
    return tree.units.filter(isWrittenUnit)
}

/** Whether no unit but the (always new) manifest needs writing: the encoded state equals the previous one. */
export function isUnchanged(tree: EncodedTree): boolean {
    return tree.units.every(unit => unit.reused || unit.type === UNIT_TYPE.manifest)
}

/**
 * The `previous` of the next encode. `keepBytes` retains the bytes of the units the
 * encode wrote, for a byte-for-byte comparison, at the memory cost of holding them.
 * A reused unit holds no bytes, so it is compared again by type, Ref and digest
 * only, as every unit is without `keepBytes`.
 */
export function previousFrom(tree: EncodedTree, keepBytes = false): PreviousEncoding {
    // `index.units` also holds the units a scoped encode carried without encoding them; they have no bytes to keep.
    const units = new Map<string, ReusableUnit>(tree.index.units)
    for (const unit of tree.units) {
        units.set(unit.identity, keepBytes && unit.reused === false
            ? { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest, bytes: unit.bytes }
            : { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest })
    }
    return { units, entities: tree.index.entities, objects: tree.index.objects }
}
