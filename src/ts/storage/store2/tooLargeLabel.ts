import { language } from 'src/lang'
import { Store2PayloadTooLargeError } from './backend/errors'
import { COMMIT_KEY, FENCE_KEY } from './format/keys'
import { UNIT_TYPE, isKnownUnitType, type UnitType } from './format/versions'

/**
 * The parts of a person's data a refused body can be. Each locale words one phrase per part; `generic` is the fallback for
 * a body with no part of its own.
 */
export type TooLargePart =
    | 'saveRecord' | 'saveIndex' | 'characterList' | 'character' | 'lorebook' | 'scripts' | 'chat' | 'chatPart'
    | 'module' | 'moduleList' | 'settings' | 'preset' | 'plugin' | 'pluginData' | 'fileList' | 'characterOrder'
    | 'loadouts' | 'chatAlternatives' | 'generic'

/** Every unit type names one part; a new unit type does not compile until it is placed here. */
const PART_OF_UNIT_TYPE: Record<UnitType, TooLargePart> = {
    [UNIT_TYPE.commit]: 'saveRecord',
    [UNIT_TYPE.manifest]: 'saveIndex',
    [UNIT_TYPE.shard]: 'characterList',
    [UNIT_TYPE.characterCore]: 'character',
    [UNIT_TYPE.lore]: 'lorebook',
    [UNIT_TYPE.scripts]: 'scripts',
    [UNIT_TYPE.chatCore]: 'chat',
    [UNIT_TYPE.chatChunk]: 'chatPart',
    [UNIT_TYPE.chatAlt]: 'chatAlternatives',
    [UNIT_TYPE.module]: 'module',
    [UNIT_TYPE.moduleIndex]: 'moduleList',
    [UNIT_TYPE.configRoot]: 'settings',
    [UNIT_TYPE.preset]: 'preset',
    [UNIT_TYPE.plugin]: 'plugin',
    [UNIT_TYPE.pluginStorageValue]: 'pluginData',
    [UNIT_TYPE.assetList]: 'fileList',
    [UNIT_TYPE.order]: 'characterOrder',
    [UNIT_TYPE.loadouts]: 'loadouts',
    [UNIT_TYPE.statics]: 'generic',
    [UNIT_TYPE.pluginStorageBucket]: 'pluginData',
    [UNIT_TYPE.legacyList]: 'fileList',
    [UNIT_TYPE.inlayList]: 'fileList',
    [UNIT_TYPE.sweepRecord]: 'generic',
    [UNIT_TYPE.fenceRecord]: 'generic',
    [UNIT_TYPE.deletionSnapshot]: 'generic',
}

/** The part a refused body was: the save record for the commit key and the fence, else by unit type, else generic. */
export function tooLargePartOf(key: string | null, unitType: number | null): TooLargePart {
    if (key === COMMIT_KEY || key === FENCE_KEY) {
        return 'saveRecord'
    }
    return unitType !== null && isKnownUnitType(unitType) ? PART_OF_UNIT_TYPE[unitType] : 'generic'
}

/**
 * What the person is told the refused body was: its part and size. Read from the error alone: the body was never kept.
 */
export function tooLargeLabel(error: Store2PayloadTooLargeError): string {
    return language.saveUnitLabel(tooLargePartOf(error.key, error.unitType), error.bytes)
}
