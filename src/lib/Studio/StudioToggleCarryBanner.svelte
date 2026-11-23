<script lang="ts">
    import { language } from '../../lang'
    import type { CarryLine, ToggleBuilder } from '../../ts/studio/toggleBuilder.svelte'

    // The saved-values question of one toggle definition, and the result line of a carry that can still be undone. It
    // never takes focus; the builder's own status region announces it. Dismissed only by an answer or when nothing is
    // left to ask.
    interface Props {
        builder: ToggleBuilder
        editable: boolean
        // The refusal text of the last answer, empty while there is none.
        error?: string
        actions: {
            carry(): void
            answer(): void
            undo(): void
        }
    }

    let { builder, editable, error = '', actions }: Props = $props()

    const titleId = $props.id()
    const question = $derived(builder.question)
    const reach = $derived(builder.carryReach)

    function lineText(line: CarryLine): string {
        switch (line.kind) {
            case 'key': return language.studioTgCarryAskKey(line.from, line.to)
            case 'options': return language.studioTgCarryAskOptions(line.key)
            case 'kind': return language.studioTgCarryAskKind(line.key)
            case 'drop': return language.studioTgCarryAskDrop(line.label)
            case 'unclear': return language.studioTgCarryAskUnclear(line.key)
            case 'late': return line.now === null ? language.studioTgCarryAskOptionsLate(line.key) : language.studioTgCarryAskOptionsLateRenamed(line.key, line.now)
        }
    }
</script>

{#if question !== null}
    <section role="group" aria-labelledby={titleId} data-part="studio-toggle-carry" class="flex flex-col gap-2 rounded-md border border-borderc bg-darkbg p-3">
        <h3 id={titleId} class="font-bold">{language.studioTgCarryTitle}</h3>
        {#each question.lines as line, at (at)}
            <p data-part="studio-toggle-carry-line" data-kind={line.kind} class="text-sm text-textcolor">{lineText(line)}</p>
            {#if line.kind === 'key'}
                <p data-part="studio-toggle-carry-old-stays" class="text-sm text-textcolor2">{language.studioTgCarryOldStays(line.from)}</p>
                {@const keeps = question.activeKeeps.find((entry) => entry.key === line.from)}
                {#if keeps}
                    <p data-part="studio-toggle-carry-active-keeps" class="text-sm text-textcolor2">{language.studioTgCarryActiveKeeps(keeps.key, keeps.name)}</p>
                {/if}
            {/if}
        {/each}
        {#if question.carryable}
            {#each question.planned.notice.overwrite as key (key)}
                <p data-part="studio-toggle-carry-overwrite" class="text-sm text-textcolor2">{language.studioTgCarryOverwrite(key)}</p>
            {/each}
            {#each question.planned.notice.shared as entry (entry.key)}
                <p data-part="studio-toggle-carry-shared" class="text-sm text-textcolor2">{language.studioTgCarryShared(entry.key, entry.sources.join(', '))}</p>
            {/each}
            <p data-part="studio-toggle-carry-reach" class="text-sm text-textcolor2">{reach === 'loaded' ? language.studioTgCarryReachLoaded : language.studioTgCarryReachOwn}</p>
            {#if question.numbers}
                <p data-part="studio-toggle-carry-numbers" class="text-sm text-textcolor2">{language.studioTgCarryReachNumbers}</p>
            {/if}
            <p data-part="studio-toggle-carry-loadouts" class="text-sm text-textcolor2">{language.studioTgCarryLoadouts}</p>
        {/if}
        {#if builder.carryNotKept}
            <p data-part="studio-toggle-carry-not-kept" class="text-sm text-textcolor2">{language.studioTgCarryNotKept}</p>
        {/if}
        {#if error !== ''}
            <p role="alert" data-part="studio-toggle-carry-error" class="text-sm text-draculared">{error}</p>
        {/if}
        <div class="flex flex-wrap gap-2">
            {#if question.carryable}
                <button type="button" data-part="studio-toggle-carry-yes" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!editable} onclick={actions.carry}>{language.studioTgCarryYes}</button>
                <button type="button" data-part="studio-toggle-carry-no" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!editable} onclick={actions.answer}>{language.studioTgCarryNo}</button>
            {:else}
                <button type="button" data-part="studio-toggle-carry-ok" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!editable} onclick={actions.answer}>{language.studioTgCarryOk}</button>
            {/if}
        </div>
    </section>
{/if}
{#if builder.carried}
    <div data-part="studio-toggle-carry-result" class="flex flex-wrap items-center gap-2 rounded-md border border-darkborderc p-2 text-sm text-textcolor2">
        <span>{language.studioTgCarried}</span>
        <button type="button" data-part="studio-toggle-carry-undo" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!editable} onclick={actions.undo}>{language.studioTgCarryUndo}</button>
    </div>
{/if}
{#if question === null && error !== ''}
    <p role="alert" data-part="studio-toggle-carry-error" class="text-sm text-draculared">{error}</p>
{/if}
