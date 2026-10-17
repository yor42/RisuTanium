import type { JsonObject, JsonValue } from '../../blockFrame'
import type { AssetList, InlayList, KeyEnv, Manifest, ModuleIndex, Ref, Shard, UnitType } from '../format'
import type { KeyMint } from '../commit'

/**
 * Shared types of the unit codec: the pure translation between a `Database`
 * and the store2 units. Nothing here reads or writes storage.
 */

export type CodecErrorCode = 'stub' | 'input' | 'assemble'

export class CodecError extends Error {
    constructor(public readonly code: CodecErrorCode, message: string) {
        super(message)
        this.name = 'CodecError'
    }
}

/**
 * A cold-stub character, or a chat that is still a cold-storage pointer, was
 * offered to the encoder. Encoding it would persist a placeholder in place of
 * the data it stands for, so the encoder refuses (I9).
 */
export class StubRefusedError extends CodecError {
    constructor(
        public readonly kind: 'character' | 'chat',
        public readonly chaId: string,
        public readonly chatIndex: number | null,
    ) {
        super('stub', kind === 'character'
            ? `Character ${chaId} is a cold-storage stub and cannot be encoded.`
            : `Chat ${chatIndex} of character ${chaId} is a cold-storage pointer and cannot be encoded.`)
        this.name = 'StubRefusedError'
    }
}

/** The database holds a shape the codec cannot store without losing or inventing data. */
export class CodecInputError extends CodecError {
    constructor(message: string) {
        super('input', message)
        this.name = 'CodecInputError'
    }
}

/**
 * A cold-stub character shares its `chaId` with another character, so the shard entry it stands for cannot be told
 * from the other holder's. A stub has no body to encode instead; the pass is refused until the ambiguity clears.
 */
export class SharedChaIdStubError extends CodecInputError {
    constructor(public readonly chaId: string) {
        super(`The character id ${chaId} is held by more than one character, so its stub cannot be matched to the entry it stands for.`)
        this.name = 'SharedChaIdStubError'
    }
}

/** The units do not describe a database: a missing unit, a Ref that does not match its bytes, or a body of the wrong shape. */
export class CodecAssembleError extends CodecError {
    constructor(message: string) {
        super('assemble', message)
        this.name = 'CodecAssembleError'
    }
}

/** One framed unit an encode produced; `reused` units hold the previous encoding's key and are not written again. */
export interface EncodedUnit {
    /** Stable name of the unit's place in the tree; the reuse lookup key. */
    identity: string
    key: string
    type: UnitType
    bytes: Uint8Array
    ref: Ref
    /** Collision-resistant digest of the framed bytes (`unitDigest`); the Ref's CRC alone cannot tell two contents apart. */
    digest: string
    reused: boolean
}

/**
 * What a later encode needs to know about one unit of an earlier one. A unit is
 * reused only when its `digest` is present and equal to the new bytes' digest;
 * `bytes`, when kept, add a byte-for-byte comparison.
 */
export interface ReusableUnit {
    key: string
    type: UnitType
    ref: Ref
    digest?: string
    bytes?: Uint8Array
}

/**
 * The format objects of the earlier encoding, parsed. Their fields this build
 * does not know are carried onto the objects the next encode writes, matched by
 * stable identity (shard index, entry `u`, chat `cid`, module handle).
 */
export interface PreviousObjects {
    manifest?: Manifest
    /** The shard bodies by shard index. */
    shards?: readonly Shard[]
    moduleIndex?: ModuleIndex
}

/** The earlier encoding a new encode reuses keys from. */
export interface PreviousEncoding {
    units: ReadonlyMap<string, ReusableUnit>
    /** Character handle (`<chaId>#<occurrence>`) to the entity id `u` minted for it. */
    entities: ReadonlyMap<string, string>
    /** The parsed previous format objects whose unknown fields are carried; absent when there are none to carry. */
    objects?: PreviousObjects
}

export interface EncodedTree {
    manifestKey: string
    manifest: Manifest
    /**
     * Every unit this encode produced, the manifest last. A unit a scoped encode carried without encoding it is not
     * here; it is only in `index.units`.
     */
    units: EncodedUnit[]
    /** Pass as `previous` of the next encode. */
    index: PreviousEncoding
}

/** The config-level parts of a database an asset or inlay list is derived from. */
export interface ConfigOwner {
    config: JsonObject
    presets: JsonObject[]
    plugins: JsonObject[]
    pluginStorage: JsonObject
    loadouts: JsonValue[]
    statics: JsonValue | undefined
    characterOrder: JsonValue | undefined
}

/**
 * Derivation of the asset and inlay lists, injected by the caller. The codec
 * only frames what these return; it has no default and no empty fallback, so an
 * encode cannot produce empty lists by accident. Each function receives the
 * owner as stored (normalised JSON, volatile fields removed).
 */
export interface ListDerivation {
    configAssets(owner: ConfigOwner): AssetList
    configInlays(owner: ConfigOwner): InlayList
    characterAssets(character: JsonObject): AssetList
    characterInlays(character: JsonObject): InlayList | null
    moduleAssets(module: JsonObject): AssetList
    moduleInlays(module: JsonObject): InlayList | null
}

export interface EncodeOptions {
    /** Randomness and clock for keys and entity ids; a CSPRNG in production. */
    env: KeyEnv
    lists: ListDerivation
    /** `seq` of the manifest. */
    seq: number
    /** `createdAt` of the manifest. */
    createdAt: number
    /** The earlier encoding to reuse keys from; absent on a first encode. */
    previous?: PreviousEncoding | null
    /**
     * The commit attempt's key mint. A unit that is not reused takes its key from here, so the keys of a tree built
     * for a commit are exactly those the commit accepts; absent, keys come from `env` (conversion, goldens).
     */
    keys?: KeyMint
}

/** Where `assembleDatabase` reads unit bytes from. */
export interface UnitSource {
    get(key: string): Uint8Array | undefined
}
