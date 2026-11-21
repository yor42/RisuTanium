<script lang="ts">
    import { language } from 'src/lang'
    import type { PeerConflictRowView } from 'src/ts/alert'

    /**
     * The per-record conflict dialog: one row per record both tabs changed, each with its choices, every row preselected,
     * a "same choice for all" control and Apply. It is not closable: only Apply answers, with the JSON of
     * `{ [row id]: choice }`. Every text is a text binding; a name never becomes markup. The title carries `titleId`, so the
     * host dialog is named by the title alone and not by the whole body.
     */
    interface Props {
        rows: readonly PeerConflictRowView[]
        title: string
        titleId?: string
        onanswer: (message: string) => void
    }

    let { rows, title, titleId, onanswer }: Props = $props()

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

<div data-part="pattern-alert-stack" data-peer-conflicts>
    <p id={titleId} data-part="pattern-alert-title">{title}</p>
    <div data-part="pattern-alert-bulk">
        <span>{text.peerSameForAll}</span>
        {#each ALL_CHOICES as choice}
            <button type="button" class="pattern-button" onclick={() => setAll(choice)}>{labelOf[choice]}</button>
        {/each}
    </div>
    {#each rows as row (row.id)}
        <fieldset data-part="pattern-alert-conflict" data-conflict-row={row.id}>
            <legend>{row.label}</legend>
            {#each row.choices as choice}
                <label data-part="pattern-alert-choice">
                    <input type="radio" name={`peer-conflict-${row.id}`} value={choice} aria-label={labelOf[choice]} checked={choiceOf(row) === choice}
                        onchange={() => { chosen = { ...chosen, [row.id]: choice } }} />
                    <span>{labelOf[choice]}</span>
                </label>
            {/each}
            {#if row.note !== null}
                <p data-part="pattern-alert-note" data-conflict-note>{row.note}</p>
            {/if}
        </fieldset>
    {/each}
</div>
<div data-part="pattern-warn-actions" data-count="1">
    <button type="button" class="pattern-button" data-variant="confirm" onclick={apply}>{text.peerConflictApply}</button>
</div>
