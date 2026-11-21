<script lang="ts">
    import type { Component } from 'svelte'
    import { DATA_SHELL_SECTIONS } from '../../ts/setting/dataShellSettingsData'
    import type { SettingContext } from '../../ts/setting/types'
    import ShellSectionsPage from './ShellSectionsPage.svelte'
    import DataBackupRow from './data/DataBackupRow.svelte'
    import DataCleanUpRow from './data/DataCleanUpRow.svelte'
    import DataDatasetRow from './data/DataDatasetRow.svelte'
    import DataRestoreFileRow from './data/DataRestoreFileRow.svelte'
    import DataRestoreSnapshotRow from './data/DataRestoreSnapshotRow.svelte'

    // The action rows take no context; the page hands every shell component the same props.
    const components: Record<string, Component<{ ctx: SettingContext }>> = {
        DataBackupRow,
        DataRestoreFileRow,
        DataRestoreSnapshotRow,
        DataDatasetRow,
        DataCleanUpRow,
    }

    let sectionsPage = $state<ReturnType<typeof ShellSectionsPage>>()

    /** Opens whatever hides the row and returns its element; null when the page has no such row. */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        return sectionsPage ? sectionsPage.reveal(rowId) : null
    }
</script>

<div class="flex flex-col gap-6" data-part="data-page">
    <ShellSectionsPage bind:this={sectionsPage} sections={DATA_SHELL_SECTIONS} {components} />
</div>
