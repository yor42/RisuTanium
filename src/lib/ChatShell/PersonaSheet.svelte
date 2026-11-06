<script lang="ts">
    import { DBState, selIdState } from '../../ts/stores.svelte'
    import { language } from '../../lang'
    import ShellSheet from './ShellSheet.svelte'

    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        onclose: () => void
    }

    let { open, opener, background, onclose }: Props = $props()
    let character = $derived(DBState.db.characters[selIdState.selId])
    let chat = $derived(character?.chats?.[character.chatPage])

    function choose(id: string | null): void {
        if (!chat) return
        chat.bindedPersona = id ?? ''
        onclose()
    }
</script>

<ShellSheet {open} kind="sheet" mode={typeof window !== 'undefined' && window.innerWidth >= 900 ? 'wide-menu' : 'bottom'} label={language.chatShellChoosePersona} {opener} {background} {onclose}>
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

<style>
    [data-part="chat-sheet-title"] { margin: 0 0 var(--space-7); font-size: var(--font-size-xl); }
    [data-part="chat-sheet-item"] { display: block; width: 100%; min-height: var(--size-touch); padding: var(--space-7) var(--space-10); text-align: left; color: var(--nexus-text); border-bottom: 1px solid var(--nexus-edge); }
    [data-part="chat-sheet-item"][aria-pressed="true"] { background: var(--nexus-surface-raised); }
</style>
