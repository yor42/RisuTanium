<script lang="ts">
    import { ArrowLeft, ChevronDownIcon, HistoryIcon, PanelLeftIcon, SearchIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import type { StudioLayout } from '../../ts/studio/studioLayout'

    interface Props {
        layout: StudioLayout
        drawerOpen: boolean
        searchOpen: boolean
        onback: () => void
        // The phone title is the way to the owner list.
        ontitle: () => void
        ondrawer: () => void
        onsearch: () => void
        // The History entry point: shown when a handler is given. It is disabled while the selection has no history.
        historyOpen?: boolean
        historyAvailable?: boolean
        onhistory?: () => void
    }

    let { layout, drawerOpen, searchOpen, onback, ontitle, ondrawer, onsearch, historyOpen = false, historyAvailable = true, onhistory }: Props = $props()

    const buttonClass = 'flex h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer'
</script>

<header data-part="studio-header" class="flex shrink-0 items-center gap-1 border-b border-darkborderc bg-darkbg px-2 text-textcolor">
    <button type="button" class={buttonClass} aria-label={language.settingsPage.back} data-part="studio-back" onclick={onback}>
        <ArrowLeft size={18} />
    </button>
    {#if layout === 'drawer'}
        <button type="button" class={buttonClass} aria-label={language.studioTreeLabel} aria-expanded={drawerOpen} data-part="studio-drawer-toggle" onclick={ondrawer}>
            <PanelLeftIcon size={18} />
        </button>
    {/if}
    {#if layout === 'stack'}
        <button type="button" class="{buttonClass} min-w-0 flex-1 justify-start font-bold text-textcolor" data-part="studio-title" onclick={ontitle}>
            <span class="truncate">{language.studioTitle}</span>
            <ChevronDownIcon size={16} />
        </button>
    {:else}
        <h1 class="min-w-0 flex-1 truncate px-2 text-base font-bold" data-part="studio-title">{language.studioTitle}</h1>
    {/if}
    <button type="button" class={buttonClass} aria-label={language.studioSearch} aria-expanded={searchOpen} aria-keyshortcuts="Control+K Meta+K" data-part="studio-search-toggle" onclick={onsearch}>
        <SearchIcon size={18} />
    </button>
    {#if onhistory}
        <button type="button" class={buttonClass} aria-label={language.studioHistory} aria-expanded={historyOpen} disabled={!historyAvailable && !historyOpen} data-part="studio-history-toggle" onclick={onhistory}>
            <HistoryIcon size={18} />
        </button>
    {/if}
</header>
