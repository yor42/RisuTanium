import type { AssetList, InlayList } from '../format'
import type { ConfigOwner, ListDerivation } from '../codec'
import { deriveCharacterAssets, deriveConfigAssets, deriveModuleAssets } from './assetList'
import { deriveInlayList } from './inlayList'
import type { ListParams } from './params'

/**
 * The real derivation for the codec's injected `ListDerivation`. Every owner
 * gets a list: an owner without ids derives an empty one, never a missing one.
 */
export function createListDerivation(params?: Partial<ListParams>): ListDerivation {
    return {
        configAssets: (owner: ConfigOwner): AssetList => deriveConfigAssets(owner.config, owner.characterOrder, owner.loadouts),
        configInlays: (owner: ConfigOwner): InlayList => deriveInlayList([
            owner.config, owner.presets, owner.plugins, owner.pluginStorage, owner.loadouts, owner.statics, owner.characterOrder,
        ], params),
        characterAssets: deriveCharacterAssets,
        characterInlays: character => deriveInlayList([character], params),
        moduleAssets: deriveModuleAssets,
        moduleInlays: module => deriveInlayList([module], params),
    }
}
