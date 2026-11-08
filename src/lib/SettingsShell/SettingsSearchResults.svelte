<script module lang="ts">
    import { language } from '../../lang'
    import type { SearchHit, SearchOutcome } from '../../ts/setting/settingsSearch'

    export type ResultRow =
        | { kind: 'hit', optionId: string, hit: SearchHit }
        | { kind: 'more', optionId: string, block: 'setting' | 'page', count: number }

    export interface ResultBlock {
        key: 'pinned' | 'setting' | 'page'
        label: string
        /** The pinned pages sit on top without a heading of their own. */
        showLabel: boolean
        rows: ResultRow[]
    }

    /**
     * The blocks of an outcome in display order, each row with its option id. A group shows its first hits and a
     * "show all" row until its kind is in `expanded`; the flat row order is the order the keyboard walks.
     */
    export function resultBlocksOf(outcome: SearchOutcome, expanded: ReadonlySet<string>, idPrefix: string): ResultBlock[] {
        const blocks: ResultBlock[] = []
        let next = 0
        const optionId = (): string => `${idPrefix}-option-${next++}`
        if (outcome.pinned.length > 0) {
            blocks.push({
                key: 'pinned',
                label: language.settingsShellSearchGroupPages,
                showLabel: false,
                rows: outcome.pinned.map((hit): ResultRow => ({ kind: 'hit', optionId: optionId(), hit })),
            })
        }
        for (const group of outcome.groups) {
            if (group.hits.length === 0) continue
            const all = expanded.has(group.kind)
            const rows = (all ? group.hits : group.shown).map((hit): ResultRow => ({ kind: 'hit', optionId: optionId(), hit }))
            if (!all && group.hits.length > group.shown.length) {
                rows.push({ kind: 'more', optionId: optionId(), block: group.kind, count: group.hits.length })
            }
            blocks.push({
                key: group.kind,
                label: group.kind === 'setting' ? language.settingsShellSearchGroupSettings : language.settingsShellSearchGroupPages,
                showLabel: true,
                rows,
            })
        }
        return blocks
    }

    /** How many hits an outcome holds, pinned pages included. */
    export function hitCountOf(outcome: SearchOutcome): number {
        return outcome.pinned.length + outcome.groups.reduce((sum, group) => sum + group.hits.length, 0)
    }
</script>

<script lang="ts">
    import { pageEntry, pageForIndex, settingsLabel } from '../../ts/settingsShell/settingsPages'

    interface Props {
        blocks: ResultBlock[]
        query: string
        /** The retry found only some of the words. */
        partial: boolean
        listboxId: string
        activeOptionId: string | undefined
        onopen: (hit: SearchHit) => void
        onexpand: (block: 'setting' | 'page') => void
        onclear: () => void
        onbrowse: () => void
    }
    let { blocks, query, partial, listboxId, activeOptionId, onopen, onexpand, onclear, onbrowse }: Props = $props()

    /** Where a setting lives, for the line under its label; pages need none. */
    function crumbOf(hit: SearchHit): string | null {
        if (hit.entry.kind !== 'setting') return null
        const located = pageForIndex(hit.entry.target.index)
        return located ? settingsLabel(pageEntry(located.page).labelKey) : null
    }
</script>

<div class="grow min-w-0 min-h-0 overflow-y-auto px-4 py-4" data-part="settings-search-results">
    {#if blocks.length === 0}
        <div class="flex flex-col items-start gap-3" data-part="settings-search-none">
            <p class="text-textcolor">{language.settingsShellSearchNone(query.trim())}</p>
            <div class="flex flex-wrap gap-2">
                <button type="button" class="px-3 min-h-11 rounded-md bg-darkbutton hover:text-textcolor text-textcolor2" data-part="settings-search-clear" onclick={onclear}>{language.settingsShellSearchClear}</button>
                <button type="button" class="px-3 min-h-11 rounded-md bg-darkbutton hover:text-textcolor text-textcolor2" data-part="settings-search-browse" onclick={onbrowse}>{language.settingsShellSearchBrowse}</button>
            </div>
        </div>
    {:else}
        {#if partial}
            <p class="text-sm text-textcolor2 mb-3" data-part="settings-search-partial">{language.settingsShellSearchPartial}</p>
        {/if}
        <div role="listbox" id={listboxId} aria-label={language.settingsShellSearchResultsLabel} class="flex flex-col gap-4">
            {#each blocks as block (block.key)}
                <div role="group" aria-label={block.label} data-part="settings-search-group" data-group={block.key}>
                    {#if block.showLabel}
                        <div class="text-sm text-textcolor2 mb-1" aria-hidden="true">{block.label}</div>
                    {/if}
                    {#each block.rows as row (row.optionId)}
                        {@const active = row.optionId === activeOptionId}
                        <!-- Keys are handled by the combobox field; the options are clicked or touched. -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div
                            role="option"
                            id={row.optionId}
                            tabindex="-1"
                            aria-selected={active}
                            class="flex flex-col justify-center min-h-11 px-3 py-1 rounded-md cursor-pointer hover:bg-darkbutton"
                            class:bg-darkbutton={active}
                            data-part={row.kind === 'hit' ? 'settings-search-result' : 'settings-search-more'}
                            data-result={row.kind === 'hit' ? row.hit.entry.id : undefined}
                            onclick={() => { if (row.kind === 'hit') onopen(row.hit); else onexpand(row.block) }}
                        >
                            {#if row.kind === 'hit'}
                                <span class="text-textcolor">
                                    {#each row.hit.label as segment}{#if segment.marked}<mark class="bg-transparent text-textcolor font-bold underline">{segment.text}</mark>{:else}{segment.text}{/if}{/each}
                                </span>
                                {@const crumb = crumbOf(row.hit)}
                                {#if crumb}<span class="text-xs text-textcolor2">{crumb}</span>{/if}
                            {:else}
                                <span class="text-textcolor2">{language.settingsShellSearchShowAll(row.count)}</span>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    {/if}
</div>
