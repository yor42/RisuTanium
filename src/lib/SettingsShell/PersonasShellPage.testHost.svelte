<script lang="ts">
    // Test-only host shaped like the page mount in SettingsShellPage: the page sits inside a keyed block and an
    // `{#if}`, so its first statement runs inside a branch effect exactly as in the shell.
    import PersonasShellPage from './PersonasShellPage.svelte'

    interface Props {
        current?: number
    }
    let { current = 12 }: Props = $props()
</script>

{#key current}
    <div data-part="settings-view">
        {#if current === 12}
            <PersonasShellPage />
        {/if}
    </div>
{/key}
