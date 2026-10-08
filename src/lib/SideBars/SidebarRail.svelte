<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { DBState, selectedCharID } from "src/ts/stores.svelte";
  import { FolderIcon, FolderOpenIcon } from "@lucide/svelte";
  import { addCharacter, changeChar, getCharImage } from "../../ts/characters";
  import { language } from "../../lang";
  import isEqual from "lodash/isEqual";
  import SidebarAvatar from "./SidebarAvatar.svelte";
  import SidebarIndicator from "./SidebarIndicator.svelte";
  import BaseRoundedButton from "../UI/BaseRoundedButton.svelte";
  import { getCharacterIndexObject, selectSingleFile } from "src/ts/util";
  import { v4 } from "uuid";
  import { checkCharOrder, saveAsset } from "src/ts/globalApi.svelte";
  import { applyFolderImage } from "./folderImage";
  import { beginBusy } from "src/ts/process/memory/busyActions";
  import { alertInput, alertSelect } from "src/ts/alert";
  import { getFolderColorLabels, getFolderColorValue } from "./folderColors";
  import { setRailTooltipsSuppressed, tooltipRail } from "src/ts/gui/tooltip";
  import { keyEventBlocked, keysBlockedNow } from "src/ts/keyEventBlocked";
  import type { folder } from "src/ts/storage/database.svelte";
  import {
    editFolder,
    dropOnItem,
    listRows,
    moveToGap,
    refKey,
    type CharRef,
    type FolderRef,
    type Gap,
    type ItemRef,
    type MemberRef,
  } from "./sidebarOrder";
  import {
    PLUS_KEY,
    buildItems,
    computeLayout,
    folderBackground,
    folderHeadKey,
    folderTailKey,
    gapKey,
    type RailEntry,
  } from "./railLayout";
  import {
    DEFAULT_HEIGHTS,
    REVEAL_PIN_TIMEOUT_MS,
    SCROLL_SMOOTH_MAX_VIEWPORTS,
    UNMEASURED_VIEWPORT_PX,
    WINDOW_MIN_OVERSCAN_ROWS,
    WINDOW_OVERSCAN_VIEWPORTS,
  } from "./railConstants";
  import { buildSlices, computeWindow } from "./railWindow";
  import { NO_TARGET, type Target } from "./railTarget";
  import { RailDrag, type RailHost } from "./railDrag";
  import { bindRail, type RailBinding } from "./railBinding";
  import {
    classifyKey,
    describePosition,
    focusStep,
    keyboardMove,
    railRows,
    resolveCurrent,
    type CurrentEntry,
    type MoveDirection,
  } from "./railKeyboard";

  interface Props {
    reseter: () => void;
    sideBarMode: number;
  }

  let { reseter, sideBarMode }: Props = $props();

  type sortTypeNormal = { type:'normal', key:string, img: string, index: number, name:string }
  type sortTopNormal = sortTypeNormal & { ref: CharRef }
  type sortMember = sortTypeNormal & { ref: MemberRef }
  type sortFolder = {type:'folder', key:string, ref:FolderRef, folder:sortMember[], id:string, name:string, color:string, img?:string}
  type sortType = sortTopNormal | sortFolder
  let charImages: sortType[] = $state([]);
  let IconRounded = $state(false)
  let openFolders:string[] = $state([])

  $effect(() => {
    let newCharImages: sortType[] = [];
    const idObject = getCharacterIndexObject()
    const rows = listRows(DBState.db.characterOrder, (id) => Object.hasOwn(idObject, id))
    for (const row of rows) {
      if(row.kind === 'char'){
        const index = idObject[row.id]
        const cha = DBState.db.characters[index]
        newCharImages.push({
          key: row.key,
          ref: row.ref,
          img:cha.image ?? "",
          index:index,
          type: "normal",
          name: cha.name
        });
      }
      else{
        const folderCharImages: sortMember[] = []
        for(const member of row.members){
          const index = idObject[member.id]
          const cha = DBState.db.characters[index]
          folderCharImages.push({
            key: member.key,
            ref: member.ref,
            img:cha.image ?? "",
            index:index,
            type: "normal",
            name: cha.name
          });
        }
        newCharImages.push({
          key: row.key,
          ref: row.ref,
          folder: folderCharImages,
          type: "folder",
          id: row.id,
          name: row.entry.name,
          color: row.entry.color,
          img: row.entry.imgFile,
        });
      }
    }
    if (!isEqual(charImages, newCharImages)) {
      charImages = newCharImages;
    }
    if(IconRounded !== DBState.db.roundIcons){
      IconRounded = DBState.db.roundIcons
    }
  })

  // The selected character's row is the one `selectedKey` names. A folder that owns it opens
  // first, so the layout holds the row, then the rail scrolls it to the top: animated while it
  // is within SCROLL_SMOOTH_MAX_VIEWPORTS viewports, a jump beyond that or with animations off.
  async function scrollToActiveCharacter() {
    const key = keyOfSelected($selectedCharID)
    if (key === null) return

    for (const item of charImages) {
      if (item.type === 'folder' && item.folder.some((member) => member.key === key)) {
        if (!openFolders.includes(item.id)) {
          openFolders.push(item.id)
        }
        break
      }
    }
    await tick()

    const target = scrollTargetFor(key, 'top')
    if (target === null) return
    const near = Math.abs(target - scroller.scrollTop) <= SCROLL_SMOOTH_MAX_VIEWPORTS * viewportHeightNow()
    await scrollToKey(key, 'top', near && DBState.db.animationSpeed !== 0 ? 'smooth' : 'instant')
  }

  $effect(() => {
    if (typeof window === 'undefined') return

    const handler = () => {
      scrollToActiveCharacter()
    }

    window.addEventListener('scrollToActiveCharacter', handler)

    return () => {
      window.removeEventListener('scrollToActiveCharacter', handler)
    }
  })

  // Every drop is resolved against the live order by id and occurrence. The
  // result is assigned through `DBState.db.characterOrder` and followed by
  // `checkCharOrder()`; an operation that changes nothing writes nothing.
  const applyOrderChange = (change: (order: typeof DBState.db.characterOrder) => typeof DBState.db.characterOrder) => {
    const current = DBState.db.characterOrder
    const next = change(current)
    if(next === current){
      return
    }
    DBState.db.characterOrder = next
    checkCharOrder()
  }

  const moveDragTo = (drag:ItemRef, gap:Gap) => {
    applyOrderChange((order) => moveToGap(order, drag, gap))
  }

  const dropDragOn = (drag:ItemRef, target:ItemRef) => {
    applyOrderChange((order) => dropOnItem(order, drag, target, {
      id: v4(),
      name: language.sidebarUi.defaultFolderName,
    }))
  }

  // Finds the folder by id at the moment of writing, so an edit that waited
  // on a dialog or a file picker never lands on a different entry.
  const editFolderById = (id:string, edit:(copy:folder) => void) => {
    const next = editFolder(DBState.db.characterOrder, id, edit)
    if(next){
      DBState.db.characterOrder = next
    }
  }

  const folderExists = (id:string) => editFolder(DBState.db.characterOrder, id, () => {}) !== null

  async function openFolderMenu(folderId:string, folderName:string) {
    const sel = parseInt(await alertSelect([language.renameFolder,language.changeFolderColor,language.changeFolderImage,language.cancel]))
    if(sel === 0){
      const v = await alertInput(language.changeFolderName, [], folderName)
      if(v){
        editFolderById(folderId, (entry) => { entry.name = v })
      }
    }
    else if(sel === 1){
      const sel = parseInt(await alertSelect(getFolderColorLabels()))
      const colorValue = getFolderColorValue(sel)
      if(colorValue === undefined){
        return
      }
      editFolderById(folderId, (entry) => { entry.color = colorValue })
    }
    else if(sel === 2) {
      const sel = parseInt(await alertSelect([language.alerts.resetToDefaultImage, language.alerts.selectImageFile]))

      switch (sel) {
        case 0:
          editFolderById(folderId, (entry) => { applyFolderImage(entry, null) })
          break;

        case 1:
          const folderImage = await selectSingleFile([
            'png',
            'jpg',
            'webp',
          ])

          if(!folderImage) {
            return
          }

          // A folder that is gone, or whose id is not unique, has no safe target: no asset is saved for it.
          if(!folderExists(folderId)) {
            return
          }

          const busy = beginBusy('imageAdd')
          try {
            const folderImageData = await saveAsset(folderImage.data)

            editFolderById(folderId, (entry) => { applyFolderImage(entry, folderImageData) })
          } finally {
            busy.end()
          }
          break;
      }
    }
  }

  //#region geometry

  const entries: RailEntry[] = $derived(charImages.map((char) => ({
    ref: char.ref,
    key: char.key,
    open: char.type === 'folder' && openFolders.includes(char.id),
    members: char.type === 'folder' ? char.folder.map((member) => ({ ref: member.ref, key: member.key })) : [],
  })))
  const items = $derived(buildItems(entries))
  // Heights read from the mounted elements. A key without a measurement uses its kind's default.
  const measured = new Map<string, number>()
  let measureTick = $state(0)
  const layout = $derived.by(() => {
    void measureTick
    return computeLayout(items, measured)
  })

  const itemAttrs = (key: string, kind: string, scope?: string, owner?: string) => {
    const index = layout.indexByKey.get(key)
    return {
      'data-rail-key': key,
      'data-rail-kind': kind,
      'data-rail-scope': scope,
      'data-rail-owner': owner,
      'data-rail-y': index === undefined ? undefined : String(layout.offsets[index]),
      'data-rail-h': index === undefined ? undefined : String(layout.heights[index]),
    }
  }

  let scroller: HTMLDivElement
  const measuredKeys = new WeakMap<Element, string>()
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((records) => {
    let changed = false
    let rectMoved = false
    for (const record of records) {
      if (record.target === scroller) {
        rectMoved = true
        continue
      }
      // A hidden or collapsed container reports zero sizes; the last good heights stay.
      if (scroller.clientHeight === 0) {
        continue
      }
      const key = measuredKeys.get(record.target)
      if (key === undefined) {
        continue
      }
      const height = record.borderBoxSize?.[0]?.blockSize ?? record.contentRect.height
      if (height > 0 && measured.get(key) !== height) {
        measured.set(key, height)
        changed = true
      }
    }
    if (changed) {
      measureTick++
    }
    if (rectMoved) {
      // Also the report after a hidden container is shown again: the window follows the DOM.
      readViewport(scroller)
      machine.rectChanged()
    }
  })

  // A measurement outlives the row's element: a row that is scrolled out and back keeps its
  // height, so the offsets above it never move again. It is dropped only with its key.
  function measure(node: Element, key: string) {
    measuredKeys.set(node, key)
    resizeObserver?.observe(node)
    return {
      destroy() {
        resizeObserver?.unobserve(node)
        measuredKeys.delete(node)
      },
    }
  }

  $effect(() => {
    const live = new Set(items.map((item) => item.key))
    untrack(() => {
      for (const key of Array.from(measured.keys())) {
        if (!live.has(key)) {
          measured.delete(key)
        }
      }
    })
  })

  //#endregion

  //#region window

  // The scroll position and height the window is computed from. Only `readViewport` writes
  // them, and always from the container's own values, never from a remembered scroll position.
  let viewScrollTop = $state(0)
  // The last non-zero height the container reported; 0 until it has reported one.
  let viewportH = $state(0)
  const windowViewport = $derived(
    viewportH > 0 ? viewportH : typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : UNMEASURED_VIEWPORT_PX,
  )
  const overscanPx = $derived(Math.max(WINDOW_OVERSCAN_VIEWPORTS * windowViewport, WINDOW_MIN_OVERSCAN_ROWS * DEFAULT_HEIGHTS.char))

  // Rows kept mounted outside the band: the Tab stop (which is also the focused entry), the
  // entry a reveal is scrolling to, and the row a pointer press is on.
  let revealPin: string | null = $state(null)
  let pressPin: string | null = $state(null)
  // The "+" button is not an entry, but while it holds focus it stays mounted: an unmounted
  // focused element would leave the rail believing it still has focus and pull the scroll
  // back to the Tab stop on the next change.
  let plusFocused = $state(false)
  let revealTarget: number | null = null
  let revealSmooth = false
  let revealTimer: ReturnType<typeof setTimeout> | null = null

  // Open folders whose span meets the band are drawn even when their head and tail rows are not mounted.
  const backgrounds = $derived.by(() => {
    const from = viewScrollTop - overscanPx
    const to = viewScrollTop + windowViewport + overscanPx
    const drawn: Array<{ key: string; top: number; height: number; color: string }> = []
    for (const char of charImages) {
      if (char.type !== 'folder' || !openFolders.includes(char.id)) {
        continue
      }
      const span = folderBackground(layout, char.key)
      if (span && span.top + span.height >= from && span.top <= to) {
        drawn.push({ key: char.key, top: span.top, height: span.height, color: char.color })
      }
    }
    return drawn
  })

  const folderTint: Record<string, string> = {
    red: 'bg-red-700/20',
    yellow: 'bg-yellow-700/20',
    green: 'bg-green-700/20',
    blue: 'bg-blue-700/20',
    indigo: 'bg-indigo-700/20',
    purple: 'bg-purple-700/20',
    pink: 'bg-pink-700/20',
  }

  function readViewport(el: HTMLElement) {
    viewScrollTop = el.scrollTop
    if (el.clientHeight > 0) {
      viewportH = el.clientHeight
    }
    if (revealPin !== null && revealSmooth && revealTarget !== null && Math.abs(el.scrollTop - revealTarget) < 1) {
      releaseReveal()
    }
  }

  const viewportHeightNow = (): number => (scroller.clientHeight > 0 ? scroller.clientHeight : windowViewport)

  function releaseReveal() {
    if (revealTimer !== null) {
      clearTimeout(revealTimer)
      revealTimer = null
    }
    revealTarget = null
    revealSmooth = false
    revealPin = null
  }

  function pinReveal(key: string, target: number, smooth: boolean) {
    releaseReveal()
    revealPin = key
    revealTarget = target
    revealSmooth = smooth
    revealTimer = setTimeout(releaseReveal, REVEAL_PIN_TIMEOUT_MS)
  }

  /**
   * The scroll position that brings `key` to the top (`top`) or just into view (`nearest`,
   * unchanged when it already is), from the layout model; `null` when the key is not listed.
   */
  function scrollTargetFor(key: string, mode: 'nearest' | 'top'): number | null {
    const index = layout.indexByKey.get(key)
    if (index === undefined) {
      return null
    }
    const viewport = viewportHeightNow()
    const current = scroller.scrollTop
    const top = layout.offsets[index]
    const bottom = top + layout.heights[index]
    let target = current
    if (mode === 'top' || top < current) {
      target = top
    }
    else if (bottom > current + viewport) {
      target = bottom - viewport
    }
    return Math.max(0, Math.min(target, Math.max(0, layout.total - viewport)))
  }

  /**
   * The one way the rail scrolls to an entry. An instant scroll writes the window state in the
   * same turn, from the position the container ended up at (it may clamp), so the entry is
   * mounted after the next render without waiting for the scroll event. A smooth scroll leaves
   * the window to the scroll events. Either way the entry stays mounted until the scroll
   * arrives, the reveal is released, or REVEAL_PIN_TIMEOUT_MS passes.
   */
  async function scrollToKey(key: string, mode: 'nearest' | 'top', behavior: 'instant' | 'smooth') {
    const target = scrollTargetFor(key, mode)
    if (target === null) {
      return
    }
    if (behavior === 'smooth' && Math.abs(target - scroller.scrollTop) >= 1) {
      pinReveal(key, target, true)
      scroller.scrollTo?.({ top: target, behavior: 'smooth' })
      return
    }
    pinReveal(key, target, false)
    scroller.scrollTop = target
    readViewport(scroller)
    await tick()
  }

  //#endregion

  //#region keyboard

  // One entry is the Tab stop and the target of arrow keys: the last one that took focus,
  // else the selected character's row, else the first. It is never persisted.
  const rows = $derived(railRows(items))
  // Where each entry sits among all entries, for `aria-posinset`; the "+" block comes last.
  const rowPosition = $derived(new Map(rows.map((row, at) => [row.key, at + 1])))
  // Row data by key, so a mounted item finds its character, folder or member without a scan.
  const rowByKey = $derived.by(() => {
    const byKey = new Map<string, sortType | sortMember>()
    for (const char of charImages) {
      byKey.set(char.key, char)
      if (char.type === 'folder') {
        for (const member of char.folder) {
          byKey.set(member.key, member)
        }
      }
    }
    return byKey
  })
  // The first occurrence of the selected character in model order.
  function keyOfSelected(selected: number): string | null {
    if (selected === -1) {
      return null
    }
    for (const char of charImages) {
      if (char.type === 'normal') {
        if (char.index === selected) {
          return char.key
        }
      }
      else {
        const member = char.folder.find((m) => m.index === selected)
        if (member) {
          return member.key
        }
      }
    }
    return null
  }
  const selectedKey = $derived(keyOfSelected($selectedCharID))
  let current: CurrentEntry | null = $state.raw(null)
  const tabKey = $derived(resolveCurrent(rows, current, selectedKey)?.key ?? null)

  const pinnedKeys = $derived([tabKey, revealPin, pressPin, plusFocused ? PLUS_KEY : null].filter((key): key is string => key !== null))
  const mountedWindow = $derived(computeWindow(layout, viewScrollTop, windowViewport, overscanPx, pinnedKeys))
  const slices = $derived(buildSlices(layout, mountedWindow))

  // Keeps the remembered index and owner in step with the rows, and moves the current entry
  // off a row that went away.
  $effect(() => {
    const shown = rows
    untrack(() => {
      if (!current) {
        return
      }
      const next = resolveCurrent(shown, current, selectedKey)
      if (next && (next.key !== current.key || next.index !== current.index || next.owner !== current.owner)) {
        current = next
      }
    })
  })

  const entryOf = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('[data-rail-entry]') : null

  const entryElement = (key: string): HTMLElement | undefined =>
    Array.from(scroller.querySelectorAll<HTMLElement>('[data-rail-entry]')).find((el) => el.getAttribute('data-rail-entry') === key)

  function setCurrent(key: string) {
    const index = rows.findIndex((row) => row.key === key)
    current = { key, index: index >= 0 ? index : (current?.index ?? 0), owner: index >= 0 ? (rows[index].owner ?? null) : null }
  }

  // An entry outside the viewport is scrolled to first, which mounts it, then focused. While
  // the reveal runs its row is pinned; focus makes it the Tab stop, which pins it from then on.
  async function revealEntry(key: string): Promise<boolean> {
    const index = layout.indexByKey.get(key)
    if (index === undefined) {
      return false
    }
    let el = entryElement(key)
    const top = layout.offsets[index]
    const view = scroller.scrollTop
    if (!el || top < view || top + layout.heights[index] > view + viewportHeightNow()) {
      await scrollToKey(key, 'nearest', 'instant')
      el = entryElement(key)
    }
    // Only the reveal this call owns is released: an arrow key must not drop the pin of a
    // scroll-to-active that is still in flight for another entry.
    if (!el) {
      if (revealPin === key) {
        releaseReveal()
      }
      return false
    }
    el.focus({ preventScroll: true })
    if (revealPin === key) {
      releaseReveal()
    }
    return true
  }

  // The rail holds focus from a focusin inside it until focus leaves it. A focused entry that
  // is removed can report a focusout without a related target, so a focusout counts only when
  // its target is still attached afterwards and focus is then outside the rail.
  let railHasFocus = false

  // Chromium fires focusout synchronously while a keyed each-block moves a focused entry, inside
  // a block effect where writing `$state` throws. The pin is therefore settled in a microtask,
  // from where focus actually is by then.
  function syncPlusFocus() {
    queueMicrotask(() => {
      if (!scroller?.isConnected) {
        return
      }
      const active = document.activeElement
      plusFocused = active instanceof Element && scroller.contains(active) && entryOf(active) === null && active.closest('[data-rail-kind="plus"]') !== null
    })
  }

  function onFocusIn(e: FocusEvent) {
    railHasFocus = true
    const el = entryOf(e.target)
    if (el) {
      setCurrent(el.getAttribute('data-rail-entry')!)
    }
    syncPlusFocus()
  }

  function onFocusOut(e: FocusEvent) {
    syncPlusFocus()
    if (e.relatedTarget instanceof Node && scroller.contains(e.relatedTarget)) {
      return
    }
    const target = e.target
    queueMicrotask(() => {
      if (target instanceof Node && target.isConnected && !scroller.contains(document.activeElement)) {
        railHasFocus = false
      }
    })
  }

  // A rail change must not drop focus to the page body.
  $effect(() => {
    void rows
    untrack(() => {
      void tick().then(() => {
        if (!railHasFocus) {
          return
        }
        const active = document.activeElement
        if (active && active !== document.body && active.isConnected) {
          return
        }
        const key = resolveCurrent(rows, current, selectedKey)?.key
        if (key !== undefined) {
          void revealEntry(key)
        }
      })
    })
  })

  let liveText = $state('')
  let announceToken = 0
  // Cleared and committed before the new text is set, so an identical message is read again.
  async function announce(text: string) {
    const token = ++announceToken
    liveText = ''
    await tick()
    if (token === announceToken) {
      liveText = text
    }
  }

  function announcePosition(order: typeof DBState.db.characterOrder, ref: ItemRef) {
    const info = describePosition(order, items, ref)
    if (!info) {
      return
    }
    void announce(info.folderName === undefined
      ? language.sidebarUi.movePosition(info.position, info.total)
      : language.sidebarUi.movePositionInFolder(info.position, info.total, info.folderName))
  }

  const toggleFolder = (id: string) => {
    const at = openFolders.indexOf(id)
    if (at >= 0) {
      openFolders.splice(at, 1)
    }
    else {
      openFolders.push(id)
    }
  }

  function activateEntry(key: string) {
    for (const char of charImages) {
      if (char.key === key) {
        if (char.type === 'folder') {
          toggleFolder(char.id)
        }
        else {
          changeChar(char.index, {reseter})
        }
        return
      }
      if (char.type === 'folder') {
        const member = char.folder.find((m) => m.key === key)
        if (member) {
          changeChar(member.index, {reseter})
          return
        }
      }
    }
  }

  async function moveEntry(key: string, dir: MoveDirection) {
    const ref = items.find((item) => item.key === key)?.ref
    if (!ref) {
      return
    }
    const order = DBState.db.characterOrder
    const result = keyboardMove(order, items, ref, dir)
    if (!result) {
      void announce(dir === 'up' ? language.sidebarUi.moveAtStart : language.sidebarUi.moveAtEnd)
    }
    else if (result.kind === 'refuse-sole') {
      const owner = charImages.find((char) => char.type === 'folder' && char.key === refKey(result.folder))
      void announce(language.sidebarUi.moveWouldRemoveFolder(owner?.name ?? language.sidebarUi.unnamedFolder))
    }
    else if (result.kind === 'focus') {
      setCurrent(refKey(result.ref))
      announcePosition(order, result.ref)
      await revealEntry(refKey(result.ref))
    }
    else {
      const movedKey = refKey(result.ref)
      applyOrderChange(() => result.order)
      setCurrent(movedKey)
      announcePosition(result.order, result.ref)
      await tick()
      await revealEntry(movedKey)
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const el = entryOf(e.target)
    if (!el || e.isComposing) {
      return
    }
    const action = classifyKey(e)
    if (!action) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    if (keyEventBlocked(e) || machine.isPressed) {
      return
    }
    const key = el.getAttribute('data-rail-entry')!
    if (action.kind === 'focus') {
      const target = focusStep(rows.map((row) => row.key), key, action.key)
      if (target !== null) {
        void revealEntry(target)
      }
    }
    else if (action.kind === 'activate') {
      activateEntry(key)
    }
    else if (!e.repeat) {
      void moveEntry(key, action.dir)
    }
  }

  function folderMenu(e: MouseEvent, id: string, name: string) {
    e.preventDefault()
    if (!keysBlockedNow()) {
      void openFolderMenu(id, name)
    }
  }

  function onClick(e: MouseEvent) {
    const el = entryOf(e.target)
    if (el) {
      activateEntry(el.getAttribute('data-rail-entry')!)
    }
  }

  function railKeys(node: HTMLElement) {
    node.addEventListener('click', onClick)
    node.addEventListener('keydown', onKeyDown)
    node.addEventListener('focusin', onFocusIn)
    node.addEventListener('focusout', onFocusOut)
    return {
      destroy() {
        node.removeEventListener('click', onClick)
        node.removeEventListener('keydown', onKeyDown)
        node.removeEventListener('focusin', onFocusIn)
        node.removeEventListener('focusout', onFocusOut)
      },
    }
  }

  //#endregion

  //#region drag
  let dragSourceKey: string | null = $state(null)
  let dropTarget: Target = $state.raw(NO_TARGET)
  let ghost: HTMLElement | null = null
  let binding: RailBinding | null = null
  const GHOST_SIZE = 56

  function findItemElement(key: string): Element | undefined {
    return Array.from(scroller.querySelectorAll('[data-rail-key]')).find((el) => el.getAttribute('data-rail-key') === key)
  }

  function createGhost(key: string) {
    removeGhost()
    const avatar = findItemElement(key)?.querySelector('.avatar')
    const el = document.createElement('div')
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('data-rail-ghost', '')
    el.style.cssText = `position:fixed;left:0;top:0;width:${GHOST_SIZE}px;height:${GHOST_SIZE}px;pointer-events:none;z-index:1000;opacity:0.85;will-change:transform;transition:none`
    if (avatar) {
      const copy = avatar.cloneNode(true) as HTMLElement
      // The copy must never answer `[data-char-id]` lookups.
      copy.removeAttribute('data-char-id')
      copy.removeAttribute('tabindex')
      el.appendChild(copy)
    }
    document.body.appendChild(el)
    ghost = el
  }

  function removeGhost() {
    ghost?.remove()
    ghost = null
  }

  const host: RailHost = {
    getLayout: () => layout,
    readRect: () => {
      const rect = scroller.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    },
    getScrollTop: () => scroller.scrollTop,
    getScrollMax: () => Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    setScrollTop: (top) => {
      scroller.scrollTop = Math.max(0, Math.min(top, host.getScrollMax()))
    },
    captureTake: (pointerId) => {
      try {
        scroller.setPointerCapture?.(pointerId)
      } catch {
        // The pointer is not active; the drag then ends through its pointer events.
      }
    },
    captureRelease: (pointerId) => {
      try {
        scroller.releasePointerCapture?.(pointerId)
      } catch {
        // Already released.
      }
    },
    onPress: (source) => {
      pressPin = refKey(source)
    },
    onSession: (active) => {
      if (!active) {
        pressPin = null
      }
      binding?.setSession(active)
      setRailTooltipsSuppressed(active)
    },
    onLift: () => {
      try {
        navigator.vibrate?.(15)
      } catch {
        // Vibration is a courtesy; a refusal changes nothing.
      }
    },
    onDragStart: (source, x, y) => {
      const key = refKey(source)
      dragSourceKey = key
      createGhost(key)
      placeGhost(x, y)
    },
    onGhost: (x, y) => placeGhost(x, y),
    onTarget: (target) => {
      dropTarget = target
    },
    onDragEnd: () => {
      removeGhost()
      dragSourceKey = null
      dropTarget = NO_TARGET
    },
    onDrop: (source, target) => {
      if (target.kind === 'gap') {
        moveDragTo(source, target.gap)
      }
      else if (target.kind === 'merge' || target.kind === 'append') {
        dropDragOn(source, target.ref)
      }
    },
    onSpringOpen: (folderRef) => {
      if (!openFolders.includes(folderRef.id)) {
        openFolders.push(folderRef.id)
      }
    },
    onTouchMenu: (folderRef) => {
      const row = charImages.find((char) => char.type === 'folder' && char.key === refKey(folderRef))
      if (row && row.type === 'folder') {
        void openFolderMenu(row.id, row.name)
      }
    },
  }

  function placeGhost(x: number, y: number) {
    if (ghost) {
      ghost.style.transform = `translate3d(${x - GHOST_SIZE / 2}px, ${y - GHOST_SIZE / 2}px, 0)`
    }
  }

  const machine = new RailDrag(host)

  $effect(() => {
    void layout
    untrack(() => machine.layoutChanged())
  })

  let viewFrame: number | null = null

  // The window follows the container: its scroll events (one read per animation frame), the end
  // of a smooth scroll, and its size changes (see the ResizeObserver callback).
  function railBinding(node: HTMLDivElement) {
    binding = bindRail(node, machine)
    resizeObserver?.observe(node)
    readViewport(node)
    const onViewportScroll = () => {
      if (viewFrame === null) {
        viewFrame = requestAnimationFrame(() => {
          viewFrame = null
          readViewport(node)
        })
      }
    }
    const onScrollEnd = () => {
      if (revealSmooth) {
        releaseReveal()
      }
    }
    node.addEventListener('scroll', onViewportScroll)
    node.addEventListener('scrollend', onScrollEnd)
    return {
      destroy() {
        node.removeEventListener('scroll', onViewportScroll)
        node.removeEventListener('scrollend', onScrollEnd)
        if (viewFrame !== null) {
          cancelAnimationFrame(viewFrame)
          viewFrame = null
        }
        resizeObserver?.unobserve(node)
        binding?.destroy()
        binding = null
      },
    }
  }

  onDestroy(() => {
    machine.destroy()
    removeGhost()
    releaseReveal()
    resizeObserver?.disconnect()
  })

  const rowEffects = (key: string) => {
    let classes = ''
    if (dragSourceKey === key) {
      classes += ' opacity-40'
    }
    if ((dropTarget.kind === 'merge' || dropTarget.kind === 'append') && dropTarget.key === key) {
      classes += ' rounded-lg ring-2 ring-textcolor2 bg-textcolor/10'
    }
    return classes
  }

  const indicatorY = $derived.by(() => {
    if (dropTarget.kind !== 'gap' || dropTarget.noop) {
      return null
    }
    const index = layout.indexByKey.get(dropTarget.key)
    return index === undefined ? null : layout.offsets[index] + layout.heights[index] / 2 - 1.5
  })

  //#endregion
</script>

{#snippet gapEl(gap: Gap, scope: 'top' | 'folder', owner: string | undefined, z: string)}
  {@const key = gapKey(gap)}
  <div class="h-4 min-h-4 w-14 {z}" aria-hidden="true" use:measure={key} {...itemAttrs(key, 'gap', scope, owner)}></div>
{/snippet}

<div
  bind:this={scroller}
  use:railBinding
  use:railKeys
  role="list"
  class="relative flex grow w-full flex-col items-center overflow-x-hidden overflow-y-auto pr-0 select-none"
  style="touch-action: pan-y; -webkit-touch-callout: none; overflow-anchor: none;"
  data-rail-scroll
  data-rail-total={layout.total}
>
  {#each slices as slice (slice.key)}
    {#if slice.kind === 'spacer'}
      <div class="w-14 shrink-0" aria-hidden="true" data-rail-spacer
        style:height="{slice.height}px" style:min-height="{slice.height}px"></div>
    {:else}
      {@const item = slice.item}
      {#if item.kind === 'gap' && item.gap}
        {@render gapEl(item.gap, item.gap.in === 'top' ? 'top' : 'folder', item.owner, item.gap.in === 'top' ? '' : item.gap.after === null ? 'relative z-10' : 'relative z-20')}
      {:else if item.kind === 'folderHead'}
        <div class="h-2 min-h-2 w-14" aria-hidden="true" use:measure={item.key} {...itemAttrs(item.key, 'folderHead', undefined, item.owner)}></div>
      {:else if item.kind === 'folderTail'}
        <div class="h-1 min-h-1 w-14" aria-hidden="true" use:measure={item.key} {...itemAttrs(item.key, 'folderTail', undefined, item.owner)}></div>
      {:else if item.kind === 'char' || item.kind === 'folder'}
        {@const char = rowByKey.get(item.key)}
        {#if char}
          {@const isOpen = char.type === 'folder' && openFolders.includes(char.id)}
          <div class="group relative flex items-center px-2{rowEffects(char.key)}"
            role="listitem"
            aria-setsize={rows.length + 1}
            aria-posinset={rowPosition.get(char.key)}
            use:measure={char.key}
            {...itemAttrs(char.key, char.type === 'folder' ? 'folder' : 'char')}
          >
            <SidebarIndicator
              isActive={char.type === 'normal' && $selectedCharID === char.index && sideBarMode !== 1}
            />
            <div
                role="button" tabindex={tabKey === char.key ? 0 : -1}
                data-rail-entry={char.key}
                aria-label={char.name}
                aria-expanded={char.type === 'folder' ? isOpen : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                class="outline-none focus-visible:ring-2 focus-visible:ring-textcolor2 {IconRounded ? 'rounded-full' : 'rounded-md'}"
                use:tooltipRail={char.name}
                oncontextmenu={char.type === 'folder' ? (e) => folderMenu(e, char.id, char.name) : undefined}
              >
              {#if char.type === 'normal'}
                {@const imgPath = char.img}
                <SidebarAvatar
                  src={imgPath ? getCharImage(imgPath, "thumb") : "/none.webp"}
                  size="56"
                  rounded={IconRounded}
                  chaId={DBState.db.characters[char.index]?.chaId}
                />
              {:else if char.type === "folder"}
                {#key char.color}
                {#key char.name}
                  {@const folderImgPath = char.img}
                  {@const avatarBg = folderImgPath ? getCharImage(folderImgPath, "thumb") : ""}
                  <SidebarAvatar src="slot" size="56" rounded={IconRounded} bordered color={char.color} backgroundimg={avatarBg}>
                    {#if DBState.db.showFolderName}
                      <div class="h-full w-full flex justify-center items-center">
                        <span class="hyphens-auto truncate font-bold">{char.name}</span>
                      </div>
                    {:else if isOpen}
                      <FolderOpenIcon />
                    {:else}
                      <FolderIcon />
                    {/if}
                  </SidebarAvatar>
                {/key}
                {/key}
              {/if}
            </div>
          </div>
        {/if}
      {:else if item.kind === 'member'}
        {@const member = rowByKey.get(item.key)}
        {#if member && member.type === 'normal'}
          <div class="group relative flex items-center px-2 z-10{rowEffects(member.key)}"
            role="listitem"
            aria-setsize={rows.length + 1}
            aria-posinset={rowPosition.get(member.key)}
            use:measure={member.key}
            {...itemAttrs(member.key, 'member', undefined, item.owner)}
          >
            <SidebarIndicator
              isActive={$selectedCharID === member.index && sideBarMode !== 1}
            />
            <div
                role="button" tabindex={tabKey === member.key ? 0 : -1}
                data-rail-entry={member.key}
                aria-label={member.name}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                class="outline-none focus-visible:ring-2 focus-visible:ring-textcolor2 {IconRounded ? 'rounded-full' : 'rounded-md'}"
                use:tooltipRail={member.name}
              >
              <SidebarAvatar
                src={member.img ? getCharImage(member.img, "thumb") : "/none.webp"}
                size="56"
                rounded={IconRounded}
                chaId={DBState.db.characters[member.index]?.chaId}
              />
            </div>
          </div>
        {/if}
      {:else if item.kind === 'plus'}
        <div class="flex flex-col items-center gap-2 px-2" role="listitem"
          aria-setsize={rows.length + 1}
          aria-posinset={rows.length + 1}
          use:measure={PLUS_KEY} {...itemAttrs(PLUS_KEY, 'plus')}>
          <BaseRoundedButton
            onClick={async () => {
              addCharacter({reseter})
            }}
            ><svg viewBox="0 0 24 24" width="1.2em" height="1.2em"
              ><path
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6v6m0 0v6m0-6h6m-6 0H6"
              /></svg
            ></BaseRoundedButton
          >
        </div>
      {/if}
    {/if}
  {/each}
  {#each backgrounds as bg (bg.key)}
    <div class="absolute inset-x-0 flex justify-center pointer-events-none z-0" aria-hidden="true"
      style:top="{bg.top}px" style:height="{bg.height}px" data-rail-folder-bg={bg.key}>
      <div class="relative left-1 h-full w-16 border border-selected rounded-lg {folderTint[bg.color] ?? 'bg-darkbg/20'}"></div>
    </div>
  {/each}
  {#if indicatorY !== null}
    <div class="absolute left-0 top-0 z-30 flex w-full justify-center pointer-events-none" aria-hidden="true"
      style:transform="translateY({indicatorY}px)"
      style:transition={DBState.db.animationSpeed === 0 ? 'none' : 'transform 0.08s'}
      data-rail-indicator>
      <div class="h-[3px] w-14 rounded-full bg-green-500"></div>
    </div>
  {/if}
</div>
<div class="sr-only" aria-live="polite" aria-atomic="true" data-rail-live>{liveText}</div>
