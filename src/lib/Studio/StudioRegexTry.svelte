<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { tryRegexEntry, type RegexCheckEntry, type RegexTryResult } from '../../ts/studio/edit/regexCheck'

    // Runs the one entry of the form on a sample typed here. The sample and the result live in this component only: nothing
    // is written, no history step is made and no chat or emotion state is touched. The entry is read live at each use.
    interface Props {
        read: () => RegexCheckEntry | null
    }

    let { read }: Props = $props()

    const uid = $props.id()

    let open = $state(false)
    let sample = $state('')
    let result = $state<RegexTryResult | null>(null)

    const live = $derived(read())
    // The stage decides it: a stage the engines never read has nothing to try.
    const neverRuns = $derived(live !== null && tryRegexEntry(live, '').outcome === 'neverRuns')
    // Any change of the entry makes a shown result stale, so it is cleared.
    const signature = $derived(live === null ? '' : JSON.stringify([live.in, live.out, live.type, live.flag, live.ableFlag]))
    $effect(() => {
        void signature
        untrack(() => { result = null })
    })

    function run(): void {
        const entry = read()
        if (entry === null) return
        result = tryRegexEntry(entry, sample)
    }

    const noteClass = 'text-sm text-textcolor2'
    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 text-sm cursor-pointer'
</script>

{#if live !== null}
    <div data-part="studio-regex-try" class="flex flex-col gap-2">
        <button
            type="button"
            data-part="studio-regex-try-toggle"
            class="{buttonClass} self-start font-bold text-textcolor"
            aria-expanded={open}
            aria-controls="{uid}-body"
            onclick={() => { open = !open }}
        >{language.studioRegexTryTitle}</button>
        {#if open}
            <div id="{uid}-body" class="flex flex-col gap-2">
                {#if neverRuns}
                    <p data-part="studio-regex-try-never" class={noteClass}>{language.studioRegexTryStageNeverRuns}</p>
                {:else}
                    <label for="{uid}-sample" class="font-bold">{language.studioRegexTrySample}</label>
                    <textarea
                        id="{uid}-sample"
                        data-part="studio-regex-try-sample"
                        class="min-h-24 w-full rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor"
                        bind:value={sample}
                    ></textarea>
                    <button type="button" data-part="studio-regex-try-run" class="{buttonClass} self-start bg-selected text-textcolor" onclick={run}>{language.studioRegexTryRun}</button>
                    <div data-part="studio-regex-try-result" aria-live="polite" class="flex flex-col gap-1">
                        {#if result !== null}
                            {#if result.outcome === 'emptyFind'}
                                <p data-part="studio-regex-try-note" class={noteClass}>{language.studioRegexEmptyFind}</p>
                            {:else if result.outcome === 'invalid'}
                                <p data-part="studio-regex-try-note" class="text-sm text-draculared">{language.studioRegexInvalid(result.message)}</p>
                            {:else if result.outcome === 'cbsFind'}
                                <p data-part="studio-regex-try-note" class={noteClass}>{language.studioRegexNotCheckedCbs}</p>
                            {:else if result.outcome === 'ran'}
                                <p data-part="studio-regex-try-count" class="text-sm text-textcolor">{result.count === 0 ? language.studioRegexTryNoMatch : language.studioRegexTryMatches(result.count)}</p>
                                {#if result.spans.length > 0}
                                    <ul data-part="studio-regex-try-spans" class="flex flex-col gap-1 text-sm text-textcolor">
                                        {#each result.spans as span, spanIndex (spanIndex)}
                                            <li data-part="studio-regex-try-span" class="break-all">{span.index}: {span.text}</li>
                                        {/each}
                                    </ul>
                                {/if}
                                {#if result.directive}
                                    <p data-part="studio-regex-try-directive" class={noteClass}>{language.studioRegexTryDirectiveNotRun}</p>
                                {:else if result.text !== null}
                                    <span class="font-bold">{language.studioRegexTryResult}</span>
                                    <pre data-part="studio-regex-try-text" class="whitespace-pre-wrap break-words rounded-md border border-darkborderc bg-darkbg p-2 text-textcolor">{result.text}</pre>
                                {/if}
                                {#if result.engine === 'main'}
                                    <p data-part="studio-regex-try-cbs" class={noteClass}>{language.studioRegexTryCbsNotRun}</p>
                                {:else}
                                    <p data-part="studio-regex-try-engine" class={noteClass}>{language.studioRegexTryTranslationEngine}</p>
                                {/if}
                                <p data-part="studio-regex-try-one" class={noteClass}>{language.studioRegexTryOneEntry}</p>
                            {/if}
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
{/if}
