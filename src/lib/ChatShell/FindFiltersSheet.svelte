<script lang="ts">
    import { language } from '../../lang'
    import type { SearchFilters } from '../../ts/chatShell/inChatSearch'
    import ShellSheet from './ShellSheet.svelte'

    /**
     * The search filters: who spoke, images, thinking and a date range in local days.
     *
     * Every control reports its change at once through `onfilters`; the session rescans. "Clear filters" resets all of them.
     */
    interface Props {
        open: boolean
        opener: HTMLElement | null
        background: readonly HTMLElement[]
        filters: SearchFilters
        characterName: string
        onfilters: (patch: Partial<SearchFilters>) => void
        onclear: () => void
        onclose: () => void
    }
    let { open, opener, background, filters, characterName, onfilters, onclear, onclose }: Props = $props()

    const SPEAKERS: readonly SearchFilters['speaker'][] = ['any', 'me', 'char']

    function speakerLabel(speaker: SearchFilters['speaker']): string {
        if (speaker === 'me') return language.chatShellFindSpeakerMe
        if (speaker === 'char') return characterName || language.chatShellFindSpeakerChar
        return language.chatShellFindSpeakerAny
    }
</script>

<ShellSheet {open} kind="sheet" mode="side" label={language.chatShellFindFilters} {opener} {background} {onclose}>
    {#if open}
        <div data-part="chat-find-filters" class="filters-body">
            <h2 data-part="chat-sheet-title" tabindex="-1">{language.chatShellFindFilters}</h2>
            <div class="filters-row" role="radiogroup" aria-label={language.chatShellFindSpeaker}>
                <span class="filters-label">{language.chatShellFindSpeaker}</span>
                <div class="filters-choices">
                    {#each SPEAKERS as speaker, position (speaker)}
                        <button type="button" role="radio" aria-checked={filters.speaker === speaker} data-kind="button" data-sheet-initial={position === 0 ? '' : undefined} class="choice" onclick={() => onfilters({ speaker })}>{speakerLabel(speaker)}</button>
                    {/each}
                </div>
            </div>
            <label class="filters-row filters-switch">
                <span>{language.chatShellFindHasImage}</span>
                <input type="checkbox" role="switch" checked={filters.hasImage} onchange={(event) => onfilters({ hasImage: event.currentTarget.checked })} />
            </label>
            <label class="filters-row filters-switch">
                <span>{language.chatShellFindIncludeThinking}</span>
                <input type="checkbox" role="switch" checked={filters.thinking} onchange={(event) => onfilters({ thinking: event.currentTarget.checked })} />
            </label>
            <div class="filters-row">
                <span class="filters-label">{language.chatShellFindDate}</span>
                <div class="filters-dates">
                    <label for="find-from-field">{language.chatShellFindFrom}</label>
                    <input id="find-from-field" type="date" value={filters.from} onchange={(event) => onfilters({ from: event.currentTarget.value })} />
                    <label for="find-to-field">{language.chatShellFindTo}</label>
                    <input id="find-to-field" type="date" value={filters.to} onchange={(event) => onfilters({ to: event.currentTarget.value })} />
                </div>
            </div>
            <button type="button" data-kind="button" class="clear" onclick={onclear}>{language.chatShellFindClearFilters}</button>
        </div>
    {/if}
</ShellSheet>

<style>
    .filters-body { display: flex; flex-direction: column; gap: var(--space-5); }
    [data-part="chat-sheet-title"] { margin: 0 0 var(--space-7); font-size: var(--font-size-xl); }
    [data-part="chat-sheet-title"]:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    .filters-row { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) var(--space-10); border-bottom: 1px solid var(--nexus-edge); }
    .filters-switch { flex-direction: row; align-items: center; justify-content: space-between; min-height: var(--size-touch); }
    .filters-label { font-size: var(--font-size-sm); color: var(--nexus-text-secondary); }
    .filters-choices { display: flex; flex-wrap: wrap; gap: var(--space-5); }
    .choice { min-height: var(--size-touch); padding: 0 var(--space-10); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    .choice[aria-checked="true"] { border-color: var(--nexus-text); border-width: var(--stroke-bold); }
    .filters-dates { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: var(--space-5); }
    .filters-dates input { min-width: 0; min-height: var(--size-touch); padding: 0 var(--space-7); color: var(--nexus-text); background: var(--nexus-surface-raised); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    .clear { min-height: var(--size-touch); margin: var(--space-5) var(--space-10); color: var(--nexus-text); border: 1px solid var(--nexus-edge); border-radius: var(--radius-control); }
    .filters-body :is(button, input):focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
</style>
