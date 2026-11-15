<script lang="ts">
    import type { Component } from 'svelte'
    import { ADVANCED_SHELL_SECTIONS } from '../../ts/setting/advancedShellSettingsData'
    import type { SettingContext } from '../../ts/setting/types'
    import { settingsLabel } from '../../ts/settingsShell/settingsPages'
    import PrivateNetworkControls from '../Setting/Pages/Advanced/PrivateNetworkControls.svelte'
    import ShellSectionsPage from './ShellSectionsPage.svelte'

    // The private-network controls take no context; the page hands every shell component the same props.
    const components: Record<string, Component<{ ctx: SettingContext }>> = { PrivateNetworkControls }

    let sectionsPage = $state<ReturnType<typeof ShellSectionsPage>>()

    /** Opens whatever hides the row and returns its element; null when the page has no such row. */
    export async function reveal(rowId: string): Promise<HTMLElement | null> {
        return sectionsPage ? sectionsPage.reveal(rowId) : null
    }
</script>

<div class="flex flex-col gap-6" data-part="advanced-page">
    <p class="text-sm text-textcolor2" data-part="advanced-calm">{settingsLabel('settingsShellAdvCalm')}</p>
    <ShellSectionsPage bind:this={sectionsPage} sections={ADVANCED_SHELL_SECTIONS} {components} />
</div>
