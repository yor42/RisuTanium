<script lang="ts">
    import { tick } from 'svelte'
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import { openPersonaSettings } from '../UI/Home/homeEmptyActions'
    import ShellSheet from './ShellSheet.svelte'

    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        // Set when the picker opens over another sheet, so everything beside its own layer, that sheet included, is inert.
        inertOutside?: boolean
        // `dropup` is the composer tab's menu: it hangs above the opener at every width and ends with the Persona settings entry.
        variant?: 'sheet' | 'dropup'
        onclose: () => void
    }

    let { open, opener, background, inertOutside = false, variant = 'sheet', onclose }: Props = $props()
    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])
    // Exactly one menu entry is checked: the bound persona while it still exists, otherwise the default entry.
    let boundPersonaId = $derived(DBState.db.personas?.find((persona) => persona.id === chat?.bindedPersona)?.id ?? null)

    function choose(id: string | null): void {
        if (!chat) return
        chat.bindedPersona = id ?? ''
        onclose()
    }

    // Close first so focus is back on the tab before Settings records its origin.
    function openSettings(): void {
        onclose()
        void tick().then(openPersonaSettings)
    }

    function menuKey(event: KeyboardEvent): void {
        const items = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])'))
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        let next = at
        if (event.key === 'ArrowDown') next = (at + 1) % items.length
        else if (event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = items.length - 1
        else return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        items[next]?.focus()
    }
</script>

{#if variant === 'dropup'}
    <ShellSheet {open} kind="menu" mode="wide-menu" placement="above" label={language.chatShellChoosePersona} {opener} {background} {inertOutside} {onclose}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div role="none" onkeydown={menuKey}>
            <button role="menuitemradio" data-part="chat-sheet-item" data-kind="button" data-sheet-initial={boundPersonaId === null ? '' : undefined} aria-checked={boundPersonaId === null} onclick={() => choose(null)}>
                {DBState.db.username}
            </button>
            {#each DBState.db.personas ?? [] as persona (persona.id)}
                <button role="menuitemradio" data-part="chat-sheet-item" data-kind="button" data-sheet-initial={boundPersonaId === persona.id ? '' : undefined} aria-checked={boundPersonaId === persona.id} onclick={() => choose(persona.id)}>
                    {persona.name}
                </button>
            {/each}
            <button role="menuitem" data-part="chat-persona-settings" data-kind="button" onclick={openSettings}>
                {language.chatShellPersonaSettings}
            </button>
        </div>
    </ShellSheet>
{:else}
    <ShellSheet {open} kind="sheet" mode={typeof window !== 'undefined' && window.innerWidth >= 900 ? 'wide-menu' : 'bottom'} label={language.chatShellChoosePersona} {opener} {background} {inertOutside} {onclose}>
        <h2 data-part="chat-sheet-title">{language.chatShellChoosePersona}</h2>
        <button data-part="chat-sheet-item" data-kind="button" data-sheet-initial aria-pressed={!chat?.bindedPersona} onclick={() => choose(null)}>
            {DBState.db.username}
        </button>
        {#each DBState.db.personas ?? [] as persona (persona.id)}
            <button data-part="chat-sheet-item" data-kind="button" aria-pressed={chat?.bindedPersona === persona.id || (!chat?.bindedPersona && DBState.db.personas?.[DBState.db.selectedPersona]?.id === persona.id)} onclick={() => choose(persona.id)}>
                {persona.name}
            </button>
        {/each}
    </ShellSheet>
{/if}

<style>
    [data-part="chat-sheet-title"] { margin: 0 0 var(--space-7); font-size: var(--font-size-xl); }
    [data-part="chat-sheet-item"], [data-part="chat-persona-settings"] { display: block; width: 100%; min-height: var(--size-touch); padding: var(--space-7) var(--space-10); text-align: left; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="chat-sheet-item"][aria-pressed="true"], [data-part="chat-sheet-item"][aria-checked="true"] { background: var(--nexus-surface-raised); }
    [role="menuitemradio"], [data-part="chat-persona-settings"] { white-space: normal; overflow-wrap: anywhere; text-align: start; }
</style>
