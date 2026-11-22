<script lang="ts">
    import { language } from '../../../lang'
    import { runDataBackup } from '../../../ts/setting/dataBackupFlow'
    import { dataActionItem } from '../../../ts/setting/dataShellSettingsData'
    import { askBackupChoice, askLeaveOutAnswer, dataSheetState, runDataAction } from '../../../ts/setting/dataSheets.svelte'
    import type { SettingContext } from '../../../ts/setting/types'
    import { getLabel } from '../../../ts/setting/utils'

    // The page hands every shell component the same props; this row needs none of them.
    let { ctx: _ctx }: { ctx?: SettingContext } = $props()

    // The engines load on the first tap, so the page and its tests stay light.
    const item = dataActionItem('data.backup')
    let button = $state<HTMLButtonElement>()

    async function start(): Promise<void> {
        const trigger = button ?? null
        await runDataAction(() => runDataBackup({
            chooseBackup: () => askBackupChoice(trigger),
            saveBin: async (options) => (await import('../../../ts/drive/backuplocal')).SaveLocalBackup(options),
            savePartialBin: async (options, entry) => (await import('../../../ts/drive/backuplocal')).SavePartialLocalBackup(options, entry),
            askLeaveOut: (summary) => askLeaveOutAnswer(summary, trigger),
            setLeftOut: (text) => { dataSheetState.lastBinLeftOut = text },
            // The chooser is the confirmation of the `.rtb` export, so its own confirm step answers yes.
            startRtb: async (password) => {
                const entry = await import('../../../ts/drive/rtbExportEntry')
                return entry.startRtbExport({ ...entry.liveRtbEntryDeps(), confirm: async () => true }, { password })
            },
            startSettingsRtb: async (password) => {
                const entry = await import('../../../ts/drive/rtbExportEntry')
                return entry.startSettingsRtbExport(undefined, { password })
            },
        }))
    }
</script>

<div class="flex flex-col">
    <button
        bind:this={button}
        type="button"
        class="self-start min-h-11 px-4 rounded-md bg-darkbutton text-textcolor hover:bg-selected"
        data-part="settings-data-action"
        aria-disabled={dataSheetState.running ? 'true' : undefined}
        onclick={start}
    >{getLabel(item)}</button>
    <p class="text-xs text-textcolor2 mt-1 mb-2" data-part="settings-row-hint">{language.settingsShellDataMakeBackupHint}</p>
    <p class="text-xs text-textcolor2" data-part="settings-data-backup-result" aria-live="polite">{dataSheetState.lastBinLeftOut ?? ''}</p>
</div>
