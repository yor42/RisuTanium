import { ASSET_REF_V, assetRefKey, hexStemToBase64url, type AssetList } from '../format'
import { isPlainRecord, sortedUnique, type PlainRecord } from './scan'

/**
 * Asset lists (type 15): a pure function of an owner's core fields. Every field
 * the boot-time keep-set collector (`getUncleanablesSync`) reads is read here, so
 * a list never holds fewer assets than that collector would keep.
 */

const HEX_STEM = /^[0-9a-f]{64}$/

/**
 * Decides which set an asset comparison key (the output of `assetRefKey`, already
 * lower-case) belongs to: true is the hash set `h`, false the literal set `l`.
 * Exactly 64 lower-case hex digits and nothing else is a hash; an extension or any
 * other length or case is a literal. Any sweep that classes a key must call this.
 */
export function isHashStemKey(key: string): boolean {
    return HEX_STEM.test(key)
}

/**
 * Collects asset names. A name is reduced to its comparison key (`assetRefKey`
 * after backslashes are read as separators, as the collector's basename does): a
 * 64-digit hash goes to the stem set, anything else to the literal set, both
 * lower-cased. Non-strings and empty names hold no reference.
 */
export class AssetRefCollector {
    private readonly stems = new Set<string>()
    private readonly literals = new Set<string>()

    add(name: unknown): void {
        if (typeof name !== 'string' || name === '') {
            return
        }
        const key = assetRefKey(name.replace(/\\/g, '/'))
        if (key === '') {
            return
        }
        if (isHashStemKey(key)) {
            this.stems.add(hexStemToBase64url(key))
        } else {
            this.literals.add(key)
        }
    }

    toList(): AssetList {
        return { v: ASSET_REF_V, h: sortedUnique(this.stems).join(''), l: sortedUnique(this.literals) }
    }
}

/** The second element of every row of a `[label, name]` list. */
function addRowNames(collector: AssetRefCollector, rows: unknown): void {
    if (!Array.isArray(rows)) {
        return
    }
    for (const row of rows) {
        if (Array.isArray(row)) {
            collector.add(row[1])
        }
    }
}

function recordOf(value: unknown): PlainRecord | null {
    return isPlainRecord(value) ? value : null
}

/** Character (and group) fields: image, emotion images, additional assets, TTS files, reference audio, card assets. */
export function collectCharacterAssets(collector: AssetRefCollector, character: object): void {
    const cha = character as PlainRecord
    collector.add(cha.image)
    addRowNames(collector, cha.emotionImages)
    addRowNames(collector, cha.additionalAssets)
    const files = recordOf(recordOf(cha.vits)?.files)
    if (files) {
        for (const key of Object.keys(files)) {
            collector.add(files[key])
        }
    }
    collector.add(recordOf(recordOf(cha.gptSoVitsConfig)?.ref_audio_data)?.assetId)
    if (Array.isArray(cha.ccAssets)) {
        for (const asset of cha.ccAssets) {
            collector.add(recordOf(asset)?.uri)
        }
    }
}

/** Module fields: asset rows and icon. */
export function collectModuleAssets(collector: AssetRefCollector, module: object): void {
    const mod = module as PlainRecord
    addRowNames(collector, mod.assets)
    collector.add(mod.icon)
}

/**
 * Config-level fields: background, user icon, image-generation reference images,
 * persona icons and their embedded modules, loadout icons, and folder images in the
 * character order. The loadouts live outside the config root in the codec, so a
 * caller holding them apart passes them; a whole old database carries its own.
 */
export function collectConfigAssets(
    collector: AssetRefCollector,
    config: object,
    characterOrder: unknown,
    loadouts: unknown = (config as PlainRecord).loadouts,
): void {
    const db = config as PlainRecord
    collector.add(db.customBackground)
    collector.add(db.userIcon)
    const nai = recordOf(db.NAIImgConfig)
    collector.add(nai?.image)
    collector.add(nai?.character_image)
    collector.add(recordOf(db.wavespeedImage)?.reference_image)
    if (Array.isArray(db.personas)) {
        for (const persona of db.personas) {
            const one = recordOf(persona)
            if (!one) {
                continue
            }
            collector.add(one.icon)
            const embedded = recordOf(one.embeddedModule)
            if (embedded) {
                collectModuleAssets(collector, embedded)
            }
        }
    }
    if (Array.isArray(loadouts)) {
        for (const loadout of loadouts) {
            const icons = recordOf(loadout)?.icons
            if (Array.isArray(icons)) {
                for (const icon of icons) {
                    collector.add(icon)
                }
            }
        }
    }
    if (Array.isArray(characterOrder)) {
        for (const item of characterOrder) {
            const entry = recordOf(item)
            if (entry && 'imgFile' in entry) {
                collector.add(entry.imgFile)
            }
        }
    }
}

export function deriveCharacterAssets(character: object): AssetList {
    const collector = new AssetRefCollector()
    collectCharacterAssets(collector, character)
    return collector.toList()
}

export function deriveModuleAssets(module: object): AssetList {
    const collector = new AssetRefCollector()
    collectModuleAssets(collector, module)
    return collector.toList()
}

export function deriveConfigAssets(config: object, characterOrder: unknown, loadouts: unknown = (config as PlainRecord).loadouts): AssetList {
    const collector = new AssetRefCollector()
    collectConfigAssets(collector, config, characterOrder, loadouts)
    return collector.toList()
}
