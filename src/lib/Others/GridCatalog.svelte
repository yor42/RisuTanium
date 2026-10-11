<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import { v4 } from "uuid";
    import { changeChar, getCharImage, removeChar, trashCharacters } from "../../ts/characters";
    import { checkCharOrder } from "src/ts/globalApi.svelte";
    import { alertSelect } from "src/ts/alert";
    import { DBState } from 'src/ts/stores.svelte';
    import { ArrowLeft, User, Users, TrashIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, PencilIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon } from "@lucide/svelte";
    import { selectedCharID } from "../../ts/stores.svelte";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { language } from "src/lang";
    import { parseMultilangString } from "src/ts/util";
    import MobileCharacters from "../Mobile/MobileCharacters.svelte";
    import CharacterTrashList from "./CharacterTrashList.svelte";
    import CharacterDescription from "./CharacterDescription.svelte";
    import CharacterWindow from "./CharacterWindow.svelte";
    import CharListAvatar from "./CharListAvatar.svelte";
    import { GRID_ROW_FALLBACK_PX, LIST_ROW_FALLBACK_PX, gridSectionRows, listRows } from "./charListRows";
    import { buildGridEntries, folderTileClass, type GridEntry, type SortMode } from "./charListOrder";
    import { loadGridSort, parseGridSort, saveGridSort } from "./gridMemory";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import { loadOpenFolders, saveOpenFolders } from "../SideBars/railMemory";
    import { clickedButton, clickedLink, selectedInside } from "src/ts/gui/descriptionMarkdown";
    import { SvelteMap, SvelteSet } from "svelte/reactivity";
    import { createCharacterSearch } from "src/ts/gui/characterSearch.svelte";
    import { keyEventBlocked, keysBlockedNow } from "src/ts/keyEventBlocked";
    import { groupIntoFolder, refKey } from "../SideBars/sidebarOrder";
    import { RailDrag, type RailHost } from "../SideBars/railDrag";
    import { bindRail, type RailBinding } from "../SideBars/railBinding";
    import { computeLayout, type LayoutItem } from "../SideBars/railLayout";
    import type { RailGeometry } from "../SideBars/railResolver";
    import { NO_TARGET } from "../SideBars/railTarget";
    import { actingPicks, canEdit, chooseRowForms, gestureRef, groupPlan, resolvePicked, stalePickedKeys, type Picked, type RowMeasure } from "./charListEdit";
    import { tileKeyAt, type GridGeometry } from "./gridTarget";
    import { registerBackHandler } from "../../ts/backHandlers";
    import { pageCovered } from "../../ts/alertPrompts";
    interface Props {
        endGrid?: any;
    }

    let { endGrid = () => {} }: Props = $props();
    // A dark halo behind a folder tile's icon or name keeps it readable over a bright picture.
    const FACE_SHADOW = 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]'
    let search = $state('')
    let selected = $state(3)
    // List tab, per row and keyed by the character's chaId (stable when a removal shifts indices): whether the
    // description is expanded, and whether its clamp currently cuts text off.
    // The toggle shows while either holds, so an expanded row keeps its "Show
    // less" even though an unclamped block no longer overflows.
    const expanded = new SvelteSet<string>()
    const overflowing = new SvelteSet<string>()

    // One search result feeds the header count, the open tab and the embedded
    // simple list. It follows the query after the typing debounce, so all three
    // always show the same matches.
    const found = createCharacterSearch(() => search)

    // A card is keyed by its character (`slotKeys`), never by its position, so a removal elsewhere keeps
    // focus, scroll anchor and measured heights on the same character. The map resolves a key to the
    // slot it is at now, in the same derivation as the key list.
    const indexByKey = $derived(new Map(found.live.map((match) => [match.key, match.index])))
    const listRowsNow = $derived(listRows(found.live.map((match) => match.key)))

    // Open folders are shared with the rail and remembered on this device (railMemory), never in the
    // database. The save prunes against every folder id in the order, so a folder with no visible
    // member keeps its state. Only the array reference is read untracked: the loop reads the entries,
    // so the save also re-runs on an in-place edit of the order and rewrites the same set.
    const folderIdsInOrder = (): Set<string> => {
        const ids = new Set<string>()
        for (const entry of untrack(() => DBState.db.characterOrder) ?? []) {
            if (typeof entry === 'object' && entry !== null && typeof entry.id === 'string') {
                ids.add(entry.id)
            }
        }
        return ids
    }
    let openFolders: string[] = $state(loadOpenFolders(folderIdsInOrder()))
    $effect(() => {
        const ids = [...openFolders]
        saveOpenFolders(ids, folderIdsInOrder())
    })
    const openFolderIds = $derived(new Set(openFolders))

    // The Grid's sort is remembered on this device (gridMemory), never in the database. Only "My order"
    // shows folders as tiles; Recent and Name list the live characters flat.
    let sort: SortMode = $state(loadGridSort())
    function chooseSort(value: string) {
        sort = parseGridSort(value)
        saveGridSort(sort)
        // Edit mode works on the saved order, which only "My order" shows.
        if (!canEdit(sort)) {
            exitEdit()
        }
    }

    // The Grid tab's tiles, built once per change: the live characters in the saved order with their
    // folders. The Grid writes the database only through the bulk move to the trash (`trashPicked`, whose
    // `trashCharacters` also edits the order) and the group into a new folder (`groupPicked`, which
    // assigns characterOrder and repairs it as the rail does): mounting, searching, opening folders,
    // choosing a sort, entering and leaving edit mode, selecting and every cancelled or refused action
    // write nothing, never assign characterOrder and never repair the order; the order is the rail's.
    // A timestamp is read only under Recent.
    const entries = $derived(buildGridEntries({
        live: found.live,
        order: DBState.db.characterOrder,
        openFolderIds,
        sort,
        searching: found.searching,
        nameOf: (index) => DBState.db.characters[index]?.name || language.settingsPage.unnamed,
        interactionOf: (index) => DBState.db.characters[index]?.lastInteraction || 0,
    }))
    const entryByKey = $derived(new Map(entries.map((entry) => [entry.key, entry])))
    // The Grid tab builds its rows from the column count its container reports. An open folder is a
    // section of rows of its own.
    const gridRowsFor = (columns: number) => gridSectionRows(entries, columns)

    // A folder tile's picture lookup, kept per instance: `entries` is rebuilt on every toggle and the
    // tile's await block re-runs with it, so a fresh lookup would blank every picture for a moment.
    // The key carries the hide-all-images setting, which the lookup reads, so a flip is a new lookup;
    // a lookup that fails is dropped so the next render asks again.
    const pictureLookups = new Map<string, Promise<string>>()
    function folderPicture(imgFile: string): Promise<string> {
        const key = `${DBState.db.hideAllImages ? 'hidden' : 'shown'}|${imgFile}`
        let lookup = pictureLookups.get(key)
        if (lookup === undefined) {
            const started = getCharImage(imgFile, 'thumbcss')
            lookup = started
            pictureLookups.set(key, started)
            started.catch(() => {
                if (pictureLookups.get(key) === started) {
                    pictureLookups.delete(key)
                }
            })
        }
        return lookup
    }
    // Picking an entry opens the character and leaves the screen, as the
    // simple list does.
    function pick(index: number) {
        changeChar(index)
        endGrid()
    }

    //#region edit mode

    // Edit mode and its selection are view state of this component: never saved, and gone with it when
    // the screen closes. Every way out clears the selection. A pick holds the object its tile stood for
    // (`charListEdit`), and a tile reads the selection only through `has(key)`, so a toggle repaints
    // that one tile.
    let editing = $state(false)
    const picks = new SvelteMap<string, Picked>()
    let trashing = $state(false)
    // Whether Group would act on the live selection; the row button and the menu share `groupPlan`.
    const groupAvailable = $derived(groupPlan(picks, entryByKey, DBState.db.characters, DBState.db.characterOrder).ok)

    // The edit row has three forms, chosen by `chooseRowForms` (charListEdit): the count as its full
    // localized text or just its number, and Move to trash as its labelled button or an icon. Every input
    // is a stable measure that does not depend on the form shown: the row's own width, the Group button
    // (the icon button has the same size), and invisible absolutely positioned copies of the full text,
    // the number and the labelled button, which take no layout space. The visible count and the visible
    // trash button are never measured.
    let rowEl: HTMLDivElement | undefined = $state()
    let groupBtn: HTMLButtonElement | undefined = $state()
    let countProbe: HTMLSpanElement | undefined = $state()
    let numberProbe: HTMLSpanElement | undefined = $state()
    let labelProbe: HTMLSpanElement | undefined = $state()
    let rowMeasure: RowMeasure = $state({ fullWidth: 0, numberWidth: 0, rowWidth: 0, groupWidth: 0, labelWidth: 0, iconWidth: 0, gap: 0 })
    const countFull = $derived(language.othersUi.editSelectedCount(picks.size))
    const rowForms = $derived(chooseRowForms(rowMeasure))
    const countShown = $derived(rowForms.count === 'full' ? countFull : String(picks.size))

    function measureRow() {
        if (!rowEl || !groupBtn || !countProbe || !numberProbe || !labelProbe) {
            return
        }
        const width = (element: Element) => element.getBoundingClientRect().width
        rowMeasure = {
            fullWidth: width(countProbe),
            numberWidth: width(numberProbe),
            rowWidth: width(rowEl),
            groupWidth: width(groupBtn),
            labelWidth: width(labelProbe),
            iconWidth: width(groupBtn),
            gap: parseFloat(getComputedStyle(rowEl).columnGap) || 0,
        }
    }

    // Measured again when the count or the language text changes (the probes' text changes with it).
    $effect(() => {
        void countFull
        void language.othersUi.editMoveToTrash
        void rowEl
        void groupBtn
        void countProbe
        void numberProbe
        void labelProbe
        untrack(measureRow)
    })

    // Measured again when the row or any probe changes size. Disconnected when the row goes away.
    $effect(() => {
        const row = rowEl
        const probes = [countProbe, numberProbe, labelProbe, groupBtn]
        if (!row || typeof ResizeObserver === 'undefined') {
            return
        }
        const observer = new ResizeObserver(() => measureRow())
        observer.observe(row)
        for (const probe of probes) {
            if (probe) {
                observer.observe(probe)
            }
        }
        return () => observer.disconnect()
    })

    function exitEdit() {
        editing = false
        enterGeneration++
        groupGeneration++
        picks.clear()
    }

    function togglePick(entry: GridEntry) {
        if (picks.has(entry.key)) {
            picks.delete(entry.key)
            return
        }
        const picked = resolvePicked(entry, DBState.db.characters, DBState.db.characterOrder)
        if (picked) {
            picks.set(entry.key, picked)
        }
    }

    // Under Recent or Name the button and the long press switch to My order first (a view setting
    // remembered on this device), then enter.
    // A press that switched the sort scrolls once, after the switch, so the held tile (or the folder
    // tile that now stands for it) is in view; a press under My order scrolls nothing. The count
    // invalidates a continuation that a later enter or exit has overtaken.
    let enterGeneration = 0
    function enterEdit(held?: GridEntry) {
        const switched = !canEdit(sort)
        if (switched) {
            chooseSort('order')
        }
        editing = true
        if (held && !picks.has(held.key)) {
            togglePick(held)
        }
        if (switched && held) {
            void scrollToHeld(held, ++enterGeneration)
        }
    }

    // The row of the grid that shows `key`, from the window's own rows and layout, so it does not
    // depend on which rows are mounted.
    function rowIndexOf(key: string): number {
        const geometry = geometryNow()
        return geometry ? geometry.rows.findIndex((row) => row.cards.includes(key)) : -1
    }

    // Runs once the My order rows are laid out (the window has reset its scroll by then). The held
    // key's row wins; a member of a closed folder has none, so its folder's tile row stands in. A
    // row that is already fully in view, or none at all, leaves the scroll alone.
    async function scrollToHeld(held: GridEntry, generation: number) {
        try {
            await tick()
            const geometry = geometryNow()
            if (generation !== enterGeneration || !editing || sort !== 'order' || !gridScroller || !geometry) {
                return
            }
            let index = rowIndexOf(held.key)
            if (index < 0 && held.kind === 'char' && held.folderId !== undefined) {
                const folderTile = entries.find((entry) => entry.kind === 'folder' && entry.id === held.folderId)
                index = folderTile ? rowIndexOf(folderTile.key) : -1
            }
            if (index < 0) {
                return
            }
            centreRowIfHidden(geometry, index, gridScroller)
        } catch (error) {
            console.error('Grid scroll to the held tile failed:', error)
        }
    }

    // Centres row `index` unless it is already fully in view.
    function centreRowIfHidden(geometry: GridGeometry, index: number, scroller: HTMLDivElement) {
        const top = geometry.layout.offsets[index]
        const height = geometry.layout.heights[index]
        const view = scroller.clientHeight
        const scrollTop = host.getScrollTop()
        if (top >= scrollTop && top + height <= scrollTop + view) {
            return
        }
        host.setScrollTop(top + height / 2 - view / 2)
    }

    // After a group, the new folder tile stands where the first picked tile was, which can be far from
    // the view: scroll to it once if it is not fully visible. Under search there is no folder tile (the
    // results are flat), so nothing scrolls. Done, a sort change, a newer action or leaving the tab
    // bumps the count and cancels the continuation.
    let groupGeneration = 0
    async function scrollToNewFolder(id: string, generation: number) {
        try {
            await tick()
            const geometry = geometryNow()
            if (generation !== groupGeneration || !editing || sort !== 'order' || !gridScroller || !geometry) {
                return
            }
            const index = rowIndexOf(refKey({ kind: 'folder', id, occurrence: 0 }))
            if (index < 0) {
                return
            }
            centreRowIfHidden(geometry, index, gridScroller)
        } catch (error) {
            console.error('Grid scroll to the new folder failed:', error)
        }
    }

    function selectTab(tab: number) {
        if (tab !== selected) {
            exitEdit()
        }
        selected = tab
    }

    // A pick whose tile is gone or now stands for another object leaves the selection, so an action
    // never reaches a character the user cannot see or a look-alike that took the slot.
    $effect(() => {
        const stale = stalePickedKeys(picks, entryByKey, DBState.db.characters, DBState.db.characterOrder)
        if (stale.length > 0) {
            untrack(() => {
                for (const key of stale) {
                    picks.delete(key)
                }
            })
        }
    })

    // Escape leaves edit mode, but not while an alert covers the page (it closes that alert) and not
    // from a text field (the search box keeps the key).
    $effect(() => {
        if (!editing) {
            return
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || keyEventBlocked(event)) {
                return
            }
            const target = event.target
            if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) {
                return
            }
            exitEdit()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    // Android Back leaves edit mode while it lasts, but not while a dialog covers the page (Back then
    // behaves as without the Grid). Unregistered on leaving edit mode and with the component.
    $effect(() => {
        if (!editing) {
            return
        }
        return registerBackHandler(() => {
            if (pageCovered()) {
                return false
            }
            exitEdit()
            return true
        })
    })

    // The picks are resolved in this synchronous stretch, before the confirmation; the action checks
    // them again by identity after it.
    async function trashPicked() {
        if (trashing) {
            return
        }
        groupGeneration++
        const acting = actingPicks(picks, entryByKey, DBState.db.characters, DBState.db.characterOrder)
        if (acting.characters.length === 0 && acting.folders.length === 0) {
            return
        }
        trashing = true
        try {
            if (await trashCharacters(acting) > 0) {
                picks.clear()
            }
        } finally {
            trashing = false
        }
    }

    // The one write of the Grid besides the trash: the rail's assignment and repair of the saved order.
    // An operation that changes nothing writes nothing.
    function applyGridOrderChange(change: (order: typeof DBState.db.characterOrder) => typeof DBState.db.characterOrder): boolean {
        const current = DBState.db.characterOrder
        if (current === undefined) {
            return false
        }
        const next = change(current)
        if (next === current) {
            return false
        }
        DBState.db.characterOrder = next
        checkCharOrder()
        return true
    }

    // Groups the live selection into one new folder, closed, at the first picked tile's place. The picks
    // are resolved against the live order and entries at this moment (a menu may have waited), never
    // from anything captured earlier. A folder the group dissolved leaves the open set, as an ungroup
    // does in the rail. The selection is cleared and edit mode stays.
    function groupPicked() {
        const plan = groupPlan(picks, entryByKey, DBState.db.characters, DBState.db.characterOrder)
        if (!plan.ok) {
            return
        }
        groupGeneration++
        const spec = { id: v4(), name: language.sidebarUi.defaultFolderName }
        const idsBefore = folderIdsInOrder()
        if (!applyGridOrderChange((order) => groupIntoFolder(order, plan.sources, spec))) {
            return
        }
        const idsAfter = folderIdsInOrder()
        for (const id of idsBefore) {
            const at = openFolders.indexOf(id)
            if (!idsAfter.has(id) && at !== -1) {
                openFolders.splice(at, 1)
            }
        }
        picks.clear()
        void scrollToNewFolder(spec.id, groupGeneration)
    }

    // The choices are fixed when the menu opens and the chosen index is read against that list, so an
    // availability change while the menu waits cannot turn one choice into another.
    let menuOpen = false
    async function openBulkMenu() {
        if (menuOpen) {
            return
        }
        menuOpen = true
        try {
            const actions: ('group' | 'trash' | 'cancel')[] = []
            const labels: string[] = []
            if (groupAvailable) {
                actions.push('group')
                labels.push(language.othersUi.editGroup)
            }
            actions.push('trash', 'cancel')
            labels.push(language.othersUi.editMoveToTrash, language.cancel)
            const chosen = actions[parseInt(await alertSelect(labels))]
            if (chosen === 'group') {
                groupPicked()
            }
            else if (chosen === 'trash') {
                void trashPicked()
            }
        } finally {
            menuOpen = false
        }
    }

    // A hold released in place, a right-click and the context-menu key all arrive here. An unselected
    // character tile joins the selection first; a selected one stays as it is. The menu then acts on the
    // whole selection. Folder tiles have no menu here yet.
    function openTileMenu(key: string) {
        const entry = entryByKey.get(key)
        if (!entry || entry.kind !== 'char' || !editing || sort !== 'order') {
            return
        }
        if (!picks.has(key)) {
            togglePick(entry)
        }
        if (picks.has(key)) {
            void openBulkMenu()
        }
    }

    // A touch long press on a tile in normal mode enters edit mode with that tile selected. The rail's
    // gesture machine does the timing, the slop, the click suppression after the hold and the Android
    // context-menu guard; the Grid supplies only where a press lands (its two-dimensional tile
    // geometry) and never a target, so nothing can be dropped or moved by a gesture here.
    let gridWindow: ReturnType<typeof CharacterWindow> | undefined = $state()
    let gridScroller: HTMLDivElement | null = null
    let binding: RailBinding | null = null
    let pressedKey: string | null = null
    let lifted = false
    // Once the hold has entered edit mode the gesture runs to its release so the click after it is
    // swallowed: the switch to My order can drop the held tile from the entries, and a source that is
    // gone would otherwise end the gesture (and its click suppression) while the finger is still down.
    // Plain on purpose: the entries effect reads it untracked, and the end of the session resets it.
    let holdEnteredEdit = false
    // The tile a hold lifted while already in edit mode, for the release hook. Only a hold that began in
    // edit mode sets it, so the press that entered edit mode opens no menu. Reset when a session starts
    // (not when it ends: the session ends before the release hook runs); plain for the same reason.
    let holdMenuKey: string | null = null
    const NO_ITEMS: readonly LayoutItem[] = []
    const emptyLayout = computeLayout(NO_ITEMS, new Map())

    const geometryNow = (): GridGeometry | null => gridWindow?.getGeometry() ?? null

    const gridGeometry: RailGeometry = {
        sourceAt(_layout, x, y) {
            const geometry = geometryNow()
            const key = geometry ? tileKeyAt(geometry, x, y) : null
            const entry = key === null ? undefined : entryByKey.get(key)
            pressedKey = entry ? entry.key : null
            if (!entry) {
                return undefined
            }
            const kind = entry.kind === 'folder' ? 'folder' : entry.folderId !== undefined ? 'member' : 'char'
            return { key: entry.key, kind, ref: gestureRef(entry) }
        },
        hasKey: (_layout, key) => entryByKey.has(key),
        zoneCandidateAt: () => null,
        resolveTarget: () => NO_TARGET,
    }

    const host: RailHost = {
        getLayout: () => geometryNow()?.layout ?? emptyLayout,
        readRect: () => {
            const rect = gridScroller?.getBoundingClientRect()
            return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { left: 0, top: 0, width: 0, height: 0 }
        },
        getScrollTop: () => gridScroller?.scrollTop ?? 0,
        getScrollMax: () => gridScroller ? Math.max(0, gridScroller.scrollHeight - gridScroller.clientHeight) : 0,
        setScrollTop: (top) => {
            if (gridScroller) {
                gridScroller.scrollTop = Math.max(0, Math.min(top, host.getScrollMax()))
            }
        },
        captureTake: (pointerId) => {
            try {
                gridScroller?.setPointerCapture?.(pointerId)
            } catch {
                // The pointer is not active; the gesture then ends through its pointer events.
            }
        },
        captureRelease: (pointerId) => {
            try {
                gridScroller?.releasePointerCapture?.(pointerId)
            } catch {
                // Already released.
            }
        },
        // A held finger never scrolls the Grid: its long press has no drop target to reach.
        edgeScroll: () => false,
        onSession: (active) => {
            if (active) {
                holdMenuKey = null
            }
            else {
                lifted = false
                holdEnteredEdit = false
            }
            binding?.setSession(active)
        },
        // A touch hold that reached the lift time. A mouse never gets here: its drag start reports no lift.
        onLift: () => {
            lifted = true
        },
        onDragStart: () => {
            if (!lifted) {
                return
            }
            const entry = pressedKey === null ? undefined : entryByKey.get(pressedKey)
            if (!entry) {
                return
            }
            if (editing) {
                holdMenuKey = entry.key
                return
            }
            try {
                navigator.vibrate?.(15)
            } catch {
                // Vibration is a courtesy; a refusal changes nothing.
            }
            holdEnteredEdit = true
            enterEdit(entry)
        },
        onGhost: () => {},
        onTarget: () => {},
        onDragEnd: () => {},
        onDrop: () => {},
        onSpringOpen: () => {},
        onTouchMenu: () => {},
        // A hold released in place on a character tile, begun in edit mode: the tile's menu.
        onTouchHold: () => {
            const key = holdMenuKey
            holdMenuKey = null
            if (key !== null) {
                openTileMenu(key)
            }
        },
    }

    const machine = new RailDrag(host, undefined, gridGeometry)

    // A press whose tile left the entries ends without effect, except a hold that already entered edit
    // mode (see holdEnteredEdit).
    $effect(() => {
        void entries
        untrack(() => {
            if (!holdEnteredEdit) {
                machine.layoutChanged()
            }
        })
    })

    function attachGrid(node: HTMLDivElement) {
        gridScroller = node
        binding = bindRail(node, machine)
        // Bubble phase, after bindRail's capture-phase guard: a touch-originated contextmenu is stopped
        // there and never reaches this. Right-click and the context-menu key open the same menu as a hold,
        // in edit mode only; otherwise the browser's own menu stays.
        const onContextMenu = (event: MouseEvent) => {
            const target = event.target
            if (!editing || sort !== 'order' || !(target instanceof Element)) {
                return
            }
            const key = target.closest('[data-charlist-key]')?.getAttribute('data-charlist-key') ?? null
            const entry = key === null ? undefined : entryByKey.get(key)
            if (key === null || entry?.kind !== 'char') {
                return
            }
            event.preventDefault()
            if (!keysBlockedNow()) {
                openTileMenu(key)
            }
        }
        node.addEventListener('contextmenu', onContextMenu)
        return () => {
            node.removeEventListener('contextmenu', onContextMenu)
            machine.cancel()
            binding?.destroy()
            binding = null
            gridScroller = null
        }
    }

    onDestroy(() => machine.destroy())

    //#endregion

    // A toggle re-chunks the rows, and an open folder's tile moves into the row of its section, so the
    // element that holds focus is re-created. The focused tile is named before the change; if focus was
    // lost by the change, it goes back to that tile.
    async function toggleFolder(id: string) {
        const held = document.activeElement?.closest('[data-charlist-key]') ?? null
        const heldKey = held?.getAttribute('data-charlist-key') ?? null
        const list = held?.closest('[role="list"]') ?? null
        const at = openFolders.indexOf(id)
        if (at === -1) {
            openFolders.push(id)
        } else {
            openFolders.splice(at, 1)
        }
        if (heldKey === null || list === null) {
            return
        }
        await tick()
        const active = document.activeElement
        if (active && active !== document.body && active.isConnected) {
            return
        }
        const card = Array.from(list.querySelectorAll('[data-charlist-key]')).find((el) => el.getAttribute('data-charlist-key') === heldKey)
        card?.querySelector('button')?.focus({ preventScroll: true })
    }

    function toggleExpanded(id: string) {
        if (expanded.has(id)) {
            expanded.delete(id)
        } else {
            expanded.add(id)
        }
    }

    function reportClamp(id: string, clamped: boolean) {
        // An expanded block is not clamped, so its measurement says nothing.
        if (expanded.has(id)) {
            return
        }
        if (clamped) {
            overflowing.add(id)
        } else {
            overflowing.delete(id)
        }
    }
</script>

{#snippet listCard(cardKey: string)}
    {@const index = indexByKey.get(cardKey) ?? -1}
    {@const char = DBState.db.characters[index]}
    <!-- Defence in depth: a position past the end of a shrinking list draws no row instead of throwing. -->
    {#if char}
        {@const parsedDesc = parseMultilangString(char.creatorNotes ?? '')}
        <!-- The whole row opens the character. Keyboard users reach it through the name button, whose click bubbles here; the row's other buttons stop their clicks, and a click on a link inside the description is left to the link. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="flex p-2 border border-darkborderc rounded-md cursor-pointer" onclick={(event) => {
            if (clickedLink(event) || (!clickedButton(event) && selectedInside(event.currentTarget, window.getSelection()))) { return }
            pick(index)
        }}>
            <CharListAvatar src={char.image} />
            <div class="flex-1 flex flex-col ml-2 min-w-0">
                <h4 class="text-textcolor font-bold text-lg mb-1 break-words"><button class="text-start font-bold cursor-pointer">{char.name || language.settingsPage.unnamed}</button></h4>
                <CharacterDescription
                    text={parsedDesc['en'] || parsedDesc['xx'] || language.othersUi.noDescription}
                    visible={true}
                    clamped={!expanded.has(char.chaId)}
                    onClampChange={(clamped) => reportClamp(char.chaId, clamped)}
                />
                <div class="flex gap-2 items-center">
                    {#if expanded.has(char.chaId) || overflowing.has(char.chaId)}
                        <button class="text-sm hover:text-textcolor text-textcolor2" aria-expanded={expanded.has(char.chaId)} onclick={(event) => {
                            event.stopPropagation()
                            toggleExpanded(char.chaId)
                        }}>
                            {expanded.has(char.chaId) ? language.othersUi.showLess : language.othersUi.showMore}
                        </button>
                    {/if}
                    <div class="grow"></div>
                    <button class="hover:text-textcolor text-textcolor2" onclick={(event) => {
                        event.stopPropagation()
                        removeChar(char, char.name)
                    }}>
                        <TrashIcon />
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/snippet}

<!-- What a folder tile always shows, over its picture when it has one: its name when the setting asks for it, else the icon. -->
{#snippet folderFace(name: string, open: boolean)}
    {#if DBState.db.showFolderName}
        <span class="relative truncate font-bold text-sm px-1 {FACE_SHADOW}">{name}</span>
    {:else if open}
        <FolderOpenIcon class="relative {FACE_SHADOW}" />
    {:else}
        <FolderIcon class="relative {FACE_SHADOW}" />
    {/if}
{/snippet}

<!-- Painted over the tile's own box, so a selected tile adds nothing to the measured row height. -->
{#snippet pickMark(picked: boolean)}
    {#if picked}
        <span class="absolute inset-0 rounded-md border-2 border-textcolor bg-selected/40 pointer-events-none flex items-start justify-start p-0.5" aria-hidden="true" data-charlist-picked>
            <CheckIcon size={16} class="text-textcolor drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />
        </span>
    {/if}
{/snippet}

{#snippet gridCard(cardKey: string)}
    {@const entry = entryByKey.get(cardKey)}
    {#if entry?.kind === 'folder'}
        <!-- The tile is a native button; its picture is decorative and the folder's name is the button's. In edit mode a tap selects it and the corner chevron opens or closes the folder. -->
        <div class="relative flex items-center text-textcolor">
            <button
                class="relative overflow-hidden shrink-0 flex justify-center items-center rounded-md h-14 w-14 min-h-14 shadow-lg border border-selected cursor-pointer hover:border-textcolor2 transition-colors duration-150 {folderTileClass(entry.color)}"
                aria-expanded={entry.open}
                aria-pressed={editing ? picks.has(entry.key) : undefined}
                aria-label={entry.name || language.sidebarUi.defaultFolderName}
                onclick={() => {
                    if (editing) {
                        togglePick(entry)
                    } else {
                        void toggleFolder(entry.id)
                    }
                }}
            >
                {#if entry.imgFile}
                    <!-- The picture is a layer beneath the face; a picture that is missing, fails to load or is hidden leaves the face alone, as in the rail. -->
                    {#await folderPicture(entry.imgFile)}
                        <span class="absolute inset-0" aria-hidden="true"></span>
                    {:then pictureStyle}
                        {#if pictureStyle && !pictureStyle.includes('url("")')}
                            <span class="absolute inset-0" aria-hidden="true" style={pictureStyle}></span>
                        {/if}
                    {:catch}
                        <span class="absolute inset-0" aria-hidden="true"></span>
                    {/await}
                {/if}
                {@render folderFace(entry.name, entry.open)}
            </button>
            {#if editing}
                {@render pickMark(picks.has(entry.key))}
                <button
                    class="absolute top-0 right-0 z-10 flex items-center justify-center h-7 w-7 rounded-md bg-darkbutton/90 border border-darkborderc text-textcolor hover:bg-selected cursor-pointer"
                    aria-expanded={entry.open}
                    aria-label={language.othersUi.editFolderToggle}
                    onclick={() => { void toggleFolder(entry.id) }}
                >
                    {#if entry.open}
                        <ChevronDownIcon size={14} />
                    {:else}
                        <ChevronRightIcon size={14} />
                    {/if}
                </button>
            {/if}
        </div>
    {:else if entry}
        {@const index = entry.index}
        {@const char = DBState.db.characters[index]}
        <!-- A search result, or any sort but My order, names the folder of each member. -->
        {@const badge = (found.searching || sort !== 'order') && entry.folderName !== undefined ? (entry.folderName || language.sidebarUi.defaultFolderName) : undefined}
        <!-- Defence in depth: a position past the end of a shrinking list draws no tile instead of throwing. -->
        {#if char}
            <!-- The avatar's button is not a prop of CharListAvatar: in edit mode the attachment gives it aria-pressed from the selection. -->
            <div
                class="flex items-center text-textcolor"
                class:relative={badge !== undefined || editing}
                {@attach (node: HTMLElement) => {
                    const button = node.querySelector('button')
                    if (!button) {
                        return
                    }
                    if (editing) {
                        button.setAttribute('aria-pressed', String(picks.has(entry.key)))
                    } else {
                        button.removeAttribute('aria-pressed')
                    }
                }}
            >
                <CharListAvatar
                    src={char.image}
                    fallbackStyle={char.image ? '' : index === $selectedCharID ? 'background:var(--risu-theme-selected)' : ''}
                    label={char.name || language.settingsPage.unnamed}
                    onclick={() => {
                        if (editing) {
                            togglePick(entry)
                        } else {
                            pick(index)
                        }
                    }}
                >
                    {#if !char.image}
                        {#if char.type === 'group'}
                            <Users />
                        {:else}
                            <User/>
                        {/if}
                    {/if}
                </CharListAvatar>
                {#if editing}
                    {@render pickMark(picks.has(entry.key))}
                {/if}
                {#if badge !== undefined}
                    <span class="absolute bottom-0 inset-x-0 flex items-center gap-0.5 px-0.5 rounded-b-md bg-darkbg/80 text-textcolor2 text-[10px] leading-tight pointer-events-none">
                        <FolderIcon size={10} class="shrink-0" />
                        <span class="truncate">{badge}</span>
                    </span>
                {/if}
            </div>
        {/if}
    {/if}
{/snippet}

<div class="h-full w-full flex justify-center">
    <div class="h-full p-6 bg-darkbg max-w-full w-2xl flex flex-col">
        <div class="mx-4 mb-6 flex flex-col shrink-0">
            <div class="flex items-center gap-3 mb-2">
                <button
                    class="flex items-center justify-center p-2 rounded-lg hover:bg-selected transition-colors shrink-0"
                    onclick={() => endGrid()}
                    title={language.settingsPage.back}
                >
                    <ArrowLeft size={20} />
                </button>
                <div class="flex-1">
                    <TextInput placeholder={language.search} bind:value={search} size="lg" autocomplete="off" fullwidth={true}/>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
                <Button styled={selected === 3 ? 'primary' : 'outlined'} size="sm" onclick={() => selectTab(3)}>
                    {language.simple}
                </Button>
                <Button styled={selected === 0 ? 'primary' : 'outlined'} size="sm" onclick={() => selectTab(0)}>
                    {language.grid}
                </Button>
                <Button styled={selected === 1  ? 'primary' : 'outlined'} size="sm" onclick={() => selectTab(1)}>
                    {language.list}
                </Button>
                <Button styled={selected === 2  ? 'primary' : 'outlined'} size="sm" onclick={() => selectTab(2)}>
                    {language.trash}
                </Button>
                <div class="grow"></div>
                <span class="text-textcolor2 text-sm">
                    {selected === 2 ? found.trash.length : found.live.length} {language.character}
                </span>
            </div>
            {#if selected === 0}
                <!-- Its own line, so the tab buttons and the count never wrap or crowd at a narrow width. The row keeps one height in both modes, so entering or leaving edit mode moves no tile; sorting is offered only outside edit mode. Nothing in the row wraps, since a second line would outgrow it. When the count's full text does not fit beside the labelled trash button the count shows only its number; when not even the number fits there, the trash button becomes an icon with the same name and tooltip, and the count is its full text if that fits beside the icon, else its number, which is never cut short. Screen readers always get the full count text and the trash button's name. The measures are invisible copies and the row's own width, never the forms on screen. The row is not selectable, so a hold that ends on it starts no text selection. -->
                <div class="relative mt-2 h-8 flex items-center gap-2 select-none [-webkit-touch-callout:none]" bind:this={rowEl}>
                    {#if editing}
                        <span class="sr-only" aria-live="polite">{countFull}</span>
                        <div class="min-w-0 flex-1 text-sm" class:flex-none={rowForms.iconTrash && rowForms.count === 'number'}>
                            <span class="block text-textcolor2" class:truncate={!(rowForms.iconTrash && rowForms.count === 'number')} class:whitespace-nowrap={rowForms.iconTrash && rowForms.count === 'number'} aria-hidden="true">{countShown}</span>
                        </div>
                        <span class="invisible absolute left-0 top-0 whitespace-nowrap pointer-events-none text-sm" aria-hidden="true" bind:this={countProbe}>{countFull}</span>
                        <span class="invisible absolute left-0 top-0 whitespace-nowrap pointer-events-none text-sm" aria-hidden="true" bind:this={numberProbe}>{picks.size}</span>
                        <span class="invisible absolute left-0 top-0 whitespace-nowrap pointer-events-none border px-2 py-1 text-sm" aria-hidden="true" bind:this={labelProbe}>{language.othersUi.editMoveToTrash}</span>
                        <button
                            bind:this={groupBtn}
                            class="shrink-0 flex items-center justify-center h-8 w-8 rounded-md border border-darkborderc bg-darkbutton text-textcolor hover:bg-selected transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label={language.othersUi.editGroup}
                            title={language.othersUi.editGroup}
                            disabled={!groupAvailable || trashing}
                            onclick={() => { groupPicked() }}
                        >
                            <FolderPlusIcon size={16} />
                        </button>
                        {#if rowForms.iconTrash}
                            <button
                                class="shrink-0 flex items-center justify-center h-8 w-8 rounded-md border border-red-600 bg-red-700 text-textcolor hover:bg-red-500 focus:outline-hidden focus:ring-2 focus:ring-red-600 shadow-xs transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                aria-label={language.othersUi.editMoveToTrash}
                                title={language.othersUi.editMoveToTrash}
                                disabled={picks.size === 0 || trashing}
                                onclick={() => { void trashPicked() }}
                            >
                                <TrashIcon size={16} />
                            </button>
                        {:else}
                            <Button styled="danger" size="sm" className="shrink-0 whitespace-nowrap" disabled={picks.size === 0 || trashing} onclick={() => { void trashPicked() }}>
                                {language.othersUi.editMoveToTrash}
                            </Button>
                        {/if}
                    {:else}
                        <label class="flex items-center gap-2 text-textcolor2 text-sm">
                            <span>{language.othersUi.sortLabel}</span>
                            <SelectInput size="sm" value={sort} onchange={(event) => chooseSort(event.currentTarget.value)}>
                                <option value="order">{language.othersUi.sortMyOrder}</option>
                                <option value="recent">{language.recent}</option>
                                <option value="name">{language.name}</option>
                            </SelectInput>
                        </label>
                    {/if}
                </div>
            {/if}
        </div>
        <!-- The header above stays on screen; each tab below is the only scroller of its content. -->
        {#if selected === 0}

            <div class="relative flex-1 min-h-0 flex flex-col">
                <!-- Vertical panning stays with the browser; the callout and text selection are off so a long press is the Grid's. The bottom padding lets the last row scroll clear of the floating button. -->
                <CharacterWindow bind:this={gridWindow} attach={attachGrid} class="flex-1 min-h-0 pb-16 select-none [touch-action:pan-y] [-webkit-touch-callout:none]" layout="grid" rows={gridRowsFor} fallbackHeight={GRID_ROW_FALLBACK_PX} resetToken={JSON.stringify([sort, found.query])} rowClass="flex justify-center supports-[justify-content:safe_center]:[justify-content:safe_center] gap-2 pb-2" card={gridCard} />
                <button
                    class="absolute bottom-3 right-6 z-10 flex items-center gap-1 px-4 py-2 rounded-full shadow-lg bg-darkbutton hover:bg-selected border border-darkborderc text-textcolor cursor-pointer"
                    onclick={() => { if (editing) { exitEdit() } else { enterEdit() } }}
                >
                    {#if editing}
                        <CheckIcon size={16} />
                        {language.othersUi.editDone}
                    {:else}
                        <PencilIcon size={16} />
                        {language.othersUi.editMode}
                    {/if}
                </button>
            </div>
        {:else if selected === 1}
            <CharacterWindow class="flex-1 min-h-0" rows={listRowsNow} fallbackHeight={LIST_ROW_FALLBACK_PX} resetToken={found.query} rowClass="pb-2" card={listCard} />
        {:else if selected === 2}
            <div class="flex-1 min-h-0 flex flex-col">
                <CharacterTrashList found={found} />
            </div>
        {:else if selected === 3}
            <div class="flex-1 min-h-0 flex flex-col">
                <MobileCharacters endGrid={endGrid} hideTrash={true} results={found} />
            </div>
        {/if}
    </div>
</div>
