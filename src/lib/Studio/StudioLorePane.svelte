<script lang="ts">
    import { untrack } from 'svelte'
    import { language } from '../../lang'
    import { afterFlush } from '../../ts/afterFlush'
    import { liveLoreListOf } from '../../ts/studio/loreEntryLookup'
    import {
        displayNameOf,
        focusAfterRemoval,
        folderDeleteCounts,
        isFolderRow,
        isLoreRow,
        loreListRows,
        planOwnLanding,
        planReconcile,
        resolveTracked,
        subtreeIndexes,
        surfaceLive,
        surfaceTokenOpen,
        trackedOf,
        type LoreLandingPlan,
        type LoreOpen,
        type LoreReconcile,
        type LoreSurface,
        type LoreTracked,
    } from '../../ts/studio/edit/loreListModel'
    import { loreActivateInChat, loreDelete, loreDeleteFolder, type LoreLanding, type LoreOp } from '../../ts/studio/edit/loreListOps'
    import { objRefusalText } from '../../ts/studio/edit/objListCopy'
    import { createStudioToasts, refusalTextOf } from '../../ts/studio/edit/studioToasts'
    import { uniqueChatById } from '../../ts/studio/edit/studioSetters'
    import { expandFolders, readExpandedFolders, writeExpandedFolders } from '../../ts/studio/loreFolderExpansion'
    import type { RisuModule } from '../../ts/process/modules'
    import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
    import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../../ts/studio/history/ownerPhase'
    import {
        beginModuleAck,
        beginOwnerVisit,
        currentModuleAck,
        currentVisitAck,
        ensureStudioHistory,
        getStudioHistoryService,
    } from '../../ts/studio/history/studioHistoryService.svelte'
    import { loreIndexOfItemId, loreItemIdOf, ownerKeyOf } from '../../ts/studio/ownerModel'
    import { followStudioItem, openStudioListRow, selectStudioNode, setStudioNotice, setStudioSelection, studioScreen } from '../../ts/studio/studioScreen.svelte'
    import { DBState } from '../../ts/stores.svelte'
    import StudioLoreFolderConfirm from './StudioLoreFolderConfirm.svelte'
    import StudioLoreFolderForm from './StudioLoreFolderForm.svelte'
    import StudioLoreForm from './StudioLoreForm.svelte'
    import StudioLoreList, { type LoreControl, type LoreFocusRequest, type LoreRunEffect } from './StudioLoreList.svelte'
    import StudioLoreSettings from './StudioLoreSettings.svelte'
    import StudioStatusChip from './StudioStatusChip.svelte'

    // The lorebook of one owner: its settings above its list. Every persisted write goes through `service.objEdit`. The pane
    // holds the open view's token (one counter for the list and every form), so a menu, sheet or question the list opened
    // can act only while the view that opened it is still the open one, and builds only from the entry it captured.
    interface Props {
        ownerType: 'character' | 'chat' | 'module'
        ownerId: string
        chaId: string
        moduleId: string | null
        moduleSlotIndex: number | null
        // A later copy of a shared id: read-only, with no history owner.
        moduleLaterCopy: boolean
        // The selected item of this owner's lore kind; null while the list shows.
        itemId: string | null
    }

    let { ownerType, ownerId, chaId, moduleId, moduleSlotIndex, moduleLaterCopy, itemId }: Props = $props()

    const ownerKey = untrack(() => ownerKeyOf(ownerType, ownerId))
    const toasts = createStudioToasts({ service: getStudioHistoryService })

    const service = $derived(getStudioHistoryService())
    const character = $derived.by(() => {
        const found = DBState.db.characters?.find((candidate) => candidate?.chaId === chaId)
        return found && found.type !== 'group' ? found : undefined
    })
    const chat = $derived(ownerType === 'chat' ? uniqueChatById(character?.chats, ownerId) : null)
    // The history owner of this list; null while none exists (no such character, a chat without a unique id, a
    // module that is a later copy of a shared id).
    const owner = $derived.by((): StoredOwnerKey | null => {
        if (character === undefined) return null
        if (ownerType === 'character') return characterOwnerKey(chaId)
        if (ownerType === 'chat') return chat === null ? null : chatOwnerKey(chaId, ownerId)
        return moduleId !== null && !moduleLaterCopy ? moduleOwnerKey(moduleId) : null
    })

    $effect(() => {
        const key = owner
        if (!service) {
            ensureStudioHistory()
            return
        }
        if (key === null) return
        untrack(() => {
            beginOwnerVisit(key)
            if (ownerType === 'module' && moduleId !== null) beginModuleAck(moduleId)
        })
    })

    // The repair judgement sits beside the module loader's migration, which a character or chat list never needs: a module host loads it on first use, and stays read-only until it has.
    let repairNeed = $state.raw<((body: RisuModule | null | undefined) => 'none' | 'migrate' | 'ask') | null>(null)
    let repairLoadFailed = $state(false)
    $effect(() => {
        if (ownerType !== 'module') return
        let alive = true
        repairLoadFailed = false
        void import('../../ts/process/moduleLorebookRepair').then((loaded) => { if (alive) repairNeed = loaded.lorebookRepairNeed }).catch((error: unknown) => { console.error(error); if (alive) repairLoadFailed = true })
        return () => { alive = false }
    })
    const moduleBody = $derived(ownerType === 'module' && moduleSlotIndex !== null ? DBState.db.modules?.[moduleSlotIndex] : undefined)
    const readOnlyNote = $derived(
        moduleBody !== undefined && repairNeed?.(moduleBody) === 'ask' ? language.studioLoreRepairPending
            : repairLoadFailed ? language.error
                : ownerType === 'chat' && chat === null ? language.studioHistoryNone
                    : null,
    )
    const view = $derived(service && owner !== null ? service.view(owner) : null)
    const editable = $derived(view?.editable === true && readOnlyNote === null && (ownerType !== 'module' || repairNeed !== null))
    const bulkEnabling = $derived(DBState.db.bulkEnabling === true)

    // The live list, read at each use so an element is the live one and never a snapshot. A stored value that is not a list
    // reads as empty.
    function readLive(): readonly unknown[] {
        if (character === undefined) return []
        const list = liveLoreListOf({ type: ownerType, id: ownerId }, character, DBState.db.modules ?? [])
        return Array.isArray(list) ? list : []
    }

    // ---------------------------------------------------------------- views and tokens

    // The open entry (null while the list shows) and the counter every view's token comes from. Only `closeOpen` leaves
    // an open entry, and it takes the next list token in the same call.
    let open = $state.raw<LoreOpen | null>(null)
    let tokens = 1
    let listToken = $state(1)
    function closeOpen(): void {
        open = null
        listToken = ++tokens
    }

    let refusal = $state<string | null>(null)
    let focusRequest = $state.raw<LoreFocusRequest | null>(null)
    let confirm = $state.raw<LoreSurface | null>(null)
    let expanded = $state.raw<ReadonlySet<string>>(untrack(() => readExpandedFolders(ownerKey)))

    function expand(keys: readonly string[]): void {
        if (keys.length === 0) return
        expanded = expandFolders(ownerKey, keys)
    }

    function toggleFolder(key: string): void {
        const next = new Set(expanded)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        writeExpandedFolders(ownerKey, next)
        expanded = next
    }

    // A request no row can resolve: the list gives its root focus, when focus was in the list or on nothing.
    function rootRequest(): LoreFocusRequest {
        return { target: { id: null, object: null }, hint: -1, control: 'name' }
    }

    function surfaceIsLive(surface: LoreSurface): boolean {
        return surfaceLive(open, listToken, readLive(), surface)
    }

    // ---------------------------------------------------------------- own writes

    function showRefusal(result: Extract<StudioResult, { ok: false }>, surface: LoreSurface): void {
        const lost = result.reason === 'precondition' && result.obj === undefined && surface.target !== null && resolveTracked(readLive(), surface.target, surface.hint) === null
        refusal = lost ? language.studioLoreEntryGone : (objRefusalText(result) ?? refusalTextOf(result, owner ?? undefined))
    }

    interface Removal {
        // The visible neighbour that takes focus, tracked before the op; null when nothing is left.
        focus: LoreTracked | null
        hint: number
        text: string
    }

    // Every own write of the list goes through here. A surface whose token is not the open view's token builds nothing and
    // writes nothing. The landing is read after the write returns, on the live rows.
    function runOwn(op: LoreOp, effect: LoreRunEffect, surface: LoreSurface, control: LoreControl = 'name', removal?: Removal): StudioResult {
        if (!surfaceTokenOpen(open, listToken, surface.token)) return { ok: false, reason: 'precondition' }
        if (!service || owner === null || !editable) return { ok: false, reason: 'loading' }
        refusal = null
        const opToken = surface.token.from === 'form' ? surface.token.n : null
        const result = service.objEdit(owner, op.build)
        if (result.ok === false) {
            showRefusal(result, surface)
            return result
        }
        if (result.unchanged === true) return result
        const landing = op.landed()
        if (effect === 'same') applyLanding(planOwnLanding(open, opToken, landing?.index ?? null, readLive()), control)
        else if (effect === 'opens') openLanded(landing)
        else removeLanded(landing, removal)
        return result
    }

    // Rule U: a landed op of the open form refreshes what the form tracks from the builder's landing, then the one
    // reconcile moves the selection with it, in this same call. A list op that stayed on its entry writes no selection:
    // the landed row's folders open and the row takes focus.
    function applyLanding(plan: LoreLandingPlan, control: LoreControl): void {
        if (plan.kind === 'retrack') {
            const now = open
            if (now === null) return
            open = { ...now, tracked: plan.tracked }
            reconcile()
        } else if (plan.kind === 'focusRow') {
            expand(plan.expand)
            focusRequest = { target: plan.target, hint: plan.hint, control }
        }
    }

    function reconcile(): void {
        if (open !== null) applyReconcile(planReconcile(open, readLive(), ownerId, itemOfSelection()))
    }

    // The one writer of the follow, and of the drop to the list (Rule O). Nothing here flushes or remounts the form.
    function applyReconcile(plan: LoreReconcile): void {
        const now = open
        if (now === null) return
        if (plan.kind === 'follow') {
            open = { ...now, itemId: plan.itemId }
            followStudioItem(plan.itemId)
        } else if (plan.kind === 'gone') {
            goneToList()
        }
    }

    // The entry the user had open no longer exists: the list shows, with a notice, and takes focus.
    function goneToList(): void {
        if (open !== null) closeOpen()
        setStudioSelection(ownerKey, 'lore', null)
        setStudioNotice(language.studioLoreEntryGone)
        focusRequest = rootRequest()
    }

    // An own op that opens an item asks the form it opens to take focus on its name field, once (`newForm` is what that
    // form reads when it mounts).
    let focusNewForm = false
    let newForm = $state(false)

    // Add entry, Add folder and Add entry here: the one place an own op opens an item.
    function openLanded(landing: LoreLanding | null): void {
        const index = landing?.index
        if (index === null || index === undefined) return
        focusNewForm = true
        openStudioListRow({ ownerKey, kind: 'lore' }, ownerKey, loreItemIdOf(ownerId, index))
    }

    function removeLanded(landing: LoreLanding | null, removal: Removal | undefined): void {
        if (open !== null) {
            closeOpen()
            setStudioSelection(ownerKey, 'lore', null)
        }
        if (removal !== undefined) focusRequest = removal.focus === null ? rootRequest() : { target: removal.focus, hint: removal.hint, control: 'name' }
        if (removal !== undefined && landing?.deletedId !== undefined && owner !== null) toasts.postDeleted(owner, landing.deletedId, removal.text, language.studioLoreToastRestored)
    }

    function itemOfSelection(): string | null {
        return studioScreen.selectedItemId
    }

    // ---------------------------------------------------------------- the open entry (Rules P, U and O)

    // The form's write: it builds only while the form's own token is the open view's token, from the entry the form is
    // open on. A held write flushed after its form stopped being open therefore writes nothing, on that entry or any other.
    function runForm(token: number, make: (t: LoreTracked, hint: number) => LoreOp, effect: LoreRunEffect = 'same', control: LoreControl = 'name'): StudioResult {
        const now = open
        if (now === null || !surfaceTokenOpen(open, listToken, { from: 'form', n: token })) return { ok: false, reason: 'precondition' }
        const hint = loreIndexOfItemId(ownerId, now.itemId) ?? -1
        return runOwn(make(now.tracked, hint), effect, { token: { from: 'form', n: token }, target: now.tracked, hint }, control)
    }

    // "Always active in this chat" on: the character step that gives an id-less entry an id, then the chat link. The
    // form is refreshed from the character step's landing whatever the chat step does.
    function activateInChat(token: number): StudioResult {
        const now = open
        if (now === null || !surfaceTokenOpen(open, listToken, { from: 'form', n: token })) return { ok: false, reason: 'precondition' }
        if (!service || owner === null || chatOwner === null || !editable) return { ok: false, reason: 'loading' }
        refusal = null
        const hint = loreIndexOfItemId(ownerId, now.itemId) ?? -1
        const { result, assigned } = loreActivateInChat(service, owner, chatOwner, readLive, now.tracked, hint)
        if (assigned !== null) applyLanding(planOwnLanding(open, token, assigned.index, readLive()), 'name')
        if (result.ok === false) showRefusal(result, { token: { from: 'form', n: token }, target: now.tracked, hint })
        return result
    }

    // Delete from the open form: an entry or an empty folder at once, a folder with something in it after the question,
    // which keeps this form's token and the entry it was opened on.
    function deleteOpen(token: number): void {
        const now = open
        if (now === null || !surfaceTokenOpen(open, listToken, { from: 'form', n: token })) return
        requestDelete({ token: { from: 'form', n: token }, target: now.tracked, hint: loreIndexOfItemId(ownerId, now.itemId) ?? -1 })
    }

    // Rule P: the user opened an item (or a selection writer did). No row there: the gone path.
    function openItem(id: string, live: readonly unknown[]): void {
        const index = loreIndexOfItemId(ownerId, id)
        const tracked = index === undefined || !isLoreRow(live[index]) ? null : trackedOf(live, index)
        if (tracked === null) {
            goneToList()
            return
        }
        newForm = focusNewForm
        focusNewForm = false
        open = { itemId: id, tracked, formToken: ++tokens }
    }

    // One effect for Rule P and Rule O, in that order. `open` is read only untracked, so writing it never re-runs the
    // effect; the reconcile reads the rows tracked, so a splice, a reorder or an id write runs it again.
    $effect(() => {
        const id = itemId
        const live = readLive()
        if (id === null) {
            untrack(() => { if (open !== null) closeOpen() })
            return
        }
        if (untrack(() => open?.itemId) !== id) untrack(() => openItem(id, live))
        const now = untrack(() => open)
        if (now === null) return
        const plan = planReconcile(now, live, ownerId, id)
        untrack(() => applyReconcile(plan))
    })

    // The entry the form is open on, resolved on the live rows now.
    const openRow = $derived.by(() => {
        if (open === null) return null
        const live = readLive()
        const index = resolveTracked(live, open.tracked, loreIndexOfItemId(ownerId, open.itemId) ?? -1)
        return index === null ? null : { index, folder: isFolderRow(live[index]) }
    })

    // The chat the character's local activation links into: the character's current chat, when its id is unique.
    const contextChat = $derived.by(() => {
        if (ownerType !== 'character' || character === undefined) return null
        const page = character.chats?.[character.chatPage]
        return page === undefined ? null : uniqueChatById(character.chats, page.id)
    })
    const chatOwner = $derived(contextChat === null ? null : chatOwnerKey(chaId, contextChat.id))
    function readParent(): readonly unknown[] {
        const list: unknown = character?.globalLore
        return Array.isArray(list) ? list : []
    }
    function readChatLore(): readonly unknown[] {
        const list: unknown = contextChat?.localLore
        return Array.isArray(list) ? list : []
    }

    // ---------------------------------------------------------------- delete

    function labelOfRow(row: unknown): string {
        return displayNameOf(row) ?? (isFolderRow(row) ? language.sidebarUi.unnamedFolder : language.sidebarUi.unnamedLore)
    }

    function runDelete(surface: LoreSurface): void {
        if (surface.target === null) return
        const rows = readLive()
        const at = resolveTracked(rows, surface.target, surface.hint)
        if (at === null) {
            if (surfaceTokenOpen(open, listToken, surface.token)) refusal = language.studioLoreEntryGone
            return
        }
        const row = rows[at]
        const folder = isFolderRow(row)
        const next = focusAfterRemoval(loreListRows(rows, expanded), new Set(subtreeIndexes(rows, at)))
        const counts = folderDeleteCounts(rows, at)
        const name = labelOfRow(row)
        const text = folder ? language.studioLoreFolderDeleted(name, counts.entries, counts.folders) : language.studioLoreDeleted(name)
        runOwn(
            folder ? loreDeleteFolder(surface.target, surface.hint) : loreDelete(surface.target, surface.hint),
            'removes',
            surface,
            'name',
            { focus: next === null ? null : trackedOf(rows, next.index), hint: next?.index ?? -1, text },
        )
    }

    // An entry or an empty folder is deleted at once; a folder with something in it asks first.
    function requestDelete(surface: LoreSurface): void {
        if (surface.target === null || !surfaceTokenOpen(open, listToken, surface.token)) return
        const rows = readLive()
        const at = resolveTracked(rows, surface.target, surface.hint)
        if (at === null) {
            refusal = language.studioLoreEntryGone
            return
        }
        const counts = folderDeleteCounts(rows, at)
        if (isFolderRow(rows[at]) && counts.entries + counts.folders > 0) {
            confirm = surface
            return
        }
        runDelete(surface)
    }

    // The question names the folder and its counts on the live rows, through the folder it was opened on.
    const confirmView = $derived.by(() => {
        const asked = confirm
        if (asked === null || asked.target === null) return null
        const rows = readLive()
        if (!surfaceLive(open, listToken, rows, asked)) return null
        const at = resolveTracked(rows, asked.target, asked.hint)
        if (at === null) return null
        const counts = folderDeleteCounts(rows, at)
        return { asked, name: labelOfRow(rows[at]), entries: counts.entries, folders: counts.folders }
    })

    // Focus goes back to the folder form's Delete button, but only when it was inside the closing question or on nothing.
    function focusFolderDelete(): void {
        const active = document.activeElement
        if (active === null || active === document.body) document.querySelector<HTMLElement>('[data-part="studio-lore-folder-delete"]')?.focus()
    }

    // The question closes, writing nothing, once its view or its folder is gone. A lost folder returns focus to the list
    // (or to the folder form's Delete button, for a question that form asked); a closed view has a new owner of focus.
    $effect(() => {
        const asked = confirm
        if (asked === null) return
        if (surfaceLive(open, listToken, readLive(), asked)) return
        untrack(() => {
            const viewOpen = surfaceTokenOpen(open, listToken, asked.token)
            confirm = null
            if (!viewOpen) return
            if (asked.token.from === 'form') focusFolderDelete()
            else focusRequest = rootRequest()
        })
    })

    function confirmDelete(): void {
        const asked = confirm
        confirm = null
        if (asked !== null) runDelete(asked)
    }

    function cancelConfirm(): void {
        const asked = confirm
        confirm = null
        if (asked === null) return
        if (asked.token.from === 'form') void afterFlush().then(focusFolderDelete)
        else if (asked.target) focusRequest = { target: asked.target, hint: asked.hint, control: 'menu' }
    }

    // ---------------------------------------------------------------- settings host

    function noted(result: StudioResult): boolean {
        refusal = result.ok === false ? (objRefusalText(result) ?? refusalTextOf(result, owner ?? undefined)) : null
        return result.ok
    }

    function openCharacter(): void {
        selectStudioNode(ownerKeyOf('character', chaId), 'lore', null)
    }
