<script lang="ts">
    import { onDestroy } from 'svelte'
    import WindowedSegment from '../UI/Windowed/WindowedSegment.svelte'
    import SelectCharCard from './SelectCharCard.svelte'
    import { createWindowHost } from '../../ts/windowing/windowHost.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import { gridTrackCount, pickableCharacterPositions, selectCharRows, type SelectCharRow } from './selectCharGrid'

    /**
     * The avatar grid of the selectChar dialog, windowed: only the grid rows near the dialog's
     * scroll view are in the page. Each windowed row is one grid line of cards; the stylesheet
     * lays every row out with the same auto-fill tracks, and the number of cards per row is read
     * back from a mounted row's computed tracks, so the cut follows the dialog's width.
     */
    interface Props {
        onPick: (chaId: string) => void
    }

    let { onPick }: Props = $props()

    // Cards per row until a mounted row reports its real track count.
    const INITIAL_COLUMNS = 4
    // Height of a row that has not been measured yet: a 3.5rem avatar, a two-line caption and the row gap.
    const ROW_FALLBACK_PX = 120

    let container = $state<HTMLElement | null>(null)
    let columns = $state(INITIAL_COLUMNS)

    const rows = $derived(selectCharRows(pickableCharacterPositions(DBState.db.characters), columns))
    const rowByKey = $derived(new Map<string, SelectCharRow>(rows.map((row) => [row.key, row])))
    const rowKeys = $derived(rows.map((row) => row.key))

    const windowHost = createWindowHost({ root: () => container })
    onDestroy(() => windowHost.dispose())

    function readColumns(): void {
        const row = container?.querySelector('[data-window-key]')
        if (!row) {
            return
        }
        const count = gridTrackCount(getComputedStyle(row).gridTemplateColumns)
        if (count > 0 && count !== columns) {
            columns = count
        }
    }

    // The container resizes when the dialog's width changes and when the first rows mount,
    // which are the two moments the track count can differ from the current cut.
    $effect(() => {
        const element = container
        if (!element || typeof ResizeObserver === 'undefined') {
            return
        }
        const observer = new ResizeObserver(() => readColumns())
        observer.observe(element)
        return () => observer.disconnect()
    })
</script>

<div data-part="pattern-alert-chars" bind:this={container}>
    <WindowedSegment host={windowHost} keys={rowKeys} height={{ fallback: ROW_FALLBACK_PX }}>
        {#snippet item(key)}
            {@const row = rowByKey.get(key)}
            {#if row}
                {#each row.positions as position (position)}
                    {@const char = DBState.db.characters[position]}
                    {#if char}
                        <SelectCharCard name={char.name} image={char.image} onPick={() => onPick(char.chaId)} />
                    {/if}
                {/each}
            {/if}
        {/snippet}
    </WindowedSegment>
</div>
