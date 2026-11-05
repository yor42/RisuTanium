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
    [data-part="chat-plugin-panels"] { display: flex; flex-direction: column; gap: 8px; padding: 8px 16px; }
    [data-part="chat-plugin-panel"] { border: 1px solid var(--color-darkborderc); background: var(--color-darkbg); color: var(--color-textcolor); padding: 12px; border-radius: 8px; }
    [data-part="chat-floating-actions"] { position: fixed; top: 16px; right: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 50; }
    [data-part="chat-floating-actions"] button, [data-part="chat-new-message"] { background: var(--color-selected); color: var(--color-textcolor); min-height: 44px; border-radius: 24px; padding: 8px 12px; }
    [data-part="chat-new-message"] { position: absolute; z-index: 50; }
    [data-part="chat-new-message"][data-style="bottom-center"] { bottom: 64px; left: 50%; transform: translateX(-50%); }
    [data-part="chat-new-message"][data-style="bottom-right"] { bottom: 80px; right: 16px; }
    [data-part="chat-new-message"][data-style="bottom-left"] { bottom: 80px; left: 16px; }
    [data-part="chat-new-message"][data-style="floating-circle"] { bottom: 144px; right: 16px; width: 48px; height: 48px; border-radius: 50%; }
    [data-part="chat-new-message"][data-style="right-center"] { top: 50%; right: 8px; transform: translateY(-50%); }
    [data-part="chat-new-message"][data-style="top-bar"] { top: 8px; left: 50%; transform: translateX(-50%); }
</style>
