<script module lang="ts">
    import { language } from '../../lang'
    import type { StudioOwnerType } from '../../ts/studio/studioTarget'

    // The role of the two owners that are always there; the other owners are named by their type group.
    export function ownerRoleLabelOf(type: StudioOwnerType): string | null {
        switch (type) {
            case 'character': return language.studioOwnerCharacter
            case 'chat': return language.studioOwnerThisChat
            default: return null
        }
    }
</script>

<script lang="ts">
    import { tick, untrack } from 'svelte'
    import { classicDestinationOf, openInClassicEditor } from '../../ts/studio/classicLinks.svelte'
    import type { KindNode, OwnerModel, OwnerNode, StudioKind } from '../../ts/studio/ownerModel'
    import { ownerSourceFor } from '../../ts/studio/ownerSource.svelte'
    import {
        TREE_PAGE_SIZE,
        applyStudioTarget,
        groupRowId,
        kindRowId,
        ownerRowId,
        selectStudioNode,
        setStudioExpanded,
        setStudioSelection,
        showMoreStudioRows,
        studioScreen,
    } from '../../ts/studio/studioScreen.svelte'
    import { treeKeyAction, type TreeRowInfo } from '../../ts/studio/treeKeys'
    import { reuseUnchangedRows } from '../../ts/studio/treeRows'
    import { COMBINED_KINDS, combinedKeyOf } from './StudioCombined.svelte'
    import TreeRow, { badgeLabelOf, itemLabelOf, kindLabelOf, noticeTextOf, tagLabelOf, type RowKind } from './TreeRow.svelte'

    interface TreeNode extends TreeRowInfo {
        rowKind: RowKind
        setSize: number
        posInSet: number
        ownerKey: string | null
        ownerType: StudioOwnerType | null
        restricted: boolean
        kind: StudioKind | null
        itemId: string | null
        /** The row whose list this "show more" row extends. */
        moreFor: string | null
        detail?: string
        tags: string[]
        selected: boolean
    }

    const source = ownerSourceFor(() => studioScreen.chaId)
    const model = $derived(source.current.model)

    // Only lorebooks and regex lists have rows below the kind; every other kind is one leaf.
    const LISTED_KINDS: readonly StudioKind[] = ['lore', 'regex']

    function visibleKindsOf(owner: OwnerNode): KindNode[] {
        const kinds = owner.kinds()
        return studioScreen.hideEmpty ? kinds.filter((node) => node.count > 0 || node.folderCount > 0) : kinds
    }

    function rowsOf(current: OwnerModel): TreeNode[] {
        const rows: TreeNode[] = []
        const open = (id: string): boolean => studioScreen.expanded[id] === true
        const base = (id: string, rowKind: RowKind, level: number, parentId: string | null, size: number, pos: number, label: string): TreeNode => ({
            id, rowKind, level, parentId, setSize: size, posInSet: pos, label,
            expandable: false, expanded: false, ownerKey: null, ownerType: null, restricted: false,
            kind: null, itemId: null, moreFor: null, tags: [], selected: false,
        })

        const pushMore = (forId: string, level: number, parentId: string, remaining: number, pos: number, size: number): void => {
            const row = base(`m:${forId}`, 'more', level, parentId, size, pos, language.studioShowMore(Math.min(TREE_PAGE_SIZE, remaining)))
            row.moreFor = forId
            rows.push(row)
        }

        const pushKind = (owner: OwnerNode, node: KindNode, level: number, parentId: string, size: number, pos: number): void => {
            const id = kindRowId(owner.key, node.kind)
            const total = node.count + node.folderCount
            const listed = LISTED_KINDS.includes(node.kind)
            const row = base(id, 'kind', level, parentId, size, pos, kindLabelOf(node.kind))
            row.ownerKey = owner.key
            row.ownerType = owner.type
            row.restricted = owner.restricted
            row.kind = node.kind
            row.expandable = listed && total > 0
            row.expanded = row.expandable && open(id)
            row.detail = listed ? language.studioItemCount(node.count) : total === 0 ? language.studioEmptyKind : undefined
            row.selected = studioScreen.selectedOwnerKey === owner.key && studioScreen.selectedKind === node.kind && studioScreen.selectedItemId === null
            rows.push(row)
            if (!row.expanded) return
            const { items, total: listLength } = node.itemsUpTo(TREE_PAGE_SIZE * ((studioScreen.pages[id] ?? 0) + 1))
            const shown = items.length
            const count = shown < listLength ? shown + 1 : shown
            for (let index = 0; index < shown; index++) {
                const item = items[index]
                const itemRow = base(`i:${item.id}`, 'item', level + 1, id, count, index + 1, itemLabelOf(item))
                itemRow.ownerKey = owner.key
                itemRow.ownerType = owner.type
                itemRow.restricted = owner.restricted
                itemRow.kind = node.kind
                itemRow.itemId = item.id
                itemRow.selected = studioScreen.selectedItemId === item.id
                rows.push(itemRow)
            }
            if (shown < listLength) pushMore(id, level + 1, id, listLength - shown, count, count)
        }

        const pushOwner = (owner: OwnerNode, level: number, parentId: string | null, size: number, pos: number): void => {
            const id = ownerRowId(owner.key)
            const kinds = visibleKindsOf(owner)
            const role = ownerRoleLabelOf(owner.type)
            // An unnamed character or chat is listed under its role, never as a blank row.
            const row = base(id, 'owner', level, parentId, size, pos, owner.name !== '' ? owner.name : (role ?? owner.name))
            row.ownerKey = owner.key
            row.ownerType = owner.type
            row.restricted = owner.restricted
            row.expandable = kinds.length > 0
            row.expanded = row.expandable && open(id)
            row.tags = [
                ...(role !== null && owner.name !== '' ? [role] : []),
                ...owner.tags.map((tag) => tagLabelOf(tag, owner.retiredVersion)),
                ...owner.badges.map(badgeLabelOf),
            ]
            row.selected = studioScreen.selectedOwnerKey === owner.key && studioScreen.selectedKind === null
            rows.push(row)
            if (!row.expanded) return
            kinds.forEach((node, index) => pushKind(owner, node, level + 1, id, kinds.length, index + 1))
        }

        // A group is an expandable heading; `children` pushes what sits under it when it is open.
        const pushGroup = (name: string, label: string, level: number, parentId: string | null, size: number, pos: number, children: (id: string) => void): void => {
            const id = groupRowId(name)
            const row = base(id, 'group', level, parentId, size, pos, label)
            row.expandable = true
            row.expanded = open(id)
            rows.push(row)
            if (row.expanded) children(id)
        }

        const pushOwnerPage = (owners: OwnerNode[], groupId: string, level: number): void => {
            const shown = Math.min(owners.length, TREE_PAGE_SIZE * ((studioScreen.pages[groupId] ?? 0) + 1))
            const count = shown < owners.length ? shown + 1 : shown
            for (let index = 0; index < shown; index++) pushOwner(owners[index], level, groupId, count, index + 1)
            if (shown < owners.length) pushMore(groupId, level, groupId, owners.length - shown, count, count)
        }

        const topCount = 1 + (current.chat ? 1 : 0)
            + (current.modules.length > 0 ? 1 : 0)
            + (current.otherModules.length > 0 ? 1 : 0)
            + (current.presets.length + current.otherPresets.length > 0 ? 1 : 0)
            + (current.plugins.length > 0 ? 1 : 0)
            + 1
        let position = 0
        pushOwner(current.character, 1, null, topCount, ++position)
        if (current.chat) pushOwner(current.chat, 1, null, topCount, ++position)
        if (current.modules.length > 0) {
            pushGroup('modules', language.studioOwnerModules, 1, null, topCount, ++position, (id) => pushOwnerPage(current.modules, id, 2))
        }
        if (current.otherModules.length > 0) {
            pushGroup('otherModules', language.studioOwnerOtherModules(current.otherModules.length), 1, null, topCount, ++position,
                (id) => pushOwnerPage(current.otherModules, id, 2))
        }
        if (current.presets.length + current.otherPresets.length > 0) {
            pushGroup('presets', language.studioOwnerPresets, 1, null, topCount, ++position, (id) => {
                const size = current.presets.length + (current.otherPresets.length > 0 ? 1 : 0)
                current.presets.forEach((owner, index) => pushOwner(owner, 2, id, size, index + 1))
                if (current.otherPresets.length > 0) {
                    pushGroup('otherPresets', language.studioOwnerOtherPresets(current.otherPresets.length), 2, id, size, size,
                        (otherId) => pushOwnerPage(current.otherPresets, otherId, 3))
                }
            })
        }
        if (current.plugins.length > 0) {
            pushGroup('plugins', language.studioOwnerPlugins, 1, null, topCount, ++position, (id) => pushOwnerPage(current.plugins, id, 2))
        }
        // One read-only combined entry per mergeable kind; the detail lists the items in the order they apply.
        pushGroup('combined', language.studioMerged, 1, null, topCount, ++position, (id) => {
            COMBINED_KINDS.forEach((kind, index) => {
                const row = base(`c:${kind}`, 'kind', 2, id, COMBINED_KINDS.length, index + 1, kindLabelOf(kind))
                row.ownerKey = combinedKeyOf(kind)
                row.kind = kind
                row.selected = studioScreen.selectedOwnerKey === row.ownerKey
                rows.push(row)
            })
        })
        return rows
    }

    // A rebuild keeps the object of every row whose fields did not change, so the keyed list skips it.
    let previousRows: ReadonlyMap<string, TreeNode> = new Map()
    const rows = $derived.by((): TreeNode[] => {
        if (!model) {
            previousRows = new Map()
            return []
        }
        const reused = reuseUnchangedRows(previousRows, rowsOf(model))
        previousRows = reused.byId
        return reused.rows
    })

    let treeElement: HTMLElement | undefined = $state()
    let focusId = $state<string | null>(null)
    let menuRowId = $state<string | null>(null)

    // The tab stop is the row last focused, else the selected row, else the first.
    const tabId = $derived(
        rows.some((row) => row.id === focusId) ? focusId : (rows.find((row) => row.selected)?.id ?? rows[0]?.id ?? null),
    )

    // The first pane that has the model places the opening target (the phone shows only one pane at a time).
    $effect(() => {
        const current = model
        if (!current || !studioScreen.targetPending) return
        untrack(() => applyStudioTarget(current, noticeTextOf))
    })

    function rowElementOf(id: string): HTMLElement | null {
        const found = treeElement?.querySelectorAll<HTMLElement>('[data-part="studio-row"]')
        if (!found) return null
        for (const element of found) {
            if (element.dataset.rowId === id) return element
        }
        return null
    }

    async function focusRow(id: string): Promise<void> {
        focusId = id
        await tick()
        rowElementOf(id)?.focus()
    }

    function toggle(row: TreeNode, expanded: boolean): void {
        setStudioExpanded(row.id, expanded)
    }

    // The last "show more" activation removes its row; focus moves to the last row of the list it extended
    // instead of falling to the page.
    async function showMore(row: TreeNode, listId: string): Promise<void> {
        showMoreStudioRows(listId)
        await tick()
        if (rows.some((candidate) => candidate.id === row.id)) return
        const last = rows.findLast((candidate) => candidate.parentId === listId)
        if (last) await focusRow(last.id)
    }

    function activate(row: TreeNode): void {
        focusId = row.id
        menuRowId = null
        if (row.rowKind === 'more') {
            if (row.moreFor !== null) void showMore(row, row.moreFor)
            return
        }
        if (row.expandable) {
            toggle(row, !row.expanded)
            // Wide layouts also show the opened owner or kind; a phone stays on the list to open further.
            if (row.ownerKey !== null && studioScreen.layout !== 'stack') setStudioSelection(row.ownerKey, row.kind, null)
            return
        }
        if (row.ownerKey !== null) selectStudioNode(row.ownerKey, row.kind, row.itemId)
    }

    function menuAvailable(row: TreeNode): boolean {
        return row.ownerType !== null && !row.restricted && classicDestinationOf(row.ownerType, row.kind) !== null
    }

    async function openMenu(row: TreeNode): Promise<void> {
        if (!menuAvailable(row)) return
        menuRowId = row.id
        await tick()
        treeElement?.querySelector<HTMLElement>('[data-part="studio-row-menu-classic"]')?.focus()
    }

    function openClassic(row: TreeNode): void {
        if (row.ownerType === null) return
        menuRowId = null
        openInClassicEditor(row.ownerType, row.kind)
    }

    let typeAhead = ''
    let typeAheadTimer: ReturnType<typeof setTimeout> | undefined
    $effect(() => () => clearTimeout(typeAheadTimer))

    // Bound on the tree element, not the Studio root: a key typed in the search field or any other field
    // never reaches it.
    function onkeydown(event: KeyboardEvent): void {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        if (target.closest('[role="menu"]')) return
        const id = target.closest<HTMLElement>('[role="treeitem"]')?.dataset.rowId ?? tabId
        if (id === null) return
        const result = treeKeyAction(
            rows,
            id,
            {
                key: event.key,
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                isComposing: event.isComposing,
                keyCode: event.keyCode,
            },
            typeAhead,
        )
        typeAhead = result.typeAhead
        clearTimeout(typeAheadTimer)
        if (typeAhead !== '') typeAheadTimer = setTimeout(() => { typeAhead = '' }, 700)
        if (result.action === 'none') {
            if (result.typeAhead !== '') event.preventDefault()
            return
        }
        event.preventDefault()
        const row = rows.find((candidate) => candidate.id === result.id)
        if (!row) return
        switch (result.action) {
            case 'focus': void focusRow(row.id); break
            case 'expand': toggle(row, true); break
            case 'collapse': toggle(row, false); break
            case 'activate': activate(row); break
            case 'menu': void openMenu(row); break
        }
    }

    function onmenukeydown(event: KeyboardEvent, row: TreeNode): void {
        // The menu owns its keys; Esc closes it and hands focus back to its row.
        event.stopPropagation()
        if (event.key !== 'Escape') return
        event.preventDefault()
        menuRowId = null
        void focusRow(row.id)
    }
