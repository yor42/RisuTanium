import { ASSET_REF_V, IL_REF_V, type AssetList, type InlayList } from '../format'
import type { ConfigOwner, ListDerivation } from '../codec'
import { deriveCharacterAssets, deriveConfigAssets, deriveModuleAssets } from './assetList'
import { deriveInlayList } from './inlayList'
import { DEFAULT_MAX_INLAY_BODY_BYTES, type ListParams } from './params'

/**
 * The real derivation for the codec's injected `ListDerivation`. Every owner
 * gets a list: an owner without ids derives an empty one, never a missing one.
 *
 * The derivation opts in to carrying a module's previous list units
 * (`moduleListVersions`) only with the default inlay cap: the cap cannot be read
 * back from a stored list, so a derivation with any other cap always derives.
 * Version discipline: any change to the output of `deriveModuleAssets`,
 * `deriveInlayList` for a module, `InlayIdCollector`, `assetRefKey`,
 * `hexStemToBase64url`, the default cap or the list body shape must bump
 * `ASSET_REF_V` / `IL_REF_V`; the bump makes a stored list stale, so it is
 * derived again instead of carried. The module list golden test catches only
 * the changes its one fixture shows; the derivation pin test fails when the
 * module fields read change. Neither forces the bump: that is the author's duty.
 */
export function createListDerivation(params?: Partial<ListParams>): ListDerivation {
    const defaultCap = (params?.maxInlayBodyBytes ?? DEFAULT_MAX_INLAY_BODY_BYTES) === DEFAULT_MAX_INLAY_BODY_BYTES
    return {
        ...(defaultCap ? { moduleListVersions: { asset: ASSET_REF_V, inlay: IL_REF_V } } : {}),
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
