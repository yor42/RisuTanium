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
 * A cold-stub character, a chat that is still a cold-storage pointer, or a
 * module stub the encoder cannot carry, was offered to the encoder. Encoding it
 * would persist a placeholder in place of the data it stands for, so the
 * encoder refuses (I9).
 */
export class StubRefusedError extends CodecError {
    /** The module's name; empty for a character or a chat. */
    public readonly moduleName: string
    /** Why a module stub was refused; null for a character or a chat. */
    public readonly reason: ModuleStubReason | null

    constructor(kind: 'character' | 'chat', chaId: string, chatIndex: number | null)
    /**
     * For kind `module`, `chaId` holds the module's id, `chatIndex` is null and `module` carries the name and the reason.
     */
    constructor(kind: 'module', chaId: string, chatIndex: null, module: { name: string, reason: ModuleStubReason })
    constructor(
        public readonly kind: 'character' | 'chat' | 'module',
        public readonly chaId: string,
        public readonly chatIndex: number | null,
        module?: { name: string, reason: ModuleStubReason },
    ) {
        super('stub', kind === 'character'
            ? `Character ${chaId} is a cold-storage stub and cannot be encoded.`
            : kind === 'module'
                ? `The module "${module?.name ?? ''}" (${chaId}) is a module stub (${module?.reason}) and cannot be encoded.`
                : `Chat ${chatIndex} of character ${chaId} is a cold-storage pointer and cannot be encoded.`)
        this.name = 'StubRefusedError'
        this.moduleName = module?.name ?? ''
        this.reason = module?.reason ?? null
    }
}

/**
 * Why a module stub was refused: `edited` when its slot no longer equals the stub minted for its recorded entry,
 * `uncarriable` when the stub cannot be carried as its entry (no recorded entry, a changed handle set or a stale list).
 */
export type ModuleStubReason = 'edited' | 'uncarriable'

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

interface EncodedUnitBase {
    /** Stable name of the unit's place in the tree; the reuse lookup key. */
    identity: string
    key: string
    type: UnitType
    ref: Ref
    /** Collision-resistant digest of the framed bytes (`unitDigest`); the Ref's CRC alone cannot tell two contents apart. */
    digest: string
}

/** A unit the encode must write: it holds its framed bytes until the pass ends. */
export interface WrittenUnit extends EncodedUnitBase {
    reused: false
    bytes: Uint8Array
}

/**
 * A unit equal to the previous encoding's, under that encoding's key. It holds no bytes in any property: the pass
 * frames the unit to compare it and must not keep the frame alive through the tree.
 */
export interface ReusedUnit extends EncodedUnitBase {
    reused: true
}

/**
 * One framed unit an encode produced. Narrow with `reused === false` or `isWrittenUnit`; the project compiles with
 * `strict: false`, where a negation of `reused` does not narrow.
 */
export type EncodedUnit = WrittenUnit | ReusedUnit

export function isWrittenUnit(unit: EncodedUnit): unit is WrittenUnit {
    return unit.reused === false
}

/**
 * What a later encode needs to know about one unit of an earlier one. A unit is
 * reused only when its `digest` is present and equal to the new bytes' digest;
 * `bytes`, when kept (`previousFrom` with `keepBytes`, for written units only), add a byte-for-byte comparison.
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
    /**
     * Opt-in to carrying a module's previous list units. Set only by a derivation whose module lists are a pure
     * function of the module unit's bytes and whose list versions are these: when a module's unit is reused and the
     * previous index entry names list units of exactly these versions, the encode keeps those units instead of
     * deriving the lists again. Absent, every module's lists are derived on every encode.
     *
     * "A carried list equals a fresh derivation" holds only while the writer invariant holds (every module list unit
     * a previous index entry names was derived from the module unit that entry names) and while any change to the
     * module list derivation bumps the matching version. A derivation that changes without a bump is carried stale.
     */
    readonly moduleListVersions?: { readonly asset: number, readonly inlay: number }
}

/** The sections whose unit puts a measurement build counts apart: the sink attributes each put to the one set last. */
export type SplitPutSection = 'front' | 'modules' | 'characters' | 'finish'

/** The span fields a codec hook adds to (milliseconds of synchronous work; a yield's wait is never inside one). */
export type SplitMsField =
    | 'splitScopeMs' | 'splitSinkMs' | 'splitListMs' | 'splitFrontMs' | 'splitModulesMs' | 'splitCarriedMs'
    | 'splitPreviousEntriesMs' | 'splitCarriedUnitsMs' | 'splitFinishTreeMs' | 'splitPlanTailMs'
    | 'splitModuleReadMs' | 'splitModuleListsMs'
    | 'splitFinishShardsMs' | 'splitFinishFixedMs' | 'splitFinishConfigMs' | 'splitFinishManifestMs'

/**
 * The recorder a measurement build hands to the codec, only ever set by the save encoder under `MEASURE`. The codec
 * reads its clock through `now()` and writes numbers into it; it never reads anything back, so a recorder cannot
 * change what is encoded. Every method is total: a failure inside the recorder is swallowed by the recorder.
 */
export interface SplitRecorder {
    now(): number
    /** The section the sink counts the next puts under. */
    section: SplitPutSection | null
    addMs(field: SplitMsField, ms: number): void
    /** One unit put by the sink: the time spent framing the body and the time spent digesting the frame. */
    splitUnitCost(encodeMs: number, digestMs: number): void
    /** One module's turn, counted toward the module set. */
    splitModuleCount(): void
    /** One named character's synchronous block. */
    splitCharacter(chaId: string, normalizeMs: number, emitMs: number, skipped: boolean): void
    /** The per-pass set of shared ids `encodeScopedParts` computed, as that pass used it. */
    splitAmbiguous(ambiguous: ReadonlySet<string>): void
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
