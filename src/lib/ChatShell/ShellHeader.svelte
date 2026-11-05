<script lang="ts">
    import { get } from 'svelte/store'
    import { MobileGUI, MobileSideBar } from '../../ts/stores.svelte'
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
        else MobileSideBar.set(1)
    }
</script>

<header data-part="chat-header" data-part-critical data-hidden={hidden && !hardwareKeyboardSeen && !focused ? '' : undefined} onfocusin={() => focused = true} onfocusout={(event) => focused = event.currentTarget.contains(event.relatedTarget as Node)}>
    <button data-part="chat-header-back" aria-label={language.chatShellBack} onclick={back}>‹</button>
    <span data-part="chat-header-title">{name}</span>
    <button data-part="chat-header-persona" aria-label={language.chatShellChoosePersona} onclick={(event) => onpersona(event.currentTarget)}>◉</button>
</header>

<style>
    [data-part="chat-header"] { height: 48px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px; background: var(--color-bgcolor); color: var(--color-textcolor); border-bottom: 1px solid var(--color-darkborderc); transition: transform 200ms ease, opacity 200ms ease, visibility 200ms ease; }
    [data-part="chat-header"][data-hidden] { transform: translateY(-100%); opacity: 0; visibility: hidden; margin-bottom: -48px; }
    [data-part="chat-header-title"] { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    [data-part="chat-header-back"], [data-part="chat-header-persona"] { width: 44px; height: 44px; flex: none; color: inherit; }
    @media (min-width: 900px) { [data-part="chat-header"][data-hidden] { transform: none; opacity: 1; visibility: visible; margin-bottom: 0; } }
    @media (prefers-reduced-motion: reduce) { [data-part="chat-header"] { transition: opacity 120ms ease, visibility 120ms ease; } [data-part="chat-header"][data-hidden] { transform: none; } }
</style>
