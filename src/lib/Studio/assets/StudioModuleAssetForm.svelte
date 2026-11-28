<script lang="ts">
    import type { AssetSizeJob } from '../../../ts/studio/assets/assetSizes'
    import { firstModuleHolderIndex } from '../../../ts/studio/edit/assetSetters'
    import { DBState } from '../../../ts/stores.svelte'
    import type { ToastHost } from '../../../ts/toast/toastHost.svelte'
    import StudioAssetList, { type EnabledModuleAssets } from './StudioAssetList.svelte'
    import type { FinderPort } from './StudioAssetFinder.svelte'

    // The asset list of one loaded module. It has no save chip: a module's writes are marked for the app's own save, and
    // the character's visit chip is not about them. Only the first holder of an id is editable; a later copy is read-only,
    // and the detail screen publishes no id for it, so no write and no history can start.
    interface Props {
        // The module's stored id, and the place of its slot in the module list (a shared id names several slots).
        moduleId: string
        slotIndex: number
        // The toast host, the size job, the enabled modules and the byte layer of the list; each falls back to the app's own.
        host?: ToastHost
        sizeJob?: () => Promise<AssetSizeJob>
        enabledModules?: () => readonly EnabledModuleAssets[]
        references?: (name: string, path: string) => number
        finderPort?: () => Promise<FinderPort>
    }

    let { moduleId, slotIndex, host, sizeJob, enabledModules, references, finderPort }: Props = $props()

    const readOnly = $derived(firstModuleHolderIndex(DBState.db.modules, moduleId) !== slotIndex)
</script>

<div data-part="studio-module-asset-form" class="flex flex-col gap-3">
    <StudioAssetList {moduleId} moduleIndex={slotIndex} {readOnly} {host} {sizeJob} {enabledModules} {references} {finderPort} />
</div>
