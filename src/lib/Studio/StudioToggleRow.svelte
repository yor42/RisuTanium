<script lang="ts">
    import { ChevronDownIcon, ChevronRightIcon } from '@lucide/svelte'
    import { language } from '../../lang'
    import { diagnosticKeyOf, rowViewOf, typeKeyOf } from '../../ts/studio/toggleBuilderModel'
    import type { DefLine, DiagnosticCode } from '../../ts/studio/toggleDef'

    // One row of the toggle list. It receives the frozen line and primitives only, so an edit of another row leaves
    // this one untouched.
    interface Props {
        line: DefLine
        level: number
        expandable: boolean
        expanded: boolean
        memberCount: number
        selected: boolean
        tabbable: boolean
        // The line's diagnostic codes, space separated.
        flags: string
        onactivate: () => void
        onfocus: () => void
        ontoggle: () => void
        onmenu: () => void
        onaddin: () => void
    }

    let { line, level, expandable, expanded, memberCount, selected, tabbable, flags, onactivate, onfocus, ontoggle, onmenu, onaddin }: Props = $props()

    const view = $derived(rowViewOf(line))
    const typeText = $derived(view.type === 'unreadable' || view.type === 'groupEnd' ? language.studioTgUnreadable : language[typeKeyOf(view.type)])
    const summary = $derived(view.type === 'select' ? language.studioTgSummarySelect(view.optionCount) : view.type === 'group' ? language.studioTgSummaryGroup(memberCount) : '')
    const notes = $derived(flags === '' ? [] : flags.split(' ').map((code) => language[diagnosticKeyOf(code as DiagnosticCode)]))
    const name = $derived(view.type === 'unreadable' || view.type === 'groupEnd' ? line.raw : view.label !== '' ? view.label : language.studioTgUnnamed)
</script>

<div
    role="treeitem"
    tabindex={tabbable ? 0 : -1}
    aria-level={level}
    aria-expanded={expandable ? expanded : undefined}
    aria-selected={selected}
    aria-label={`${name}, ${typeText}${notes.length > 0 ? ', ' + notes.join(', ') : ''}`}
    data-part="studio-toggle-row"
    data-row-id={line.id}
    data-type={view.type}
    data-flags={flags}
    class="flex min-h-11 items-center gap-2 rounded-md border px-2 cursor-pointer hover:bg-selected {selected ? 'border-borderc bg-selected' : 'border-darkborderc'}"
    style:padding-inline-start={`${(level - 1) * 1.5 + 0.5}rem`}
    onclick={onactivate}
    {onfocus}
>
    {#if expandable}
        <button type="button" tabindex="-1" data-part="studio-toggle-expand" class="flex min-h-11 w-8 shrink-0 items-center justify-center text-textcolor2" aria-hidden="true" onclick={(event) => { event.stopPropagation(); ontoggle() }}>
            {#if expanded}<ChevronDownIcon size={16} />{:else}<ChevronRightIcon size={16} />{/if}
        </button>
    {/if}
    <span class="flex min-w-0 grow flex-col">
        <span data-part="studio-toggle-name" class="truncate {view.label === '' && view.type !== 'unreadable' && view.type !== 'groupEnd' ? 'text-textcolor2' : ''}">{name}</span>
        <span class="flex flex-wrap gap-x-2 text-xs text-textcolor2">
            <span>{typeText}</span>
            {#if view.key !== ''}<span class="font-mono">{view.key}</span>{/if}
            {#if summary !== ''}<span>{summary}</span>{/if}
        </span>
    </span>
    {#if notes.length > 0}
        <span data-part="studio-toggle-flag" class="shrink-0 text-draculared" title={notes.join('\n')} aria-hidden="true">!</span>
    {/if}
    {#if expandable}
        <button type="button" tabindex="-1" data-part="studio-toggle-add-in-group" class="min-h-11 shrink-0 rounded-md border border-darkborderc px-2 text-sm hover:bg-selected cursor-pointer" onclick={(event) => { event.stopPropagation(); onaddin() }}>{language.studioTgAddInGroup}</button>
    {/if}
    <button type="button" tabindex="-1" data-part="studio-toggle-menu" class="min-h-11 min-w-11 shrink-0 rounded-md hover:bg-selected cursor-pointer" aria-label={language.studioTgRowMenu} onclick={(event) => { event.stopPropagation(); onmenu() }}>⋯</button>
</div>
