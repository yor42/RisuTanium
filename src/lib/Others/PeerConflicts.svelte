<script lang="ts">
    import { language } from 'src/lang'
    import type { PeerConflictRowView } from 'src/ts/alert'
    import Button from '../UI/GUI/Button.svelte'

    /**
     * The per-record conflict dialog: one row per record both tabs changed, each with its choices, every row preselected,
     * a "same choice for all" control and Apply. It is not closable: only Apply answers, with the JSON of
     * `{ [row id]: choice }`. Every text is a text binding; a name never becomes markup.
     */
    interface Props {
        rows: readonly PeerConflictRowView[]
        title: string
        onanswer: (message: string) => void
    }

    let { rows, title, onanswer }: Props = $props()

    const text = language.store2Boot
    const labelOf = { mine: text.peerKeepMine, theirs: text.peerKeepTheirs, both: text.peerKeepBoth } as const
    const ALL_CHOICES = ['mine', 'theirs', 'both'] as const

    let chosen = $state<Record<string, 'mine' | 'theirs' | 'both'>>({})

    function choiceOf(row: PeerConflictRowView): 'mine' | 'theirs' | 'both' {
        return chosen[row.id] ?? row.preselect
    }

    // A record without a keep-both choice (a deleted record) keeps its edited version when everything is set to both.
    function setAll(choice: 'mine' | 'theirs' | 'both'): void {
        const next: Record<string, 'mine' | 'theirs' | 'both'> = {}
        for (const row of rows) {
            next[row.id] = row.choices.includes(choice) ? choice : row.preselect
        }
        chosen = next
    }

    function apply(): void {
        const answer: Record<string, 'mine' | 'theirs' | 'both'> = {}
        for (const row of rows) {
            answer[row.id] = choiceOf(row)
        }
        onanswer(JSON.stringify(answer))
    }
</script>

<div class="flex flex-col gap-3 max-w-2xl" data-peer-conflicts>
    <div class="text-textcolor">{title}</div>
    <div class="flex flex-wrap items-center gap-2">
        <span class="text-textcolor2 text-sm">{text.peerSameForAll}</span>
        {#each ALL_CHOICES as choice}
            <Button size="sm" styled="outlined" onclick={() => setAll(choice)}>{labelOf[choice]}</Button>
        {/each}
    </div>
    {#each rows as row (row.id)}
        <fieldset class="flex flex-col gap-1 border border-darkborderc rounded-md p-2" data-conflict-row={row.id}>
            <legend class="text-textcolor px-1">{row.label}</legend>
            <div class="flex flex-wrap gap-4">
                {#each row.choices as choice}
                    <label class="flex items-center gap-1 text-textcolor cursor-pointer">
                        <input type="radio" name={`peer-conflict-${row.id}`} value={choice} aria-label={labelOf[choice]} checked={choiceOf(row) === choice}
                            onchange={() => { chosen = { ...chosen, [row.id]: choice } }} />
                        <span>{labelOf[choice]}</span>
                    </label>
                {/each}
            </div>
            {#if row.note !== null}
                <div class="text-textcolor2 text-sm" data-conflict-note>{row.note}</div>
            {/if}
        </fieldset>
    {/each}
    <Button className="mt-2" onclick={apply}>{text.peerConflictApply}</Button>
</div>
