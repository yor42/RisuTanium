<script lang="ts">
    import { afterFlush } from '../../ts/afterFlush'
    import { language } from '../../lang'
    import type { ToggleBuilder } from '../../ts/studio/toggleBuilder.svelte'
    import { flagsOf, type MoveDirection, type NewKind } from '../../ts/studio/toggleBuilderModel'
    import { lineById, type LineId } from '../../ts/studio/toggleDef'
    import { treeKeyAction, type TreeRowInfo } from '../../ts/studio/treeKeys'
    import StudioToggleRow from './StudioToggleRow.svelte'

    // The tree of the toggle definition's rows: one tab stop with roving focus, the add picker, and the row menu.
    // Every change goes out through `actions`; the builder owns the writes and the announcements.
    interface Props {
        builder: ToggleBuilder
        editable: boolean
        actions: {
            add(kind: NewKind, group: LineId | null): void
            remove(id: LineId): void
            duplicate(id: LineId): void
            move(id: LineId, direction: MoveDirection): void
            moveToGroup(id: LineId, group: LineId): void
            moveOut(id: LineId): void
        }
    }

    let { builder, editable, actions }: Props = $props()

    const kinds = [
        { kind: 'check', type: 'studioTgTypeCheck', hint: 'studioTgHintCheck' },
        { kind: 'select', type: 'studioTgTypeSelect', hint: 'studioTgHintSelect' },
        { kind: 'text', type: 'studioTgTypeText', hint: 'studioTgHintText' },
        { kind: 'textarea', type: 'studioTgTypeTextarea', hint: 'studioTgHintTextarea' },
        { kind: 'group', type: 'studioTgTypeGroup', hint: 'studioTgHintGroup' },
        { kind: 'divider', type: 'studioTgTypeDivider', hint: 'studioTgHintDivider' },
        { kind: 'caption', type: 'studioTgTypeCaption', hint: 'studioTgHintCaption' },
    ] as const

    let treeElement = $state<HTMLElement | undefined>()
    let focusId = $state<string | null>(null)
    let menuId = $state<LineId | null>(null)
    // The open add picker: null while closed, else the group the new row goes into (null for the top level).
    let picker = $state<{ group: LineId | null } | null>(null)
    let typeAhead = ''
    let typeAheadTimer: ReturnType<typeof setTimeout> | undefined
    $effect(() => () => clearTimeout(typeAheadTimer))

    const def = $derived(builder.def)
    const rows = $derived(builder.rows())
    const infos = $derived<TreeRowInfo[]>(rows.map((row) => ({
        id: String(row.id),
        level: row.level,
        parentId: row.parentId === null ? null : String(row.parentId),
        expandable: row.expandable,
        expanded: row.expanded,
        label: lineById(def, row.id)?.line.parts[1] ?? '',
    })))
    const tabId = $derived(
        focusId !== null && rows.some((row) => String(row.id) === focusId)
            ? focusId
            : builder.editor !== null && rows.some((row) => row.id === builder.editor?.id)
                ? String(builder.editor.id)
                : rows.length > 0 ? String(rows[0].id) : null,
    )
    const unreadable = $derived([...def.diagnostics.values()].filter((list) => list.some((diagnostic) => diagnostic.code === 'unreadable')).length)
    const groups = $derived(rows.filter((row) => row.expandable))

    async function focusRow(id: string): Promise<void> {
        focusId = id
        await afterFlush()
        treeElement?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus()
    }

    function activate(id: LineId): void {
        builder.open(id)
    }

    function toggle(id: LineId, open?: boolean): void {
        const row = rows.find((candidate) => candidate.id === id)
        if (!row || !row.expandable || (open !== undefined && row.expanded === open)) return
        builder.toggleCollapsed(id)
    }

    function openMenu(id: LineId): void {
        menuId = menuId === id ? null : id
        picker = null
    }

    function run(id: LineId, action: () => void): void {
        menuId = null
        action()
        void focusRow(String(id))
    }

    function onkeydown(event: KeyboardEvent): void {
        const target = event.target
        if (!(target instanceof HTMLElement) || target.closest('[role="menu"]')) return
        const id = target.closest<HTMLElement>('[role="treeitem"]')?.dataset.rowId ?? tabId
        if (id === null) return
        const composing = event.isComposing || event.keyCode === 229
        if (event.altKey && !composing && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault()
            if (editable) {
                actions.move(Number(id) as LineId, event.key === 'ArrowUp' ? 'up' : 'down')
                void focusRow(id)
            }
            return
        }
        if (event.key === 'Delete' && !composing && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault()
            if (editable) actions.remove(Number(id) as LineId)
            return
        }
        const result = treeKeyAction(infos, id, {
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            isComposing: event.isComposing,
            keyCode: event.keyCode,
        }, typeAhead)
        typeAhead = result.typeAhead
        clearTimeout(typeAheadTimer)
        if (typeAhead !== '') typeAheadTimer = setTimeout(() => { typeAhead = '' }, 700)
        if (result.action === 'none') {
            if (result.typeAhead !== '') event.preventDefault()
            return
        }
        event.preventDefault()
        const rowId = Number(result.id) as LineId
        switch (result.action) {
            case 'focus': void focusRow(result.id); break
            case 'expand': toggle(rowId, true); break
            case 'collapse': toggle(rowId, false); break
            case 'activate': activate(rowId); break
            case 'menu': openMenu(rowId); break
        }
    }

    function onmenukeydown(event: KeyboardEvent, id: LineId): void {
        event.stopPropagation()
        if (event.key !== 'Escape') return
        event.preventDefault()
        menuId = null
        void focusRow(String(id))
    }

    function pick(kind: NewKind): void {
        const group = picker?.group ?? null
        picker = null
        actions.add(kind, group)
    }
