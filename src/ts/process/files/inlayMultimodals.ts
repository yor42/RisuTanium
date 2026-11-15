import type { MultiModal } from "../index.svelte";
import { getInlayAssetCapped } from "./inlays";

/**
 * The multimodal parts of a Lua model call for the inlay ids its prompt names, in order. An id that cannot
 * be read still gives one empty part. A video or audio over the send limit gives none: it is left out with
 * one warning, and its body is not loaded from the app store.
 */
export async function multimodalsOfInlays(ids: readonly string[]): Promise<MultiModal[]> {
    const multimodals: MultiModal[] = []
    for(const id of ids){
        const read = await getInlayAssetCapped(id)
        if(read === null){
            multimodals.push({
                type: undefined,
                base64: undefined,
                width: undefined,
                height: undefined
            })
            continue
        }
        if(read.status === 'too-large'){
            console.warn('A video or audio over the size limit was left out of a Lua model call:', id, read.summary.type, read.summary.size)
            continue
        }
        multimodals.push({
            type: read.asset.type,
            base64: read.asset.data,
            width: read.asset.width,
            height: read.asset.height
        })
    }
    return multimodals
}
