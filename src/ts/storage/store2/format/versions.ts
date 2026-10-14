/**
 * Version constants and unit type ids of the store2 format.
 *
 * Too-new (the build goes read-only and deletes nothing): a frame `fmt` above
 * `FRAME_FMT`, a codec, reserved byte or type outside the sets below, a body
 * `fmt` above `FRAME_FMT` on the commit key or a manifest, a body `v` above
 * `BODY_V`, or an unknown `req` token.
 *
 * A derived list whose version is above its known one is a different case:
 * unreadable. The pass that needs the list deletes nothing, but the build does
 * not go read-only.
 */

export const FRAME_FMT = 1
/** UTF-8 JSON; the only codec of format 1. */
export const FRAME_CODEC = 0
export const FRAME_RESERVED = 0

/** Version of the derived asset list (`v` of types 15 and 20). */
export const ASSET_REF_V = 1
/** Version of the derived inlay list (`v` of type 21, `iv` of type 20). */
export const IL_REF_V = 1
/** `v` of every other versioned body. */
export const BODY_V = 1

/** The `req` tokens this build understands. Empty in format 1. */
export const KNOWN_REQ: ReadonlySet<string> = new Set<string>()

export const UNIT_TYPE = {
    commit: 1,
    manifest: 2,
    shard: 3,
    characterCore: 4,
    lore: 5,
    scripts: 6,
    chatCore: 7,
    chatChunk: 8,
    module: 9,
    moduleIndex: 10,
    configRoot: 11,
    preset: 12,
    plugin: 13,
    pluginStorageValue: 14,
    assetList: 15,
    order: 16,
    loadouts: 17,
    statics: 18,
    pluginStorageBucket: 19,
    legacyList: 20,
    inlayList: 21,
    sweepRecord: 22,
    fenceRecord: 23,
} as const

export type UnitType = typeof UNIT_TYPE[keyof typeof UNIT_TYPE]

export const UNIT_TYPE_IDS: readonly UnitType[] = Object.values(UNIT_TYPE)

const KNOWN_UNIT_TYPES: ReadonlySet<number> = new Set<number>(UNIT_TYPE_IDS)

export function isKnownUnitType(type: number): type is UnitType {
    return KNOWN_UNIT_TYPES.has(type)
}
