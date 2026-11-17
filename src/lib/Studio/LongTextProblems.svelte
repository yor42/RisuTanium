<script lang="ts">
    import { language } from '../../lang'
    import type { ProblemRow } from '../../ts/studio/longText/problemsModel'

    // The problems of one long-text field. It only shows the rows the field hands it: a row jumps to its text, and a
    // fix is asked of the field, which applies it only to the text it was computed on. Nothing here writes.
    interface Props {
        rows: readonly ProblemRow[]
        editable: boolean
        onjump: (row: ProblemRow) => void
        onfix: (row: ProblemRow) => void
    }

    let { rows, editable, onjump, onfix }: Props = $props()

    // The first rows are shown; the rest on request (DESIGN DEFAULT).
    const SHOWN = 20
    let all = $state(false)
    const visible = $derived(all ? rows : rows.slice(0, SHOWN))

    const SEVERITY_TEXT: Record<ProblemRow['severity'], () => string> = {
        error: () => language.ltSeverityError,
        warning: () => language.ltSeverityWarning,
        info: () => language.ltSeverityInfo,
    }

    const SEVERITY_COLOR: Record<ProblemRow['severity'], string> = {
        error: 'text-draculared',
        warning: 'text-textcolor',
        info: 'text-textcolor2',
    }
</script>

{#if rows.length > 0}
    <div data-part="studio-lt-problems" class="flex min-w-0 flex-col gap-1 text-sm">
        <ul class="flex flex-col gap-1">
            {#each visible as row (row.key)}
                <li data-part="studio-lt-problem-row" data-severity={row.severity} data-kind={row.kind} class="flex items-start gap-2 rounded bg-darkbg p-1">
                    <button type="button" data-part="studio-lt-problem-jump" class="flex min-w-0 flex-1 items-start gap-2 text-left hover:text-textcolor" onclick={() => onjump(row)}>
                        <svg data-part="studio-lt-problem-icon" aria-hidden="true" viewBox="0 0 16 16" class="mt-0.5 h-4 w-4 shrink-0 {SEVERITY_COLOR[row.severity]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                            {#if row.severity === 'error'}
                                <circle cx="8" cy="8" r="6.5" /><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
                            {:else if row.severity === 'warning'}
                                <path d="M8 2l6.5 11.5h-13z" /><path d="M8 6.5v3.2M8 11.6v.2" />
                            {:else}
                                <circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.8v.2" />
                            {/if}
                        </svg>
                        <span data-part="studio-lt-problem-severity" class="shrink-0 font-bold {SEVERITY_COLOR[row.severity]}">{SEVERITY_TEXT[row.severity]()}</span>
                        <span data-part="studio-lt-problem-line" class="shrink-0 text-textcolor2">{language.ltProblemLine(row.line)}</span>
                        <span data-part="studio-lt-problem-message" class="min-w-0 break-words">{row.message}</span>
                    </button>
                    {#if row.fix}
                        <button type="button" data-part="studio-lt-problem-fix" class="shrink-0 rounded bg-darkbutton px-2 py-0.5 hover:bg-selected disabled:opacity-50" disabled={!editable} onclick={() => onfix(row)}>{language.ltProblemFix(row.fix.text)}</button>
                    {/if}
                </li>
            {/each}
        </ul>
        {#if rows.length > SHOWN && !all}
            <button type="button" data-part="studio-lt-problems-all" class="self-start rounded px-2 py-0.5 text-textcolor2 hover:text-textcolor" onclick={() => { all = true }}>{language.ltProblemsShowAll(rows.length)}</button>
        {/if}
    </div>
{/if}
