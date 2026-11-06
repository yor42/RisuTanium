<script lang="ts">
    import { DBState, additionalFloatingActionButtons, chatPanelStore } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'

    interface Props { visible: boolean; onclick: () => void }
    let { visible, onclick }: Props = $props()
    let style = $derived(DBState.db.newMessageButtonStyle || 'bottom-center')
</script>

{#if chatPanelStore.length > 0}
    <div data-part="chat-plugin-panels">
        {#each chatPanelStore as panel (panel.id)}
            <section data-part="chat-plugin-panel" data-plugin-chat-panel={panel.id} style="contain: paint; isolation: isolate;">
                <div class={panel.className ?? ''} data-plugin-chat-panel-body>{@html panel.html}</div>
            </section>
        {/each}
    </div>
{/if}
{#if visible}
    <button data-part="chat-new-message" data-style={style} aria-label={language.newMessage} {onclick}>↓{#if style !== 'floating-circle'}<span>{language.newMessage}</span>{/if}</button>
{/if}
{#if additionalFloatingActionButtons.length > 0}
    <div data-part="chat-floating-actions">
        {#each additionalFloatingActionButtons as button (button.id)}
            <button aria-label={button.name} onclick={() => button.callback()}><PluginDefinedIcon ico={button} />{button.name}</button>
        {/each}
    </div>
{/if}

<style>
    [data-part="chat-plugin-panels"] { display: flex; flex-direction: column; gap: var(--space-7); padding: var(--space-7) var(--space-12); }
    [data-part="chat-plugin-panel"] { border: 1px solid var(--nexus-edge); background: var(--nexus-surface-flat); color: var(--nexus-text); padding: var(--space-10); border-radius: var(--radius-5); }
    [data-part="chat-floating-actions"] { position: fixed; top: var(--space-12); right: var(--space-12); display: flex; flex-direction: column; gap: var(--space-7); z-index: calc(var(--pattern-z-layer) - 1); }
    [data-part="chat-floating-actions"] button, [data-part="chat-new-message"] { background: var(--nexus-surface-raised); color: var(--nexus-text); min-height: var(--size-touch); border-radius: var(--radius-pill); padding: var(--space-7) var(--space-10); }
    [data-part="chat-new-message"] { position: absolute; z-index: calc(var(--pattern-z-layer) - 1); }
    [data-part="chat-new-message"][data-style="bottom-center"] { bottom: var(--size-29); left: 50%; transform: translateX(-50%); }
    [data-part="chat-new-message"][data-style="bottom-right"] { bottom: var(--size-33); right: var(--space-12); }
    [data-part="chat-new-message"][data-style="bottom-left"] { bottom: var(--size-33); left: var(--space-12); }
    [data-part="chat-new-message"][data-style="floating-circle"] { bottom: var(--size-37); right: var(--space-12); width: var(--header-height); height: var(--header-height); border-radius: var(--radius-circle); }
    [data-part="chat-new-message"][data-style="right-center"] { top: 50%; right: var(--space-7); transform: translateY(-50%); }
    [data-part="chat-new-message"][data-style="top-bar"] { top: var(--space-7); left: 50%; transform: translateX(-50%); }
</style>
