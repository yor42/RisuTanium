<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import { v4 } from "uuid";
    import { changeChar, getCharImage, removeChar, trashCharacters } from "../../ts/characters";
    import { checkCharOrder } from "src/ts/globalApi.svelte";
    import { alertConfirm, alertSelect } from "src/ts/alert";
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
    import { folderEntryAt, foldersDissolvedBy, groupIntoFolder, moveManyToGap, refKey, type DissolvedFolder, type FolderRef, type Gap, type ItemRef, type OrderEntry } from "../SideBars/sidebarOrder";
    import { RailDrag, type RailHost } from "../SideBars/railDrag";
    import { bindRail, type RailBinding } from "../SideBars/railBinding";
    import { GRID_TOUCH_MERGE_DWELL_MS, TOUCH_SLOP_PX } from "../SideBars/railConstants";
    import { computeLayout, type LayoutItem } from "../SideBars/railLayout";
    import type { RailGeometry } from "../SideBars/railResolver";
    import { NO_TARGET, type Target } from "../SideBars/railTarget";
    import { actingPicks, canEdit, chooseRowForms, dragPlan, gestureRef, groupPlan, resolvePicked, samePick, stalePickedKeys, type DragPlan, type Picked, type RowMeasure } from "./charListEdit";
    import { appendGap, buildDropModel, gapOf, resolveGridTarget, zoneCandidateAt as gridZoneCandidateAt, type GridDropModel, type GridResolved, type GridSlot } from "./gridDrop";
    import { directionOfKey, gridKeyMove, tileKeyOfRef } from "./gridKeyboard";
    import type { MoveDirection, PositionInfo } from "../SideBars/railKeyboard";
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
    // `trashCharacters` also edits the order), the group into a new folder (`groupPicked`) and the drop of
    // dragged tiles (`commitDrop`) and the keyboard move of one tile (`moveFocusedTile`), which assign characterOrder and repair it as the rail does: mounting,
    // searching, opening folders, choosing a sort, entering and leaving edit mode, selecting and every
    // cancelled or refused action write nothing, never assign characterOrder and never repair the order;
    // the order is the rail's.
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

    // Counts the ways a waiting drop confirmation is overtaken: leaving edit mode (Done, Escape, a tab or
    // sort switch) and closing the screen. A drop captures it before it asks and writes only if it is
    // unchanged after the answer.
    let dropGeneration = 0
    // The polite live region after a drop: cleared and committed before the new text is set, so the
    // same message twice is read twice.
    let liveText = $state('')
    let announceToken = 0
    async function announce(text: string) {
        const token = ++announceToken
        liveText = ''
        await tick()
        if (token === announceToken) {
            liveText = text
        }
    }

    function exitEdit() {
        editing = false
        enterGeneration++
        groupGeneration++
        dropGeneration++
        announceToken++
        liveText = ''
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

    // A touch long press on a tile in normal mode enters edit mode with that tile selected; in edit mode
    // a 500 ms hold lifts a tile and a mouse drag starts after 5 px. The rail's gesture machine does the
    // timing, the slop, the click suppression after the hold and the Android context-menu guard; the Grid
    // supplies where a press lands and what a pointer position would drop (its two-dimensional geometry,
    // `gridDrop`). A drag has a target only in a session that began in edit mode (`drag.enabled`), so the
    // press that enters edit mode never drops, and only after a touch has travelled (a hold released in
    // place keeps opening the tile menu). The one write is `commitDrop`.
    let gridWindow: ReturnType<typeof CharacterWindow> | undefined = $state()
    let gridScroller: HTMLDivElement | null = null
    let binding: RailBinding | null = null
    let pressedKey: string | null = null
    let lifted = false
    // Once the hold has entered edit mode the gesture runs to its release so the click after it is
    // swallowed: the switch to My order can drop the held tile from the entries, and a source that is
    // gone would otherwise end the gesture (and its click suppression) while the finger is still down.
    // It belongs to the entering press only: a press that begins in edit mode ends when its tile leaves
    // the entries. Plain on purpose: the entries effect reads it untracked, and the end of the session
    // resets it.
    let holdEnteredEdit = false
    // The tile a hold lifted while already in edit mode, for the release hook. Only a hold that began in
    // edit mode sets it, so the press that entered edit mode opens no menu. Reset when a session starts
    // (not when it ends: the session ends before the release hook runs); plain for the same reason.
    let holdMenuKey: string | null = null
    const NO_ITEMS: readonly LayoutItem[] = []
    const emptyLayout = computeLayout(NO_ITEMS, new Map())

    const geometryNow = (): GridGeometry | null => gridWindow?.getGeometry() ?? null

    // The state of one gesture, for the gate, the drop and the confirmation. Decision state, not display:
    // plain, a new object when a session starts (`onSession(true)`), and NEVER reset when it ends,
    // because the machine tears the session down (both end callbacks) before it calls `onDrop`.
    // `enabled` is fixed at the start: edit mode under My order, no search, no drop waiting for its
    // answer; a session that began outside edit mode (the press that enters it, a mouse drag) is never
    // enabled, even after edit mode starts mid-gesture. `pressedKey` and `pressedPicked` are the tile
    // the drag began on and the object it stood for; `travelled` latches once a touch has moved
    // `TOUCH_SLOP_PX` from `pressX`/`pressY` (a mouse drag, which began after 5 px, is past it).
    interface DragSession {
        enabled: boolean
        mouse: boolean
        travelled: boolean
        pressX: number
        pressY: number
        pressedKey: string | null
        pressedPicked: Picked | null
    }
    let drag: DragSession = { enabled: false, mouse: false, travelled: false, pressX: 0, pressY: 0, pressedKey: null, pressedPicked: null }
    // Where the latest pointerdown landed, written by a capture listener that runs before the machine's own
    // handler, because `onSession(true)` runs inside it and the record is rebuilt there.
    let pendingPress = { x: 0, y: 0 }
    // What the machine's last `resolveTarget` answered, with the slot behind it. `onDrop` matches its
    // target by identity and takes the slot from it; reset only when a session starts.
    let lastResolved: GridResolved | null = null
    // True while a drop waits for its confirmation: a second drop is ignored and no session is enabled.
    let dropInFlight = false
    let railRect = { left: 0, top: 0, width: 0, height: 0 }

    type MovePlan = Extract<DragPlan, { ok: true }>

    // The tiles the session would move now, from the live selection, entries and order. Null while the
    // gate fails: not enabled, not editing under My order, a search active, the pressed tile no longer the
    // object it was, or a tile without an order entry. `needTravel` false skips only the travel check (the
    // lift haptic), never any other.
    function livePlan(session: DragSession, needTravel: boolean): MovePlan | null {
        if (!session.enabled || !editing || sort !== 'order' || found.searching) {
            return null
        }
        if (needTravel && !session.mouse && !session.travelled) {
            return null
        }
        if (session.pressedKey === null || session.pressedPicked === null) {
            return null
        }
        const plan = dragPlan(picks, entries, entryByKey, DBState.db.characters, DBState.db.characterOrder, { key: session.pressedKey, picked: session.pressedPicked })
        return plan.ok ? plan : null
    }
    const movePlan = (session: DragSession): MovePlan | null => livePlan(session, true)

    // The content box starts after the scroller's border and left padding, the same two quantities the
    // window subtracts from the width it lays rows out in.
    function contentOriginX(): number {
        if (!gridScroller) {
            return 0
        }
        return (gridScroller.clientLeft || 0) + (parseFloat(getComputedStyle(gridScroller).paddingLeft) || 0)
    }

    // The drop model and the no-op answers are keyed by the identity of `entries`, which every change the
    // tiles read replaces; the order array itself is edited in place by `checkCharOrder` and the trash,
    // so its reference must never be a key.
    let modelFor: { entries: readonly GridEntry[], model: GridDropModel } | null = null
    function dropModel(): GridDropModel {
        if (modelFor === null || modelFor.entries !== entries) {
            modelFor = { entries, model: buildDropModel(entries) }
        }
        return modelFor.model
    }
    let noopMemo: { entries: readonly GridEntry[], moved: string, answers: Map<string, boolean> } | null = null
    function isNoopGap(plan: MovePlan, gap: Gap, key: string): boolean {
        const moved = JSON.stringify([...plan.keys])
        if (noopMemo === null || noopMemo.entries !== entries || noopMemo.moved !== moved) {
            noopMemo = { entries, moved, answers: new Map() }
        }
        let answer = noopMemo.answers.get(key)
        if (answer === undefined) {
            const order = DBState.db.characterOrder
            answer = order === undefined || moveManyToGap(order, plan.sources, gap) === order
            noopMemo.answers.set(key, answer)
        }
        return answer
    }

    const gridGeometry: RailGeometry = {
        sourceAt(_layout, x, y) {
            const geometry = geometryNow()
            const key = geometry ? tileKeyAt(geometry, x - contentOriginX(), y) : null
            const entry = key === null ? undefined : entryByKey.get(key)
            pressedKey = entry ? entry.key : null
            if (!entry) {
                return undefined
            }
            const kind = entry.kind === 'folder' ? 'folder' : entry.folderId !== undefined ? 'member' : 'char'
            return { key: entry.key, kind, ref: gestureRef(entry) }
        },
        hasKey: (_layout, key) => entryByKey.has(key),
        // Nothing here reads the `source` the machine hands over (it can be a placeholder for a tile with
        // no order entry); the moved set comes from the session and the live state.
        zoneCandidateAt(_layout, x, y) {
            const geometry = geometryNow()
            const plan = movePlan(drag)
            if (!geometry || !plan) {
                return null
            }
            return gridZoneCandidateAt(geometry, dropModel(), x - contentOriginX(), y, { keys: plan.keys, sources: plan.sources })
        },
        resolveTarget(input) {
            const geometry = geometryNow()
            const plan = movePlan(drag)
            if (!geometry || !plan) {
                lastResolved = { target: NO_TARGET, slot: null }
                return NO_TARGET
            }
            const resolved = resolveGridTarget({
                geometry,
                model: dropModel(),
                x: input.x - contentOriginX(),
                y: input.y,
                viewportY: input.y - host.getScrollTop(),
                viewportHeight: railRect.height,
                outside: input.outside,
                moved: { keys: plan.keys, sources: plan.sources },
                zoneKey: input.zoneKey,
                mergeArmed: input.mergeArmed,
                isNoop: (gap, key) => isNoopGap(plan, gap, key),
            })
            lastResolved = resolved
            return resolved.target
        },
    }

    //#region what the drag looks like

    // Display state, separate from the decision state above: cleared when the drag ends, whatever ended it.
    // The ghost is a body-level fixed element (the dragged tile's row may be unmounted by the window while
    // the finger scrolls); the bar and the ring are painted inside the tiles' own boxes, so the measured
    // row heights never change.
    const NO_KEYS: ReadonlySet<string> = new Set()
    const GHOST_SIZE = 56
    let ghost: HTMLElement | null = null
    let dimmedKeys: ReadonlySet<string> = $state.raw(NO_KEYS)
    let dropBar: { key: string, side: 'before' | 'after' } | null = $state.raw(null)
    let dropRing: string | null = $state.raw(null)

    function createGhost(plan: MovePlan) {
        removeGhost()
        const tile = drag.pressedKey === null || !gridScroller ? undefined
            : Array.from(gridScroller.querySelectorAll('[data-charlist-key]')).find((el) => el.getAttribute('data-charlist-key') === drag.pressedKey)
        const el = document.createElement('div')
        el.setAttribute('aria-hidden', 'true')
        el.setAttribute('data-grid-ghost', '')
        el.style.cssText = `position:fixed;left:0;top:0;width:${GHOST_SIZE}px;height:${GHOST_SIZE}px;pointer-events:none;z-index:1000;opacity:0.85;will-change:transform;transition:none`
        const copy = tile?.firstElementChild?.cloneNode(true)
        if (copy instanceof HTMLElement) {
            // The copy must never answer the tile lookups or take focus.
            copy.removeAttribute('data-charlist-key')
            copy.querySelectorAll('button').forEach((button) => button.setAttribute('tabindex', '-1'))
            el.appendChild(copy)
        } else {
            el.className = 'rounded-md bg-selected'
        }
        if (plan.count > 1) {
            const badge = document.createElement('span')
            badge.className = 'absolute -top-1 -right-1 min-w-5 h-5 px-1 flex items-center justify-center rounded-full bg-darkbutton border border-darkborderc text-textcolor text-xs'
            badge.textContent = String(plan.count)
            el.appendChild(badge)
        }
        document.body.appendChild(el)
        ghost = el
        dimmedKeys = plan.keys
    }

    function removeGhost() {
        ghost?.remove()
        ghost = null
        dimmedKeys = NO_KEYS
        dropBar = null
        dropRing = null
    }

    // The ghost and the dimming appear with the first evaluation that can target, and go if the gate fails.
    function followPointer(x: number, y: number) {
        const plan = movePlan(drag)
        if (!plan) {
            if (ghost) {
                removeGhost()
            }
            return
        }
        if (!ghost) {
            createGhost(plan)
        }
        ghost!.style.transform = `translate3d(${x - GHOST_SIZE / 2}px, ${y - GHOST_SIZE / 2}px, 0)`
    }

    // The bar sits on the edge of the tile the slot is beside; the end of the list is the last tile's right edge.
    function barFor(slot: GridSlot): { key: string, side: 'before' | 'after' } | null {
        if (slot.kind === 'gap') {
            return { key: slot.anchorKey, side: slot.side }
        }
        if (slot.kind === 'end' && entries.length > 0) {
            return { key: entries[entries.length - 1].key, side: 'after' }
        }
        return null
    }

    //#endregion

    //#region the drop

    type Order = typeof DBState.db.characterOrder

    // What a release would do, built from the live state: every input is read again here, so the same
    // function builds the plan before a confirmation and again after it.
    interface DropPlan {
        plan: MovePlan
        merge: boolean
        dissolved: DissolvedFolder[]
        // The tile the slot is on or beside and the object it stands for; the folder object a folder gap is in.
        anchorKey: string | null
        anchorPicked: Picked | null
        destFolder: DissolvedFolder['entry'] | null
        apply: (order: Order) => Order
    }

    function planDrop(session: DragSession, slot: GridSlot): DropPlan | null {
        const plan = movePlan(session)
        const order = DBState.db.characterOrder
        if (!plan || order === undefined) {
            return null
        }
        if (slot.kind === 'merge') {
            const tile = entryByKey.get(slot.tileKey)
            const target = tile?.ref
            if (!tile || tile.kind !== 'char' || target?.kind !== 'char' || plan.keys.has(tile.key)) {
                return null
            }
            const spec = { id: v4(), name: language.sidebarUi.defaultFolderName }
            return {
                plan,
                merge: true,
                dissolved: foldersDissolvedBy(order, plan.sources, { in: 'merge', target }),
                anchorKey: tile.key,
                anchorPicked: resolvePicked(tile, DBState.db.characters, order),
                destFolder: null,
                apply: (live) => groupIntoFolder(live, plan.sources, spec, target),
            }
        }
        let gap: Gap | null
        let anchorKey: string | null = null
        if (slot.kind === 'append') {
            const tile = entryByKey.get(slot.tileKey)
            const ref = tile?.ref
            if (!tile || tile.kind !== 'folder' || ref?.kind !== 'folder' || plan.keys.has(tile.key)) {
                return null
            }
            gap = appendGap(order, ref)
            anchorKey = tile.key
        } else {
            gap = gapOf(slot, dropModel())
            anchorKey = slot.kind === 'gap' ? slot.anchorKey : null
        }
        if (!gap) {
            return null
        }
        const destFolder = gap.in === 'folder' ? folderEntryAt(order, gap.folder) : null
        if (gap.in === 'folder' && !destFolder) {
            return null
        }
        const anchor = anchorKey === null ? undefined : entryByKey.get(anchorKey)
        const toGap = gap
        return {
            plan,
            merge: false,
            dissolved: foldersDissolvedBy(order, plan.sources, toGap),
            anchorKey,
            anchorPicked: anchor ? resolvePicked(anchor, DBState.db.characters, order) : null,
            destFolder,
            apply: (live) => moveManyToGap(live, plan.sources, toGap),
        }
    }

    // The same destination as the plan the user was asked about: the same anchor and folder objects and the
    // same set of dissolved folders, by identity.
    function sameDrop(asked: DropPlan, now: DropPlan): boolean {
        const sameAnchor = asked.anchorPicked === null ? now.anchorPicked === null : now.anchorPicked !== null && samePick(asked.anchorPicked, now.anchorPicked)
        return asked.merge === now.merge
            && asked.anchorKey === now.anchorKey
            && sameAnchor
            && asked.destFolder === now.destFolder
            && asked.dissolved.length === now.dissolved.length
            && asked.dissolved.every((folder) => now.dissolved.some((other) => other.entry === folder.entry))
    }

    function folderIdCount(order: readonly OrderEntry[] | undefined, id: string): number {
        return (order ?? []).filter((entry) => typeof entry === 'object' && entry !== null && Array.isArray(entry.data) && entry.id === id).length
    }

    // A kept folder tile is picked again only for an id that is unique before and after a write: a folder
    // an operation edits is a new object and would otherwise leave the selection, but with a repeated id a
    // move can shift occurrences, so the folder now at that key may be a look-alike the user never picked.
    interface KeptFolder { key: string, ref: FolderRef, unique: boolean }

    // The picked folder tiles a write keeps (not the dissolved ones), noted before the write with whether
    // their id is unique in the order.
    function keptPickedFolders(dissolved: readonly DissolvedFolder[]): KeptFolder[] {
        const kept: KeptFolder[] = []
        for (const [key, pick] of picks) {
            const ref = entryByKey.get(key)?.ref
            if (pick.kind === 'folder' && ref?.kind === 'folder' && !dissolved.some((folder) => folder.entry === pick.folder)) {
                kept.push({ key, ref, unique: folderIdCount(DBState.db.characterOrder, ref.id) === 1 })
            }
        }
        return kept
    }

    // After the write, synchronously: a kept folder is picked again only when its id is unique before and
    // after, because a folder the operation edited is a new object and the stale-pick effect would drop it.
    function repickKeptFolders(kept: readonly KeptFolder[]) {
        for (const folder of kept) {
            if (folder.unique && folderIdCount(DBState.db.characterOrder, folder.ref.id) === 1) {
                const now = folderEntryAt(DBState.db.characterOrder ?? [], folder.ref)
                if (now) {
                    picks.set(folder.key, { kind: 'folder', folder: now })
                }
            }
        }
    }

    // The one write of a drag: the rail's assignment and repair of the saved order, then the follow-ups.
    // A merge clears the selection; a move or an append keeps it (kept folder tiles are picked again).
    function commitDrop(drop: DropPlan): boolean {
        const keptFolders = drop.merge ? [] : keptPickedFolders(drop.dissolved)
        const idsBefore = folderIdsInOrder()
        if (!applyGridOrderChange(drop.apply)) {
            return false
        }
        const idsAfter = folderIdsInOrder()
        for (const id of idsBefore) {
            const at = openFolders.indexOf(id)
            if (!idsAfter.has(id) && at !== -1) {
                openFolders.splice(at, 1)
            }
        }
        if (drop.merge) {
            picks.clear()
        }
        repickKeptFolders(keptFolders)
        void announce(language.othersUi.editMoved(drop.plan.count))
        return true
    }

    // Asks first when the drop would remove a dragged folder, then builds the plan again from the live
    // state, because the order, the selection or the screen may have changed while the question was open.
    // It handles its own errors: the machine's guard around `onDrop` does not see a rejected promise.
    async function confirmAndDrop(asked: DropPlan, session: DragSession, slot: GridSlot, generation: number) {
        try {
            const names = asked.dissolved.map((dissolved) => dissolved.entry.name || language.sidebarUi.defaultFolderName)
            if (!await alertConfirm(language.othersUi.editFolderRemoveConfirm(names))) {
                return
            }
            if (generation !== dropGeneration) {
                return
            }
            const now = planDrop(session, slot)
            if (now && sameDrop(asked, now)) {
                commitDrop(now)
            }
        } catch (error) {
            console.error('Grid drop failed:', error)
        } finally {
            dropInFlight = false
        }
    }

    // Runs synchronously inside the machine's `pointerUp`, after the session ended. The `source` the
    // machine passes is never used: it can be a placeholder; the tiles come from the session record and
    // the destination from the slot of the target the resolver recorded.
    function handleDrop(target: Target) {
        const resolved = lastResolved
        if (dropInFlight || resolved === null || resolved.target !== target || resolved.slot === null) {
            return
        }
        const session = drag
        const asked = planDrop(session, resolved.slot)
        if (!asked) {
            return
        }
        if (asked.dissolved.length === 0) {
            commitDrop(asked)
            return
        }
        dropInFlight = true
        void confirmAndDrop(asked, session, resolved.slot, dropGeneration)
    }

    //#endregion

    //#region the keyboard

    // Alt+Left and Alt+Right on a focused tile in edit mode move that one tile one place: the rail's
    // `keyboardMove` over the Grid's tiles (`gridKeyboard`), written by the same `applyGridOrderChange` as a
    // drop. The selection is neither moved nor cleared (kept folder tiles are picked again), and a result
    // that changes nothing writes nothing.
    function announcePosition(info: PositionInfo | null) {
        if (info) {
            void announce(info.folderName === undefined
                ? language.sidebarUi.movePosition(info.position, info.total)
                : language.sidebarUi.movePositionInFolder(info.position, info.total, info.folderName || language.sidebarUi.defaultFolderName))
        }
    }

    // Focus goes back to the moved tile once the rows are rebuilt (its element is new when it changed rows),
    // after scrolling its row into view if the move took it out of sight.
    async function focusTile(ref: ItemRef) {
        await tick()
        const geometry = geometryNow()
        const key = tileKeyOfRef(entries, ref)
        const scroller = gridScroller
        if (!editing || key === null || !scroller || !geometry) {
            return
        }
        const index = rowIndexOf(key)
        if (index >= 0) {
            centreRowIfHidden(geometry, index, scroller)
            await tick()
        }
        const tile = Array.from(scroller.querySelectorAll('[data-charlist-key]')).find((el) => el.getAttribute('data-charlist-key') === key)
        tile?.querySelector('button')?.focus({ preventScroll: true })
    }

    async function moveFocusedTile(tileKey: string, dir: MoveDirection) {
        const order = DBState.db.characterOrder
        if (order === undefined) {
            return
        }
        const live = new Set(found.live.map((match) => match.chaId))
        const result = gridKeyMove(entries, order, tileKey, dir, (id) => live.has(id))
        if (result.kind === 'edge') {
            void announce(result.dir === 'up' ? language.sidebarUi.moveAtStart : language.sidebarUi.moveAtEnd)
        }
        else if (result.kind === 'refuse-sole') {
            void announce(language.sidebarUi.moveWouldRemoveFolder(result.folderName || language.sidebarUi.defaultFolderName))
        }
        else if (result.kind === 'focus') {
            announcePosition(result.info)
            await focusTile(result.ref)
        }
        else if (result.kind === 'move') {
            const kept = keptPickedFolders([])
            if (applyGridOrderChange(() => result.order)) {
                repickKeptFolders(kept)
                announcePosition(result.info)
                await focusTile(result.ref)
            }
        }
    }

    // The browser would take Alt+Left for history Back, so every handled press is kept from it first,
    // including a refused or blocked one; then a gesture in progress, a drop waiting for its answer and a
    // repeating key only keep the press from acting.
    function onTileKeyDown(event: KeyboardEvent) {
        if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || !event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
            return
        }
        if (event.isComposing || !editing || sort !== 'order' || found.searching) {
            return
        }
        const target = event.target
        const tileKey = target instanceof Element ? target.closest('[data-charlist-key]')?.getAttribute('data-charlist-key') ?? null : null
        const dir = directionOfKey(event.key)
        if (tileKey === null || dir === null) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        if (keyEventBlocked(event) || machine.isPressed || dropInFlight || event.repeat) {
            return
        }
        void moveFocusedTile(tileKey, dir)
    }

    //#endregion

    // The long press that enters edit mode and the lift of a tile in edit mode give the same short tick.
    function vibrateTick() {
        try {
            navigator.vibrate?.(15)
        } catch {
            // Vibration is a courtesy; a refusal changes nothing.
        }
    }

    const host: RailHost = {
        getLayout: () => geometryNow()?.layout ?? emptyLayout,
        readRect: () => {
            const rect = gridScroller?.getBoundingClientRect()
            railRect = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : { left: 0, top: 0, width: 0, height: 0 }
            return railRect
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
        // A held finger scrolls the Grid only while the drag can reach a target: not for the press that
        // enters edit mode, not for a hold that has not travelled, not under a search.
        edgeScroll: () => movePlan(drag) !== null,
        onSession: (active) => {
            if (active) {
                holdMenuKey = null
                drag = {
                    enabled: editing && sort === 'order' && !found.searching && !dropInFlight,
                    mouse: false,
                    travelled: false,
                    pressX: pendingPress.x,
                    pressY: pendingPress.y,
                    pressedKey: null,
                    pressedPicked: null,
                }
                lastResolved = null
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
            const entry = pressedKey === null ? undefined : entryByKey.get(pressedKey)
            if (!entry) {
                return
            }
            if (drag.enabled) {
                const picked = resolvePicked(entry, DBState.db.characters, DBState.db.characterOrder)
                if (picked) {
                    drag.pressedKey = entry.key
                    drag.pressedPicked = picked
                }
                else {
                    drag.enabled = false
                }
            }
            if (!lifted) {
                // A mouse drag in edit mode has no hold menu and no haptic; it is past the travel gate.
                if (drag.enabled) {
                    drag.mouse = true
                }
                return
            }
            if (editing) {
                holdMenuKey = entry.key
                // The tick says the tile is lifted; a hold that cannot drag stays silent.
                if (livePlan(drag, false)) {
                    vibrateTick()
                }
                return
            }
            vibrateTick()
            holdEnteredEdit = true
            enterEdit(entry)
        },
        onGhost: (x, y) => {
            if (!drag.travelled && Math.hypot(x - drag.pressX, y - drag.pressY) >= TOUCH_SLOP_PX) {
                drag.travelled = true
            }
            followPointer(x, y)
        },
        onTarget: (target) => {
            const slot = lastResolved?.target === target ? lastResolved.slot : null
            if (!slot || target.kind === 'none' || (target.kind === 'gap' && target.noop)) {
                dropBar = null
                dropRing = null
            }
            else if (target.kind === 'gap') {
                dropRing = null
                dropBar = barFor(slot)
            }
            else {
                dropBar = null
                dropRing = target.key
            }
        },
        onDragEnd: () => removeGhost(),
        onDrop: (_source, target) => handleDrop(target),
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

    const machine = new RailDrag(host, undefined, gridGeometry, { touchMergeDwellMs: GRID_TOUCH_MERGE_DWELL_MS })

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
        // Capture phase and registered first, so it runs before the machine's own pointerdown handler,
        // which starts the session and needs the press point (a second finger is ignored).
        const onPressCapture = (event: PointerEvent) => {
            if (!machine.isPressed) {
                pendingPress = { x: event.clientX, y: event.clientY }
            }
        }
        node.addEventListener('pointerdown', onPressCapture, true)
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
        node.addEventListener('keydown', onTileKeyDown)
        return () => {
            node.removeEventListener('keydown', onTileKeyDown)
            node.removeEventListener('contextmenu', onContextMenu)
            node.removeEventListener('pointerdown', onPressCapture, true)
            machine.cancel()
            binding?.destroy()
            binding = null
            gridScroller = null
        }
    }

    onDestroy(() => {
        // A confirmation still open must not write after the screen is gone.
        dropGeneration++
        machine.destroy()
        ghost?.remove()
        ghost = null
    })

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

<!-- The target of a drag, painted over the tile's own box like pickMark: a bar on the edge a dropped tile would land beside, or a ring on the tile a drop would merge into or append to. -->
{#snippet dropMark(key: string)}
    {#if dropRing === key}
        <span class="absolute inset-0 rounded-md ring-2 ring-textcolor2 bg-textcolor/10 pointer-events-none" aria-hidden="true" data-grid-drop-ring></span>
    {:else if dropBar?.key === key}
        <span class="absolute inset-y-0 w-[3px] rounded-full bg-textcolor pointer-events-none {dropBar.side === 'before' ? 'left-0' : 'right-0'}" aria-hidden="true" data-grid-drop-bar></span>
    {/if}
{/snippet}

{#snippet gridCard(cardKey: string)}
    {@const entry = entryByKey.get(cardKey)}
    {#if entry?.kind === 'folder'}
        <!-- The tile is a native button; its picture is decorative and the folder's name is the button's. In edit mode a tap selects it and the corner chevron opens or closes the folder. -->
        <div class="relative flex items-center text-textcolor" class:opacity-40={dimmedKeys.has(entry.key)}>
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
            {@render dropMark(entry.key)}
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
                class:opacity-40={dimmedKeys.has(entry.key)}
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
                {@render dropMark(entry.key)}
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
                <div class="sr-only" role="status" aria-atomic="true" data-grid-live>{liveText}</div>
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
