<script lang="ts">
    import { get } from 'svelte/store'
    import { DynamicGUI, MobileGUI, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
    import { closeShellChat } from '../Mobile/mobileBack'
    import { language } from '../../lang'

    interface Props {
        name: string
        hidden: boolean
        hardwareKeyboardSeen: boolean
        onpersona: (opener: HTMLElement) => void
    }

    let { name, hidden, hardwareKeyboardSeen, onpersona }: Props = $props()
    let focused = $state(false)

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

<header data-part="chat-header" data-toggle-inset={$MobileGUI ? undefined : ''} style:padding-left={$MobileGUI ? undefined : 'calc(var(--size-touch-lg) + var(--space-7))'} data-hidden={hidden && !hardwareKeyboardSeen && !focused ? '' : undefined} onfocusin={() => focused = true} onfocusout={(event) => focused = event.currentTarget.contains(event.relatedTarget as Node)}>
    <button data-part="chat-header-back" data-kind="icon-button" aria-label={language.chatShellBack} onclick={back}>‹</button>
    <span data-part="chat-header-title">{name}</span>
    <button data-part="chat-header-menu" data-kind="icon-button" aria-label={language.chatShellChoosePersona} onclick={(event) => onpersona(event.currentTarget)}>◉</button>
</header>

<style>
    [data-part="chat-header"] { height: var(--header-height); flex: none; display: flex; align-items: center; gap: var(--space-7); padding: 0 var(--space-7); background: var(--nexus-canvas); color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); transition: transform var(--chat-dur-base) var(--chat-ease-out), opacity var(--chat-dur-base) var(--chat-ease-out), visibility var(--chat-dur-base) var(--chat-ease-out); }
    [data-part="chat-header"][data-hidden] { transform: translateY(-100%); opacity: 0; visibility: hidden; margin-bottom: calc(-1 * var(--header-height)); }
    [data-part="chat-header-title"] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="chat-header-back"], [data-part="chat-header-menu"] { width: var(--size-touch); height: var(--size-touch); flex: none; color: inherit; }
    @media (min-width: 900px) { [data-part="chat-header"][data-hidden] { transform: none; opacity: 1; visibility: visible; margin-bottom: 0; } }
    @media (prefers-reduced-motion: reduce) { [data-part="chat-header"] { transition: opacity var(--chat-dur-fast) var(--chat-ease-out), visibility var(--chat-dur-fast) var(--chat-ease-out); } [data-part="chat-header"][data-hidden] { transform: none; } }
    :global(html.rm) [data-part="chat-header"] { transition: opacity var(--chat-dur-fast) var(--chat-ease-out), visibility var(--chat-dur-fast) var(--chat-ease-out); }
    :global(html[data-low-power]) [data-part="chat-header"], :global(html.nexus-low-power) [data-part="chat-header"] { transition-duration: var(--dur-lowpower-cap); }
    :global(html.rm[data-low-power]) [data-part="chat-header"] { transition: opacity var(--chat-dur-fast) var(--chat-ease-out), visibility var(--chat-dur-fast) var(--chat-ease-out); }
</style>
