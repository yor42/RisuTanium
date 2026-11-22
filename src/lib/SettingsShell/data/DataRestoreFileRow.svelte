<script lang="ts">
    import { language } from '../../../lang'
    import { dataActionItem } from '../../../ts/setting/dataShellSettingsData'
    import { dataSheetState, runDataAction } from '../../../ts/setting/dataSheets.svelte'
    import type { SettingContext } from '../../../ts/setting/types'
    import { getLabel } from '../../../ts/setting/utils'

    // The page hands every shell component the same props; this row needs none of them.
    let { ctx: _ctx }: { ctx?: SettingContext } = $props()

    const item = dataActionItem('data.restoreFile')

    async function restore(): Promise<void> {
        await runDataAction(async () => (await import('../../../ts/drive/settingsRestore')).restoreFromBinFile())
    }
</script>

<div class="flex flex-col">
    <button
        type="button"
        class="self-start min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected"
        data-part="settings-data-action"
        aria-disabled={dataSheetState.running ? 'true' : undefined}
        onclick={restore}
    >{getLabel(item)}</button>
    <p class="text-xs text-textcolor2 mt-1 mb-2" data-part="settings-row-hint">{language.settingsShellDataRestoreFileHint}</p>
</div>
