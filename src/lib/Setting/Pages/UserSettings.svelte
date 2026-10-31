<script lang="ts">
    import { language } from "src/lang";
    import { alertConfirm} from "src/ts/alert";
    import { SaveLocalBackup, SavePartialLocalBackup } from "src/ts/drive/backuplocal";
    import { restoreFromBinFile, restoreFromInternalBackup } from "src/ts/drive/settingsRestore";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import { exportAsDataset } from "src/ts/storage/exportAsDataset";
    import { cleanColdStorage } from "src/ts/process/coldstorage.svelte";
    import StorageMaintenanceSettings from "./StorageMaintenanceSettings.svelte";
    import { modeRunsLegacyDeleters, pageStorageModeStore } from "src/ts/storage/pageStorageMode";
</script>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.backupAndFiles}</h2>

<Button
    onclick={async () => {
        if(await alertConfirm(language.backupConfirm)){
            SaveLocalBackup()
        }
    }} className="mt-2">
    {language.saveBackupLocal}
</Button>

<Button
    onclick={async () => {
        if(await alertConfirm(language.backupConfirm)){
            SavePartialLocalBackup()
        }
    }} className="mt-2">
    {language.savePartialLocalBackup}
</Button>

<Button
    onclick={restoreFromBinFile} className="mt-2">
    {language.loadBackupLocal}
</Button>

<Button
    onclick={restoreFromInternalBackup} className="mt-2">
    {language.loadInternalBackup}
</Button>

{#if modeRunsLegacyDeleters($pageStorageModeStore)}
    <Button
        onclick={async () => {
            if(await alertConfirm(language.cleanColdStorageConfirm)){
                cleanColdStorage()
            }
        }} className="mt-2">
        {language.cleanColdStorage}
    </Button>
{/if}

<Button onclick={exportAsDataset} className="mt-2">
    {language.exportAsDataset}
</Button>

<StorageMaintenanceSettings />

<!--

    My song for dear, my old friend.

    Should old aquaintance be forgot,
    and never brought to mind?
    Should old lang syne be forgot,
    and auld lang syne?

    For auld lang syne, my dear,
    for auld lang syne,
    we'll take a cup o' kindness yet,
    for auld lang syne.

-->