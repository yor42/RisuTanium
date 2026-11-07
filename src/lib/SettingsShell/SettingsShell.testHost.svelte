<script lang="ts">
    // Test-only host that mirrors the App branch around Settings: the surface is mounted while Settings is open,
    // the sidebar opener is unmounted and mounted again around it, and the chat surface stays mounted and inert.
    import { settingsOpen } from '../../ts/stores.svelte'
    import SendFailureCard from '../ChatShell/SendFailureCard.svelte'
    import { openSettingsForFix } from '../Setting/settingsRoute'
    import SettingsSurface from './SettingsSurface.svelte'

    interface Props {
        withFailureCard?: boolean
    }
    let { withFailureCard = false }: Props = $props()
</script>

{#if $settingsOpen}
    <SettingsSurface />
{/if}
{#if !$settingsOpen}
    <button type="button" data-part="sidebar-settings" id="host-sidebar">Settings</button>
{/if}
<div data-chat-surface inert={$settingsOpen}>
    <button type="button" id="host-header">This chat</button>
    {#if withFailureCard}
        <SendFailureCard
            failure={{ reason: 'key', fix: 'botSettings', action: 'send' }}
            onfix={() => openSettingsForFix('botSettings')}
            onretry={() => {}}
        />
    {/if}
</div>
