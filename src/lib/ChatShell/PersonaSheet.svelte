<script lang="ts">
    import { onDestroy, tick } from 'svelte'
    import CheckIcon from '@lucide/svelte/icons/check'
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import type { CharImageLookups } from '../../ts/media/charImageLookups'
    import { warnOnReject } from '../../ts/warnOnReject'
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

    // Rows read their images only while the sheet is open (the sheet renders nothing otherwise), and the image module loads on the first row that has one.
    // The holds end with the component (ChatShell unmount), not when the sheet closes.
    let lookups: CharImageLookups | null = null
    let gone = false
    onDestroy(() => { gone = true; lookups?.dispose() })
    function avatarCss(slot: string, icon: string): Promise<string | null> {
        return import('../../ts/media/charImageLookups').then(({ createCharImageLookups }) => {
            if (gone) return null
            lookups ??= createCharImageLookups()
            return lookups.get(slot, icon, 'css')
        })
    }
    const initialOf = (name: string): string => Array.from(name.trim())[0]?.toUpperCase() ?? ''

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

{#snippet avatar(css: string | null, name: string)}
    <span class="avatar" data-round={DBState.db.roundIcons ? '' : undefined} data-initial={css ? undefined : initialOf(name)} style={css ?? undefined} aria-hidden="true"></span>
{/snippet}

<!-- The mark and the avatar are decoration: the checked state stays on the row's aria-checked or aria-pressed. -->
{#snippet row(name: string, slot: string, icon: string, checked: boolean, isDefault: boolean)}
    {#if icon === ''}
        {@render avatar(null, name)}
    {:else}
        {#await warnOnReject('PersonaSheet: persona icon rejected', avatarCss(slot, icon))}
            {@render avatar(null, name)}
        {:then css}
            {@render avatar(css, name)}
        {:catch}
            {@render avatar(null, name)}
        {/await}
    {/if}
    <span class="text"><span>{name}</span>{#if isDefault}<span class="note">{language.chatShellPersonaDefault}</span>{/if}</span>
    {#if checked}<CheckIcon aria-hidden="true" />{/if}
{/snippet}

{#if variant === 'dropup'}
    <ShellSheet {open} kind="menu" mode="wide-menu" placement="above" label={language.chatShellChoosePersona} {opener} {background} {inertOutside} {onclose}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div role="none" onkeydown={menuKey}>
            <button role="menuitemradio" data-part="chat-sheet-item" data-kind="button" data-sheet-initial={boundPersonaId === null ? '' : undefined} aria-checked={boundPersonaId === null} onclick={() => choose(null)}>{@render row(DBState.db.username, 'user', DBState.db.userIcon ?? '', boundPersonaId === null, true)}</button>
            {#each DBState.db.personas ?? [] as persona, index (persona.id)}
                <button role="menuitemradio" data-part="chat-sheet-item" data-kind="button" data-sheet-initial={boundPersonaId === persona.id ? '' : undefined} aria-checked={boundPersonaId === persona.id} onclick={() => choose(persona.id)}>{@render row(persona.name, 'persona:' + index, persona.icon ?? '', boundPersonaId === persona.id, false)}</button>
            {/each}
            <button role="menuitem" data-part="chat-persona-settings" data-kind="button" onclick={openSettings}>
                {language.chatShellPersonaSettings}
            </button>
        </div>
    </ShellSheet>
{:else}
    <ShellSheet {open} kind="sheet" mode={typeof window !== 'undefined' && window.innerWidth >= 900 ? 'wide-menu' : 'bottom'} label={language.chatShellChoosePersona} {opener} {background} {inertOutside} {onclose}>
        <h2 data-part="chat-sheet-title">{language.chatShellChoosePersona}</h2>
        <button data-part="chat-sheet-item" data-kind="button" data-sheet-initial aria-pressed={!chat?.bindedPersona} onclick={() => choose(null)}>{@render row(DBState.db.username, 'user', DBState.db.userIcon ?? '', !chat?.bindedPersona, true)}</button>
        {#each DBState.db.personas ?? [] as persona, index (persona.id)}
            {@const pressed = chat?.bindedPersona === persona.id}
            <button data-part="chat-sheet-item" data-kind="button" aria-pressed={pressed} onclick={() => choose(persona.id)}>{@render row(persona.name, 'persona:' + index, persona.icon ?? '', pressed, false)}</button>
        {/each}
    </ShellSheet>
{/if}

<style>
    [data-part="chat-sheet-title"] { margin: 0 0 var(--space-7); font-size: var(--font-size-xl); }
    [data-part="chat-sheet-item"] > .text { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
    [data-part="chat-sheet-item"] .note { font-size: var(--font-size-xs); color: var(--nexus-text-secondary); }
    [data-part="chat-sheet-item"] .avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: var(--size-avatar-sm); height: var(--size-avatar-sm); border-radius: var(--radius-4); background-color: var(--nexus-surface-raised); background-size: cover; background-position: center; }
    [data-part="chat-sheet-item"] .avatar[data-round] { border-radius: var(--radius-circle); }
    [data-part="chat-sheet-item"] .avatar[data-initial]::before { content: attr(data-initial); font-size: var(--font-size-xs); }
    [data-part="chat-sheet-item"] :global(svg) { flex: none; width: calc(var(--icon-size-sm) * var(--icon-scale)); height: calc(var(--icon-size-sm) * var(--icon-scale)); stroke-width: var(--icon-stroke); color: var(--nexus-accent); }
    [data-part="chat-sheet-item"] { display: flex; align-items: center; gap: var(--space-7); }
    [data-part="chat-persona-settings"] { display: block; }
    [data-part="chat-sheet-item"], [data-part="chat-persona-settings"] { width: 100%; min-height: var(--size-touch); padding: var(--space-7) var(--space-10); text-align: left; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="chat-sheet-item"][aria-pressed="true"], [data-part="chat-sheet-item"][aria-checked="true"] { background: var(--nexus-surface-raised); }
    [role="menuitemradio"], [data-part="chat-persona-settings"] { white-space: normal; overflow-wrap: anywhere; text-align: start; }
</style>
