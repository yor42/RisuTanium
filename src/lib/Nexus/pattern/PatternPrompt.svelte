<script lang="ts">
    import PatternDialog from './PatternDialog.svelte'
    import { encodeChoice, encodeText, PATTERN_PROMPT_CANCEL } from '../../../ts/patternPromptAnswer'

    interface Props {
        kind: 'select' | 'input'
        heading: string
        choices?: readonly string[]
        defaultValue?: string
        datalist?: readonly (readonly [string, string])[]
        /** Called once with the encoded answer; later presses are ignored. */
        onanswer: (message: string) => void
        trigger?: HTMLElement | null
        background?: readonly HTMLElement[]
        lowPower?: boolean
        /** Button labels, already translated. */
        labels?: { cancel?: string, ok?: string }
    }

    let { kind, heading, choices = [], defaultValue = '', datalist = [], onanswer, trigger = null, background = [], lowPower = false, labels = {} }: Props = $props()

    const uid = $props.id()
    const headingId = `${uid}-heading`
    const listId = `${uid}-list`

    let text = $state('')
    let answered = false

    $effect(() => {
        text = defaultValue
    })

    function answer(message: string) {
        if (answered) return
        answered = true
        onanswer(message)
    }

    function onFieldKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault()
            answer(encodeText(text))
        }
    }
</script>

<PatternDialog
    labelId={headingId}
    cancelSafe={true}
    oncancel={() => answer(PATTERN_PROMPT_CANCEL)}
    {trigger}
    {background}
    {lowPower}
>
    <div data-part="pattern-prompt-root" data-part-critical data-kind={kind}>
        <h2 id={headingId} data-part="pattern-prompt-heading" data-part-critical>{heading}</h2>

        {#if kind === 'select'}
            <div data-part="pattern-prompt-choices" data-part-critical>
                {#each choices as choice, index (index)}
                    <button type="button" class="pattern-button" data-part="pattern-prompt-choice" data-part-critical data-pattern-initial={index === 0 ? '' : undefined} onclick={() => answer(encodeChoice(index))}>{choice}</button>
                {/each}
            </div>
        {:else}
            <input
                type="text"
                data-part="pattern-prompt-field"
                data-part-critical
                data-pattern-initial
                aria-labelledby={headingId}
                list={datalist.length > 0 ? listId : undefined}
                bind:value={text}
                onkeydown={onFieldKeydown}
            />
            {#if datalist.length > 0}
                <datalist id={listId}>
                    {#each datalist as entry, index (index)}
                        <option value={entry[0]}>{entry[1]}</option>
                    {/each}
                </datalist>
            {/if}
        {/if}

        <div data-part="pattern-prompt-actions" data-part-critical>
            <button type="button" class="pattern-button" data-part="pattern-prompt-cancel" data-part-critical onclick={() => answer(PATTERN_PROMPT_CANCEL)}>{labels.cancel ?? 'Cancel'}</button>
            {#if kind === 'input'}
                <button type="button" class="pattern-button" data-part="pattern-prompt-ok" data-part-critical data-variant="confirm" onclick={() => answer(encodeText(text))}>{labels.ok ?? 'OK'}</button>
            {/if}
        </div>
    </div>
</PatternDialog>

<style>
    [data-part="pattern-prompt-root"] { display: grid; gap: var(--pattern-warn-gap, 0.75rem); padding: var(--pattern-warn-padding, 1rem); color: var(--nexus-text); font-family: var(--font); }
    [data-part="pattern-prompt-heading"] { margin: 0; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
    [data-part="pattern-prompt-choices"] { display: grid; gap: var(--pattern-warn-gap, 0.75rem); max-height: 50vh; overflow-y: auto; }
    [data-part="pattern-prompt-field"] { min-height: var(--nexus-touch, 2.75rem); padding: 0 0.75rem; color: var(--nexus-text); background: var(--nexus-surface-flat); border: 1px solid var(--nexus-field-border); border-radius: var(--radius-field); font: inherit; }
    [data-part="pattern-prompt-field"]:focus-visible { outline: var(--nexus-focus-ring-width, 2px) solid var(--nexus-ring); outline-offset: var(--nexus-focus-ring-offset, 2px); }
    [data-part="pattern-prompt-actions"] { display: flex; gap: var(--pattern-warn-gap, 0.75rem); justify-content: flex-end; }
    [data-part="pattern-prompt-actions"] > :global(.pattern-button) { flex: 1 1 0; }
</style>