</script>

<div data-part="studio-toggle-list-body" class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="font-bold">{language.studioTgListLabel}</span>
        <button type="button" data-part="studio-toggle-add" class="min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => { menuId = null; picker = picker === null ? { group: null } : null }}>{language.studioTgAdd}</button>
    </div>
    {#if picker !== null}
        <div role="group" aria-label={language.studioTgType} data-part="studio-toggle-picker" class="flex flex-col gap-1 rounded-md border border-darkborderc p-1">
            {#each kinds as entry (entry.kind)}
                {#if entry.kind !== 'group' || picker.group === null}
                    <button type="button" data-part="studio-toggle-type" data-kind={entry.kind} class="flex min-h-11 flex-col items-start rounded px-2 text-start hover:bg-selected cursor-pointer" onclick={() => pick(entry.kind)}>
                        <span>{language[entry.type]}</span>
                        <span class="text-xs text-textcolor2">{language[entry.hint]}</span>
                    </button>
                {/if}
            {/each}
        </div>
    {/if}
    {#if unreadable > 0}
        <p data-part="studio-toggle-unreadable" class="text-sm text-draculared">{language.studioTgUnreadableCount(unreadable)}</p>
    {/if}
    {#if rows.length === 0}
        <div data-part="studio-toggle-empty" class="flex flex-col gap-1">
            <p class="text-textcolor2">{language.studioTgEmpty}</p>
            <p class="text-sm text-textcolor2">{language.studioTgEmptyHint}</p>
        </div>
    {:else}
        <div bind:this={treeElement} role="tree" tabindex="-1" aria-label={language.studioTgListLabel} data-part="studio-toggle-list" class="flex flex-col gap-1" {onkeydown}>
            {#each rows as row (row.id)}
                <StudioToggleRow
                    line={lineById(def, row.id)!.line}
                    level={row.level}
                    expandable={row.expandable}
                    expanded={row.expanded}
                    memberCount={row.memberCount}
                    selected={builder.editor?.id === row.id}
                    tabbable={String(row.id) === tabId}
                    flags={flagsOf(def, row.id)}
                    onactivate={() => activate(row.id)}
                    onfocus={() => { focusId = String(row.id) }}
                    ontoggle={() => toggle(row.id)}
                    onmenu={() => openMenu(row.id)}
                    onaddin={() => { menuId = null; picker = { group: row.id } }}
                />
                {#if menuId === row.id}
                    <div role="menu" data-part="studio-toggle-row-menu" tabindex="-1" class="mx-2 mb-1 flex flex-col rounded-md border border-darkborderc bg-darkbg p-1" onkeydown={(event) => onmenukeydown(event, row.id)}>
                        <button type="button" role="menuitem" data-part="studio-toggle-menu-up" class="min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => run(row.id, () => actions.move(row.id, 'up'))}>{language.studioTgMoveUp}</button>
                        <button type="button" role="menuitem" data-part="studio-toggle-menu-down" class="min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => run(row.id, () => actions.move(row.id, 'down'))}>{language.studioTgMoveDown}</button>
                        {#if !row.expandable && lineById(def, row.id)?.line.form.kind !== 'dropped' && lineById(def, row.id)?.line.form.kind !== 'groupEnd'}
                            <button type="button" role="menuitem" data-part="studio-toggle-menu-duplicate" class="min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => run(row.id, () => actions.duplicate(row.id))}>{language.studioTgDuplicate}</button>
                            {#each groups as group (group.id)}
                                {#if group.id !== row.parentId}
                                    <button type="button" role="menuitem" data-part="studio-toggle-menu-to-group" data-group-id={group.id} class="min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => run(row.id, () => actions.moveToGroup(row.id, group.id))}>{language.studioTgMoveToGroup}: {lineById(def, group.id)?.line.parts[1] ?? ''}</button>
                                {/if}
                            {/each}
                        {/if}
                        {#if row.parentId !== null}
                            <button type="button" role="menuitem" data-part="studio-toggle-menu-out" class="min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => run(row.id, () => actions.moveOut(row.id))}>{language.studioTgOutOfGroup}</button>
                        {/if}
                        <button type="button" role="menuitem" data-part="studio-toggle-menu-delete" class="min-h-11 rounded px-2 text-start text-draculared hover:bg-selected cursor-pointer" disabled={!editable} onclick={() => { menuId = null; actions.remove(row.id) }}>{language.studioTgDelete}</button>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>
