<script lang="ts">
    import { language } from "src/lang";
    import { alertConfirm} from "src/ts/alert";
    import { SaveLocalBackup, SavePartialLocalBackup } from "src/ts/drive/backuplocal";
    import { restoreFromBinFile, restoreFromInternalBackup } from "src/ts/drive/settingsRestore";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import { exportAsDataset } from "src/ts/storage/exportAsDataset";
    import { pageStorageModeStore } from "src/ts/storage/pageStorageMode";
    import { cleanUpOfferedFor, startCleanUpUnusedFiles } from "src/ts/storage/cleanUpUnusedFiles";
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
        (await import("src/ts/drive/rtbExportEntry")).startRtbExport()
    }} className="mt-2">
    {language.rtbExportButton}
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

<Button onclick={exportAsDataset} className="mt-2">
    {language.exportAsDataset}
</Button>

{#if cleanUpOfferedFor($pageStorageModeStore)}
    <Button onclick={startCleanUpUnusedFiles} className="mt-2">
        {language.cleanUnusedFiles}
    </Button>
{/if}

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