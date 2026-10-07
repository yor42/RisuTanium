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
  import { nearViewport } from "src/ts/gui/nearViewport.svelte";
  import { setRailTooltipsSuppressed, tooltipRail } from "src/ts/gui/tooltip";
  import { keyEventBlocked, keysBlockedNow } from "src/ts/keyEventBlocked";
  import { SvelteMap } from "svelte/reactivity";
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
  // Row keys (unique per row, see `refKey`) of the rows near the sidebar's own
  // scroll viewport, each mapped to its owning element. A row keeps its key
  // when it moves, so its avatar state moves with it. `nearViewport`'s destroy
  // calls `onChange(false, node)` on every unmount, including a folder
  // member's when its folder closes; mapping to the owning element means that
  // release only clears a key if `node` still owns it, so an unmount can never
  // clear a different, still-visible row that was given the same key.
  let visibleRows = new SvelteMap<string, Element>()

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

  function scrollToActiveCharacter() {
    const selectedId = $selectedCharID
    if (selectedId === -1) return

    const characterId = DBState.db.characters[selectedId]?.chaId
    if (!characterId) return

    let targetFolderId: string | null = null

    for (const item of charImages) {
      if (item.type === 'folder') {
        const foundChar = item.folder.find(c =>
          DBState.db.characters[c.index]?.chaId === characterId
        )
        if (foundChar) {
          targetFolderId = item.id
          break
        }
      }
    }

    if (targetFolderId && !openFolders.includes(targetFolderId)) {
      openFolders.push(targetFolderId)
    }

    setTimeout(() => {
      const activeElement = document.querySelector(`[data-char-id="${characterId}"]`)
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        })
      }
    }, 100)
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
      machine.rectChanged()
    }
  })

  function measure(node: Element, key: string) {
    measuredKeys.set(node, key)
    resizeObserver?.observe(node)
    return {
      destroy() {
        resizeObserver?.unobserve(node)
        measuredKeys.delete(node)
        if (measured.delete(key)) {
          measureTick++
        }
      },
    }
  }

  //#endregion

  //#region keyboard

  // One entry is the Tab stop and the target of arrow keys: the last one that took focus,
  // else the selected character's row, else the first. It is never persisted.
  const rows = $derived(railRows(items))
  const selectedKey = $derived.by(() => {
    const selected = $selectedCharID
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
  })
  let current: CurrentEntry | null = $state.raw(null)
  const tabKey = $derived(resolveCurrent(rows, current, selectedKey)?.key ?? null)

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

  function focusEntry(key: string): boolean {
    const el = entryElement(key)
    if (!el) {
      return false
    }
    el.focus({ preventScroll: true })
    el.scrollIntoView?.({ block: 'nearest', behavior: DBState.db.animationSpeed === 0 ? 'instant' : 'smooth' })
    return true
  }

  // The rail holds focus from a focusin inside it until focus leaves it. A focused entry that
  // is removed can report a focusout without a related target, so a focusout counts only when
  // its target is still attached afterwards and focus is then outside the rail.
  let railHasFocus = false

  function onFocusIn(e: FocusEvent) {
    railHasFocus = true
    const el = entryOf(e.target)
    if (el) {
      setCurrent(el.getAttribute('data-rail-entry')!)
    }
  }

  function onFocusOut(e: FocusEvent) {
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
          focusEntry(key)
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
      focusEntry(refKey(result.ref))
      announcePosition(order, result.ref)
    }
    else {
      const movedKey = refKey(result.ref)
      applyOrderChange(() => result.order)
      setCurrent(movedKey)
      announcePosition(result.order, result.ref)
      await tick()
      focusEntry(movedKey)
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
        focusEntry(target)
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
    onSession: (active) => {
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

  function railBinding(node: HTMLDivElement) {
    binding = bindRail(node, machine)
    resizeObserver?.observe(node)
    return {
      destroy() {
        resizeObserver?.unobserve(node)
        binding?.destroy()
        binding = null
      },
    }
  }

  onDestroy(() => {
    machine.destroy()
    removeGhost()
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
  style="touch-action: pan-y; -webkit-touch-callout: none;"
  data-rail-scroll
>
  {@render gapEl({ in: 'top', after: null }, 'top', undefined, '')}
  {#each charImages as char (char.key)}
    {@const isOpen = char.type === 'folder' && openFolders.includes(char.id)}
    <div class="group relative flex items-center px-2{rowEffects(char.key)}"
      role="listitem"
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
          use:nearViewport={{ onChange: (v, node) => {
            if (v) { visibleRows.set(char.key, node) } else if (visibleRows.get(char.key) === node) { visibleRows.delete(char.key) }
          } }}
          oncontextmenu={char.type === 'folder' ? (e) => folderMenu(e, char.id, char.name) : undefined}
        >
        {#if char.type === 'normal'}
          {@const imgPath = char.img}
          {@const isVisible = visibleRows.has(char.key)}
          {@const avatarSrc = isVisible ? (imgPath ? getCharImage(imgPath, "thumb") : "/none.webp") : undefined}
          <SidebarAvatar
            src={avatarSrc as string | Promise<string>}
            size="56"
            rounded={IconRounded}
            chaId={DBState.db.characters[char.index]?.chaId}
          />
        {:else if char.type === "folder"}
          {#key char.color}
          {#key char.name}
            {@const folderImgPath = char.img}
            {@const isFolderVisible = visibleRows.has(char.key)}
            {@const avatarBg = isFolderVisible ? (folderImgPath ? getCharImage(folderImgPath, "thumb") : "") : ""}
            <SidebarAvatar src="slot" size="56" rounded={IconRounded} bordered color={char.color} backgroundimg={avatarBg}>
              {#if DBState.db.showFolderName}
                <div class="h-full w-full flex justify-center items-center">
                  <span class="hyphens-auto truncate font-bold">{char.name}</span>
                </div>
              {:else if openFolders.includes(char.id)}
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
    {#if char.type === 'folder' && isOpen}
      {@const headKey = folderHeadKey(char.key)}
      {@const background = folderBackground(layout, char.key)}
      <div class="h-2 min-h-2 w-14" aria-hidden="true" use:measure={headKey} {...itemAttrs(headKey, 'folderHead', undefined, char.key)}></div>
      {#if background}
        {#key char.color}
        <div class="absolute inset-x-0 flex justify-center pointer-events-none z-0" aria-hidden="true"
          style:top="{background.top}px" style:height="{background.height}px" data-rail-folder-bg={char.key}>
          <div class="relative left-1 h-full w-16 border border-selected rounded-lg {
            char.color === 'red' ? 'bg-red-700/20' :
            char.color === 'yellow' ? 'bg-yellow-700/20' :
            char.color === 'green' ? 'bg-green-700/20' :
            char.color === 'blue' ? 'bg-blue-700/20' :
            char.color === 'indigo' ? 'bg-indigo-700/20' :
            char.color === 'purple' ? 'bg-purple-700/20' :
            char.color === 'pink' ? 'bg-pink-700/20' :
            'bg-darkbg/20'
          }"></div>
        </div>
        {/key}
      {/if}
      {@render gapEl({ in: 'folder', folder: char.ref, after: null }, 'folder', char.key, 'relative z-10')}
      {#each char.folder as char2 (char2.key)}
        {@const memberImgPath = char2.img}
        {@const isMemberVisible = visibleRows.has(char2.key)}
        {@const avatarSrc2 = isMemberVisible ? (memberImgPath ? getCharImage(memberImgPath, "thumb") : "/none.webp") : undefined}
        <div class="group relative flex items-center px-2 z-10{rowEffects(char2.key)}"
          role="listitem"
          use:measure={char2.key}
          {...itemAttrs(char2.key, 'member', undefined, char.key)}
        >
          <SidebarIndicator
            isActive={$selectedCharID === char2.index && sideBarMode !== 1}
          />
          <div
              role="button" tabindex={tabKey === char2.key ? 0 : -1}
              data-rail-entry={char2.key}
              aria-label={char2.name}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              class="outline-none focus-visible:ring-2 focus-visible:ring-textcolor2 {IconRounded ? 'rounded-full' : 'rounded-md'}"
              use:tooltipRail={char2.name}
              use:nearViewport={{ onChange: (v, node) => {
                if (v) { visibleRows.set(char2.key, node) } else if (visibleRows.get(char2.key) === node) { visibleRows.delete(char2.key) }
              } }}
            >
            <SidebarAvatar
              src={avatarSrc2 as string | Promise<string>}
              size="56"
              rounded={IconRounded}
              chaId={DBState.db.characters[char2.index]?.chaId}
            />
          </div>
        </div>
        {@render gapEl({ in: 'folder', folder: char.ref, after: char2.ref }, 'folder', char.key, 'relative z-20')}
      {/each}
      {@const tailKey = folderTailKey(char.key)}
      <div class="h-1 min-h-1 w-14" aria-hidden="true" use:measure={tailKey} {...itemAttrs(tailKey, 'folderTail', undefined, char.key)}></div>
    {/if}
    {@render gapEl({ in: 'top', after: char.ref }, 'top', undefined, '')}
  {/each}
  <div class="flex flex-col items-center gap-2 px-2" role="listitem" use:measure={PLUS_KEY} {...itemAttrs(PLUS_KEY, 'plus')}>
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
