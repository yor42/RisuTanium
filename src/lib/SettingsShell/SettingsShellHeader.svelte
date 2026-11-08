<script lang="ts">
    import { ArrowLeftIcon, SearchIcon, XIcon } from '@lucide/svelte'
    import { language } from '../../lang'

    interface Props {
        /** What Back does next: the origin, the settings menu or a plain Back. It is also the button's accessible name. */
        backLabel: string
        title: string
        phone: boolean
        onback: () => void
        /** Whether the search is open: on a phone the field then replaces the title. */
        searchOpen: boolean
        query: string
        /** Whether a results list is on screen, for the combobox state. */
        resultsShown: boolean
        listboxId: string
        activeOptionId: string | undefined
        onsearchopen: () => void
        onsearchclose: () => void
        onquery: (value: string) => void
        onsearchkeydown: (event: KeyboardEvent) => void
    }
    let {
        backLabel, title, phone, onback, searchOpen, query, resultsShown, listboxId, activeOptionId,
        onsearchopen, onsearchclose, onquery, onsearchkeydown,
    }: Props = $props()

    let field = $state<HTMLInputElement>()

    /** Moves focus into the search field, where Ctrl+K and `/` land. */
    export function focusSearch(): void {
        field?.focus()
    }
</script>

<header class="flex items-center gap-2 px-2 shrink-0 bg-darkbg text-textcolor border-b border-darkborderc" style:min-height={phone ? '48px' : '56px'} data-part="settings-header">
    <button type="button" class="flex items-center gap-2 px-2 min-h-11 min-w-11 rounded-md hover:text-textcolor text-textcolor2 hover:bg-darkbutton" data-part="settings-back" aria-label={backLabel} onclick={onback}>
        <ArrowLeftIcon aria-hidden="true" />
        {#if !phone}<span>{backLabel}</span>{/if}
    </button>
    {#if !(phone && searchOpen)}
        <div class="flex flex-col min-w-0 grow">
            <h1 class="font-semibold truncate" data-part="settings-title">{title}</h1>
            {#if phone}<span class="text-xs text-textcolor2 truncate" aria-hidden="true" data-part="settings-back-subtitle">{backLabel}</span>{/if}
        </div>
    {/if}
    {#if phone && !searchOpen}
        <button type="button" class="flex items-center justify-center min-h-11 min-w-11 rounded-md hover:text-textcolor text-textcolor2 hover:bg-darkbutton" data-part="settings-search-open" aria-label={language.settingsShellSearchLabel} title={language.settingsShellSearchLabel} onclick={onsearchopen}>
            <SearchIcon aria-hidden="true" />
        </button>
    {:else}
        <input
            bind:this={field}
            type="text"
            role="combobox"
            class="min-h-11 min-w-0 rounded-md bg-darkbutton px-3 text-textcolor placeholder:text-textcolor2 outline-none focus-visible:ring-2 focus-visible:ring-textcolor2"
            class:grow={phone}
            class:w-64={!phone}
            data-part="settings-search-input"
            placeholder={language.settingsShellSearchLabel}
            aria-label={language.settingsShellSearchLabel}
            aria-autocomplete="list"
            aria-expanded={resultsShown}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            autocomplete="off"
            value={query}
            oninput={(event) => onquery(event.currentTarget.value)}
            onkeydown={onsearchkeydown}
        />
        {#if phone}
            <button type="button" class="flex items-center justify-center min-h-11 min-w-11 rounded-md hover:text-textcolor text-textcolor2 hover:bg-darkbutton" data-part="settings-search-close" aria-label={language.settingsShellSearchClose} title={language.settingsShellSearchClose} onclick={onsearchclose}>
                <XIcon aria-hidden="true" />
            </button>
        {/if}
    {/if}
</header>
