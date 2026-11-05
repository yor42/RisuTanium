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

<ShellSheet {open} kind="sheet" label={language.chatShellChoosePersona} {opener} {background} {onclose}>
    <h2 data-part="chat-persona-title">{language.chatShellChoosePersona}</h2>
    <button data-part="chat-persona-row" data-sheet-initial aria-pressed={!chat?.bindedPersona} onclick={() => choose(null)}>
        {DBState.db.username}
    </button>
    {#each DBState.db.personas ?? [] as persona (persona.id)}
        <button data-part="chat-persona-row" aria-pressed={chat?.bindedPersona === persona.id || (!chat?.bindedPersona && DBState.db.personas?.[DBState.db.selectedPersona]?.id === persona.id)} onclick={() => choose(persona.id)}>
            {persona.name}
        </button>
    {/each}
</ShellSheet>

<style>
    [data-part="chat-persona-title"] { margin: 0 0 8px; font-size: 1.1rem; }
    [data-part="chat-persona-row"] { display: block; width: 100%; min-height: 44px; padding: 8px 12px; text-align: left; color: var(--color-textcolor); border-bottom: 1px solid var(--color-darkborderc); }
    [data-part="chat-persona-row"][aria-pressed="true"] { background: var(--color-selected); }
</style>
