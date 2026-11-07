<script lang="ts">
    import { get } from 'svelte/store'
    import { DynamicGUI, MobileGUI, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
    import { closeShellChat } from '../Mobile/mobileBack'
    import { language } from '../../lang'

    interface Props {
        name: string
        /** The chat shown, as a second line; empty while a switch is pending. */
        chatName?: string
        hidden: boolean
        hardwareKeyboardSeen: boolean
        onthischat: (opener: HTMLElement) => void
        onconcealed?: (concealed: boolean) => void
    }

    let { name, chatName = '', hidden, hardwareKeyboardSeen, onthischat, onconcealed }: Props = $props()
    let focused = $state(false)
    // The one expression for "the header is out of view"; the shell's scroll padding reads it through onconcealed.
    let concealed = $derived(hidden && !hardwareKeyboardSeen && !focused)

    $effect(() => {
        onconcealed?.(concealed)
    })

    function back(): void {
        if (get(MobileGUI)) closeShellChat()
        else if (get(sideBarStore) && !get(DynamicGUI)) sideBarClosing.set(true)
        else {
            // The classic layout has no mobile stack; Back drives the same open/close pair as the sidebar toggle.
            sideBarClosing.set(false)
            sideBarStore.set(true)
        }
    }
</script>

<header data-part="chat-header" data-toggle-inset={$MobileGUI ? undefined : ''} style:padding-left={$MobileGUI ? undefined : 'calc(var(--size-touch-lg) + var(--space-7))'} data-hidden={concealed ? '' : undefined} onfocusin={() => focused = true} onfocusout={(event) => focused = event.currentTarget.contains(event.relatedTarget as Node)}>
    <button data-part="chat-header-back" data-kind="icon-button" aria-label={language.chatShellBack} onclick={back}>‹</button>
    <span data-part="chat-header-heading"><span data-part="chat-header-title">{name}</span>{#if chatName}<span data-part="chat-header-chat">{chatName}</span>{/if}</span>
    <button data-part="chat-header-menu" data-kind="icon-button" aria-label={language.chatShellThisChat} title={language.chatShellThisChat} aria-haspopup="dialog" onclick={(event) => onthischat(event.currentTarget)}>⋮</button>
</header>

<style>
    [data-part="chat-header"] { pointer-events: auto; height: var(--header-height); flex: none; display: flex; align-items: center; gap: var(--space-7); padding: 0 var(--space-7); background: var(--nexus-canvas); color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); transition: transform var(--chat-dur-base) var(--chat-ease-out), opacity var(--chat-dur-base) var(--chat-ease-out), visibility var(--chat-dur-base) var(--chat-ease-out); }
    [data-part="chat-header"][data-hidden] { transform: translateY(-100%); opacity: 0; visibility: hidden; pointer-events: none; }
    [data-part="chat-header-heading"] { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    [data-part="chat-header-title"], [data-part="chat-header-chat"] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="chat-header-chat"] { color: var(--nexus-text-secondary); font-size: 0.85em; }
    [data-part="chat-header-back"], [data-part="chat-header-menu"] { width: var(--size-touch); height: var(--size-touch); flex: none; color: inherit; }
    @media (min-width: 900px) { [data-part="chat-header"][data-hidden] { transform: none; opacity: 1; visibility: visible; pointer-events: auto; } }
    @media (prefers-reduced-motion: reduce) { [data-part="chat-header"] { transition: opacity var(--chat-dur-fast) var(--chat-ease-out), visibility var(--chat-dur-fast) var(--chat-ease-out); } [data-part="chat-header"][data-hidden] { transform: none; } }
    :global(html.rm) [data-part="chat-header"] { transition: opacity var(--chat-dur-fast) var(--chat-ease-out), visibility var(--chat-dur-fast) var(--chat-ease-out); }
    :global(html[data-low-power]) [data-part="chat-header"], :global(html.nexus-low-power) [data-part="chat-header"] { transition-duration: var(--dur-lowpower-cap); }
    :global(html.rm[data-low-power]) [data-part="chat-header"] { transition: opacity var(--chat-dur-fast) var(--chat-ease-out), visibility var(--chat-dur-fast) var(--chat-ease-out); }
</style>