</script>

<div data-part="studio-tree-body" class="flex min-h-0 flex-col">
    <label class="flex min-h-11 items-center gap-2 px-3 text-sm text-textcolor2">
        <input type="checkbox" data-part="studio-hide-empty" checked={studioScreen.hideEmpty} onchange={(event) => { studioScreen.hideEmpty = event.currentTarget.checked }} />
        <span>{language.studioHideEmpty}</span>
    </label>
    <!-- The rows are the tab stops; the tree itself is not, so it carries tabindex -1. -->
    <div bind:this={treeElement} role="tree" tabindex="-1" aria-label={language.studioTreeLabel} data-part="studio-tree-list" class="flex flex-col pb-2" {onkeydown}>
        {#each rows as row (row.id)}
            <TreeRow
                id={row.id}
                rowKind={row.rowKind}
                level={row.level}
                setSize={row.setSize}
                posInSet={row.posInSet}
                expandable={row.expandable}
                expanded={row.expanded}
                selected={row.selected}
                tabbable={row.id === tabId}
                label={row.label}
                detail={row.detail}
                tags={row.tags}
                onactivate={() => activate(row)}
                onfocus={() => { focusId = row.id }}
            />
            {#if menuRowId === row.id}
                <div role="menu" data-part="studio-row-menu" tabindex="-1" class="mx-2 mb-1 flex flex-col rounded-md border border-darkborderc bg-darkbg p-1" onkeydown={(event) => onmenukeydown(event, row)}>
                    <button type="button" role="menuitem" data-part="studio-row-menu-classic" class="min-h-11 rounded px-2 text-start hover:bg-selected cursor-pointer" onclick={() => openClassic(row)}>
                        {language.studioOpenClassic}
                    </button>
                </div>
            {/if}
        {/each}
    </div>
</div>
