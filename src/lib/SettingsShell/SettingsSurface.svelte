<script lang="ts">
    import { onDestroy } from 'svelte'
    import { get } from 'svelte/store'
    import { SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
    import { settingsShellEligible } from '../../ts/settingsShell/settingsShellSwitch.svelte'
    import Settings from '../Setting/Settings.svelte'
    import SettingsShell from './SettingsShell.svelte'

    // Latched once per open: flipping the switch while Settings is open never swaps the screen.
    const useShell = settingsShellEligible()

    // A finished open leaves no page request behind. Reset only when Settings is closed (an App branch change
    // while it is open keeps the index) and the shell is eligible, so the legacy screen keeps its own index.
    onDestroy(() => {
        if (!get(settingsOpen) && settingsShellEligible()) SettingsMenuIndex.set(-1)
    })
</script>

{#if useShell}
    <SettingsShell />
{:else}
    <Settings />
{/if}
