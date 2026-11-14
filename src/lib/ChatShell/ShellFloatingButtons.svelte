<script lang="ts">
    import ArrowDownIcon from '@lucide/svelte/icons/arrow-down'
    import { additionalFloatingActionButtons, chatPanelStore } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import { badgeText } from '../../ts/chatShell/jumpTarget'
    import PluginDefinedIcon from '../Others/PluginDefinedIcon.svelte'

    interface Props { visible: boolean; count: number; onclick: () => void }
    let { visible, count, onclick }: Props = $props()
    // The count is part of the accessible name: a new reply is never announced while the reader is scrolled back.
    let label = $derived(count > 0 ? `${language.chatShellJumpLatest}, ${language.chatShellNewCount(count)}` : language.chatShellJumpLatest)
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
    <button data-part="chat-new-message" aria-label={label} {onclick}><ArrowDownIcon aria-hidden="true" />{#if count > 0}<span class="badge">{badgeText(count)}</span>{/if}</button>
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
    [data-part="chat-new-message"] { position: absolute; z-index: calc(var(--pattern-z-layer) - 1); bottom: var(--size-37); right: var(--space-12); width: var(--size-touch-lg); height: var(--size-touch-lg); min-height: 0; padding: 0; border-radius: var(--radius-circle); display: flex; align-items: center; justify-content: center; animation: jump-latest-in var(--chat-dur-fast) var(--chat-ease-out) both; }
    [data-part="chat-new-message"] .badge { position: absolute; top: calc(var(--space-4) * -1); right: calc(var(--space-4) * -1); min-width: var(--space-16); padding: 0 var(--space-4); border-radius: var(--radius-pill); background: var(--nexus-accent); color: var(--color-on-accent); font-size: var(--font-size-xs); line-height: var(--space-16); text-align: center; }
    @keyframes jump-latest-in { from { opacity: 0; transform: translateY(var(--space-8)); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-new-message"] { animation: none; } }
    :global(html.rm) [data-part="chat-new-message"], :global(html[data-low-power]) [data-part="chat-new-message"], :global(html.nexus-low-power) [data-part="chat-new-message"] { animation: none; }
</style>