</script>

<div data-part="studio-lore-pane" class="flex flex-col gap-3">
    {#if owner !== null}
        <StudioStatusChip ack={ownerType === 'module' ? currentModuleAck() : currentVisitAck()} />
    {/if}
    {#if readOnlyNote !== null}
        <p role="status" data-part="studio-lore-readonly" class="text-sm text-textcolor2">{readOnlyNote}</p>
    {/if}
    {#if open === null}
        <StudioLoreSettings
            owner={owner ?? characterOwnerKey(chaId)}
            {service}
            editable={editable && ownerType === 'character'}
            host={ownerType}
            live={ownerType === 'character' ? character : undefined}
            {noted}
            onOpenCharacter={openCharacter}
        />
    {/if}
    {#if refusal !== null}
        <p role="alert" data-part="studio-lore-refusal" class="text-sm text-draculared">{refusal}</p>
    {/if}
    <!-- A selected item with no open view yet is about to open (or to clear its selection): the list model, which reads
         every entry's name, is not built for that one frame. -->
    {#if open === null && itemId === null}
        <StudioLoreList
            {ownerKey}
            {ownerId}
            host={ownerType}
            {readLive}
            {editable}
            {bulkEnabling}
            {listToken}
            {expanded}
            {focusRequest}
            {surfaceIsLive}
            {runOwn}
            {requestDelete}
            onexpand={expand}
            ontoggle={toggleFolder}
            onfocused={() => { focusRequest = null }}
        />
    {:else if openRow !== null}
        {#key open.formToken}
            {#if openRow.folder}
                <StudioLoreFolderForm token={open.formToken} index={openRow.index} {readLive} {editable} {service} {owner} {runForm} {deleteOpen} focusName={newForm} />
            {:else}
                <StudioLoreForm token={open.formToken} host={ownerType} index={openRow.index} {readLive} {readParent} {readChatLore} {editable} {service} {owner} {chatOwner} {runForm} {activateInChat} {deleteOpen} {noted} focusName={newForm} />
            {/if}
        {/key}
    {/if}
    {#if confirmView !== null}
        <StudioLoreFolderConfirm name={confirmView.name} entries={confirmView.entries} folders={confirmView.folders} onconfirm={confirmDelete} oncancel={cancelConfirm} />
    {/if}
</div>
