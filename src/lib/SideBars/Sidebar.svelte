<script lang="ts">
    import {
    CharEmotion,
    DynamicGUI,
    botMakerMode,
    selectedCharID,
    settingsOpen,
    sideBarClosing,
    sideBarStore,
    OpenRealmStore,
    PlaygroundStore,

    QuickSettings,

    additionalHamburgerMenu


  } from "../../ts/stores.svelte";
    import { setDatabase } from "../../ts/storage/database.svelte";
    import { DBState } from 'src/ts/stores.svelte';
    import BarIcon from "./BarIcon.svelte";
    import SidebarIndicator from "./SidebarIndicator.svelte";
    import {
    ShellIcon,
    Settings,
    ListIcon,
    LayoutGridIcon,
    FolderIcon,
    FolderOpenIcon,
    HomeIcon,
    WrenchIcon,
    User2Icon,
    XIcon,
  } from "@lucide/svelte";
    import {
  addCharacter,
    changeChar,
    getCharImage,
  } from "../../ts/characters";
    import CharConfig from "./CharConfig.svelte";
    import { language } from "../../lang";
    import isEqual from "lodash/isEqual";
    import SidebarAvatar from "./SidebarAvatar.svelte";
    import BaseRoundedButton from "../UI/BaseRoundedButton.svelte";
    import { getCharacterIndexObject, selectSingleFile } from "src/ts/util";
    import { v4 } from "uuid";
    import { checkCharOrder, saveAsset } from "src/ts/globalApi.svelte";
    import { applyFolderImage } from "./folderImage";
    import { beginBusy } from "src/ts/process/memory/busyActions";
    import { alertInput, alertSelect } from "src/ts/alert";
  import { getFolderColorLabels, getFolderColorValue } from "./folderColors";
    import SideChatList from "./SideChatList.svelte";
  import { sideBarSize } from "src/ts/gui/guisize";
  import DevTool from "./DevTool.svelte";
    import QuickSettingsGui from "../Others/QuickSettingsGUI.svelte";
    import PluginDefinedIcon from "../Others/PluginDefinedIcon.svelte";
    import { RISU_SIDEBAR_DRAG_TYPE } from "src/ts/dragTypes";
    import { nearViewport } from "src/ts/gui/nearViewport.svelte";
    import { SvelteMap } from "svelte/reactivity";
    import type { folder } from "src/ts/storage/database.svelte";
    import {
      editFolder,
      dropOnItem,
      listRows,
      moveToGap,
      type CharRef,
      type FolderRef,
      type Gap,
      type ItemRef,
      type MemberRef,
    } from "./sidebarOrder";
  let sideBarMode = $state(0);
  let editMode = $state(false);
  let menuMode = $state(0);
  let devTool = $state(false)

  function reseter() {
    menuMode = 0;
    sideBarMode = 0;
    editMode = false;
    settingsOpen.set(false);
    CharEmotion.set({});
  }

  type sortTypeNormal = { type:'normal', key:string, img: string, index: number, name:string }
  type sortTopNormal = sortTypeNormal & { ref: CharRef }
  type sortMember = sortTypeNormal & { ref: MemberRef }
  type sortFolder = {type:'folder', key:string, ref:FolderRef, folder:sortMember[], id:string, name:string, color:string, img?:string}
  type sortType = sortTopNormal | sortFolder
  let charImages: sortType[] = $state([]);
  let IconRounded = $state(false)
  let openFolders:string[] = $state([])
  let currentDrag: ItemRef | null = $state(null)
  // Row keys (unique per row, see `refKey`) of the rows near the sidebar's own
  // scroll viewport, each mapped to its owning element. A row keeps its key
  // when it moves, so its avatar state moves with it. `nearViewport`'s destroy
  // calls `onChange(false, node)` on every unmount, including a folder
  // member's when its folder closes; mapping to the owning element means that
  // release only clears a key if `node` still owns it, so an unmount can never
  // clear a different, still-visible row that was given the same key.
  let visibleRows = new SvelteMap<string, Element>()
  interface Props {
    openGrid?: any;
    hidden?: boolean;
  }

  let { openGrid = () => {}, hidden = false }: Props = $props();

  sideBarClosing.set(false)

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


  type DragEv = DragEvent & {
    currentTarget: EventTarget & HTMLDivElement;
  }

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

  const avatarDragStart = (ind:ItemRef, e:DragEv) => {
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.setData(RISU_SIDEBAR_DRAG_TYPE, 'true');
    currentDrag = ind
    const avatar = e.currentTarget.querySelector('.avatar')
    if(avatar){
      e.dataTransfer.setDragImage(avatar, 10, 10);
    }
  }

  const clearCurrentDrag = () => {
    currentDrag = null
  }

  $effect(() => {
    if (typeof window === 'undefined') return

    window.addEventListener('dragend', clearCurrentDrag)
    window.addEventListener('drop', clearCurrentDrag)
    window.addEventListener('blur', clearCurrentDrag)

    return () => {
      window.removeEventListener('dragend', clearCurrentDrag)
      window.removeEventListener('drop', clearCurrentDrag)
      window.removeEventListener('blur', clearCurrentDrag)
    }
  })

  const getCurrentSidebarDrag = (e:DragEvent) => {
    if(!currentDrag || !e.dataTransfer?.types.includes(RISU_SIDEBAR_DRAG_TYPE)){
      return null
    }
    return currentDrag
  }

  const avatarDragOver = (e:DragEv) => {
    if(!getCurrentSidebarDrag(e)){
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
  }

  const avatarDrop = (ind:ItemRef, e:DragEv) => {
    const drag = getCurrentSidebarDrag(e)
    if(!drag){
      return
    }
    e.preventDefault()
    e.stopPropagation()
    try {
      dropDragOn(drag,ind)
    } catch (error) {
      console.error('avatarDrop error:', error)
    } finally {
      clearCurrentDrag()
    }
  }

  const preventAll = (e:DragEvent) => {
    if(!getCurrentSidebarDrag(e)){
      return
    }
    e.preventDefault()
    e.stopPropagation()
    return false
  }
</script>
{#if DBState.db.menuSideBar}
<div
  class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
  class:editMode
  class:risu-sub-sidebar={$sideBarClosing}
  class:risu-sub-sidebar-close={$sideBarClosing}
  class:hidden={hidden}
  class:flex={!hidden}
>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full mt-4"
  class:text-textcolor2={!(
    $selectedCharID < 0 &&
    $PlaygroundStore === 0 &&
    !$settingsOpen
  )}
  onclick={() => {
    reseter();
    selectedCharID.set(-1)
    PlaygroundStore.set(0)
    OpenRealmStore.set(false)
  }}
>
  <HomeIcon />
  <span class="text-xs">{language.home}</span>
</button>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full"
  class:text-textcolor2={!$settingsOpen}
  onclick={() => {
    if ($settingsOpen) {
      reseter();
      settingsOpen.set(false);
    } else {
      reseter();
      settingsOpen.set(true);
    }
  }}
>
  <Settings />
  <span class="text-xs">{language.settings}</span>
</button>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full"
  class:text-textcolor2={!(
    $selectedCharID >= 0
  )}
  onclick={() => {
    reseter();
    openGrid();

  }}
>
  <User2Icon />
  <span class="text-xs">{language.character}</span>
</button>
<button
  class="flex items-center justify-center py-2 flex-col gap-1 w-full"
  class:text-textcolor2={!(
    $selectedCharID < 0 &&
    $PlaygroundStore !== 0
  )}
  onclick={() => {
    reseter();
    selectedCharID.set(-1)
    PlaygroundStore.set(1)
  }}
>
  <ShellIcon />
  <span class="text-xs">{language.playground.playground}</span>
</button>
</div>
{:else}
<div
  class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
  class:editMode
  class:risu-sub-sidebar={$sideBarClosing}
  class:risu-sub-sidebar-close={$sideBarClosing}
  class:hidden={hidden}
  class:flex={!hidden}
>
  {#if !DBState.db.hamburgerButtonBottom}
  <button
    class="flex h-8 min-h-8 w-14 min-w-14 cursor-pointer text-white mt-2 items-center justify-center rounded-md bg-textcolor2 transition-colors hover:bg-blue-500"
    onclick={() => {
      menuMode = 1 - menuMode;
    }}><ListIcon />
  </button>
  <div class="mt-2 border-b border-b-selected w-full relative text-white ">
    {#if menuMode === 1}
      <div class="absolute w-20 min-w-20 flex border-b-selected border-b bg-bgcolor flex-col items-center pt-2 rounded-b-md z-20 pb-2">
        <BarIcon
        onClick={() => {
          if ($settingsOpen) {
            reseter();
            settingsOpen.set(false);
          } else {
            reseter();
            settingsOpen.set(true);
          }
        }}><Settings /></BarIcon
      >
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          selectedCharID.set(-1)
          PlaygroundStore.set(0)
          OpenRealmStore.set(false)
        }}><HomeIcon /></BarIcon>
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter()
          if($selectedCharID === -1 && $PlaygroundStore !== 0){
            PlaygroundStore.set(0)
            return
          }
          selectedCharID.set(-1)
          PlaygroundStore.set(1)
        }}
      ><ShellIcon /></BarIcon>
      {#each additionalHamburgerMenu as menu}
        <div class="mt-2"></div>
        <BarIcon
          onClick={() => {
            reseter();
            menu.callback();
          }}>
            <PluginDefinedIcon ico={menu} />
          </BarIcon
        >
      {/each}
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          openGrid();
        }}><LayoutGridIcon /></BarIcon
      >
    </div>
    {/if}
  </div>
  {/if}
  <div class="flex grow w-full flex-col items-center overflow-x-hidden overflow-y-auto pr-0">
    <div class="h-4 min-h-4 w-14" role="listitem" ondragover={(e) => {
      if(!getCurrentSidebarDrag(e)){ return }
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      e.currentTarget.classList.add('bg-green-500')
    }} ondragleave={(e) => {
      e.currentTarget.classList.remove('bg-green-500')
    }} ondrop={(e) => {
      const drag = getCurrentSidebarDrag(e)
      if(!drag){ return }
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.classList.remove('bg-green-500')
      try {
        moveDragTo(drag,{in:'top', after:null})
      } finally {
        clearCurrentDrag()
      }
    }} ondragenter={preventAll}></div>
    {#each charImages as char (char.key)}
      <div class="group relative flex items-center px-2"
        role="listitem"
        draggable="true"
        ondragstart={(e) => {avatarDragStart(char.ref, e)}}
        ondragend={clearCurrentDrag}
        ondragover={avatarDragOver}
        ondrop={(e) => {avatarDrop(char.ref, e)}}
        ondragenter={preventAll}
      >
        <SidebarIndicator
          isActive={char.type === 'normal' && $selectedCharID === char.index && sideBarMode !== 1}
        />
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div
            role="button" tabindex="0"
            use:nearViewport={{ onChange: (v, node) => {
              if (v) { visibleRows.set(char.key, node) } else if (visibleRows.get(char.key) === node) { visibleRows.delete(char.key) }
            } }}
            onclick={() => {
              if(char.type === "normal"){
                changeChar(char.index, {reseter});
              }
            }}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                if(char.type === "normal"){
                  changeChar(char.index, {reseter});
                }
              }
            }}
          >
          {#if char.type === 'normal'}
            {@const imgPath = char.img}
            {@const isVisible = visibleRows.has(char.key)}
            {@const avatarSrc = isVisible ? (imgPath ? getCharImage(imgPath, "thumb") : "/none.webp") : undefined}
            <SidebarAvatar
              src={avatarSrc as string | Promise<string>}
              size="56"
              rounded={IconRounded}
              name={char.name}
              chaId={DBState.db.characters[char.index]?.chaId}
            />
          {:else if char.type === "folder"}
            {#key char.color}
            {#key char.name}
              {@const folderImgPath = char.img}
              {@const isFolderVisible = visibleRows.has(char.key)}
              {@const avatarBg = isFolderVisible ? (folderImgPath ? getCharImage(folderImgPath, "thumb") : "") : ""}
              <SidebarAvatar src="slot" size="56" rounded={IconRounded} bordered name={char.name} color={char.color} backgroundimg={avatarBg}
              oncontextmenu={async (e) => {
                e.preventDefault()
                const folderId = char.id
                const sel = parseInt(await alertSelect([language.renameFolder,language.changeFolderColor,language.changeFolderImage,language.cancel]))
                if(sel === 0){
                  const v = await alertInput(language.changeFolderName, [], char.name)
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
              }}
              onClick={() => {
                if(char.type !== 'folder'){
                  return
                }
                if(openFolders.includes(char.id)){
                  openFolders.splice(openFolders.indexOf(char.id), 1)
                }
                else{
                  openFolders.push(char.id)
                }
              }}>
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
      {#if char.type === 'folder' && openFolders.includes(char.id)}
        {#key char.color}
        <div class="p-1 flex flex-col items-center py-1 mt-1 rounded-lg relative">
          <div class="absolute top-0 left-1 border border-selected w-full h-full rounded-lg z-0 {
            char.color === 'red' ? 'bg-red-700/20' :
            char.color === 'yellow' ? 'bg-yellow-700/20' :
            char.color === 'green' ? 'bg-green-700/20' :
            char.color === 'blue' ? 'bg-blue-700/20' :
            char.color === 'indigo' ? 'bg-indigo-700/20' :
            char.color === 'purple' ? 'bg-purple-700/20' :
            char.color === 'pink' ? 'bg-pink-700/20' :
            'bg-darkbg/20'
          }"></div>
          <div class="h-4 min-h-4 w-14 relative z-10" role="listitem" ondragover={(e) => {
            if(!getCurrentSidebarDrag(e)){ return }
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            e.currentTarget.classList.add('bg-green-500')
          }} ondragleave={(e) => {
            e.currentTarget.classList.remove('bg-green-500')
          }} ondrop={(e) => {
            const drag = getCurrentSidebarDrag(e)
            if(!drag){ return }
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.classList.remove('bg-green-500')
            try {
              if(char.type === 'folder'){
                moveDragTo(drag,{in:'folder', folder:char.ref, after:null})
              }
            } finally {
              clearCurrentDrag()
            }
          }} ondragenter={preventAll}></div>
          {#each char.folder as char2 (char2.key)}
              {@const memberImgPath = char2.img}
              {@const isMemberVisible = visibleRows.has(char2.key)}
              {@const avatarSrc2 = isMemberVisible ? (memberImgPath ? getCharImage(memberImgPath, "thumb") : "/none.webp") : undefined}
              <div class="group relative flex items-center px-2 z-10"
              role="listitem"
              draggable="true"
              ondragstart={(e) => {avatarDragStart(char2.ref, e)}}
              ondragend={clearCurrentDrag}
              ondragover={avatarDragOver}
              ondrop={(e) => {avatarDrop(char2.ref, e)}}
              ondragenter={preventAll}
            >
              <SidebarIndicator
                isActive={$selectedCharID === char2.index && sideBarMode !== 1}
              />
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div
                  role="button" tabindex="0"
                  use:nearViewport={{ onChange: (v, node) => {
                    if (v) { visibleRows.set(char2.key, node) } else if (visibleRows.get(char2.key) === node) { visibleRows.delete(char2.key) }
                  } }}
                  onclick={() => {
                    if(char2.type === "normal"){
                      changeChar(char2.index, {reseter});
                    }
                  }}
                  onkeydown={(e) => {
                    if (e.key === "Enter") {
                      if(char2.type === "normal"){
                        changeChar(char2.index, {reseter});
                      }
                    }
                  }}
                >
                <SidebarAvatar
                  src={avatarSrc2 as string | Promise<string>}
                  size="56"
                  rounded={IconRounded}
                  name={char2.name}
                  chaId={DBState.db.characters[char2.index]?.chaId}
                />
              </div>
            </div>
            <div class="h-4 min-h-4 w-14 relative z-20" role="listitem" ondragover={(e) => {
              if(!getCurrentSidebarDrag(e)){ return }
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              e.currentTarget.classList.add('bg-green-500')
            }} ondragleave={(e) => {
              e.currentTarget.classList.remove('bg-green-500')
            }} ondrop={(e) => {
              const drag = getCurrentSidebarDrag(e)
              if(!drag){ return }
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.classList.remove('bg-green-500')
              try {
                if(char.type === 'folder'){
                  moveDragTo(drag,{in:'folder', folder:char.ref, after:char2.ref})
                }
              } finally {
                clearCurrentDrag()
              }
            }} ondragenter={preventAll}></div>
          {/each}
        </div>
        {/key}
      {/if}
      <div class="h-4 min-h-4 w-14" role="listitem" ondragover={((e) => {
        if(!getCurrentSidebarDrag(e)){ return }
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        e.currentTarget.classList.add('bg-green-500')
      })} ondragleave={(e) => {
        e.currentTarget.classList.remove('bg-green-500')
      }} ondrop={(e) => {
        const drag = getCurrentSidebarDrag(e)
        if(!drag){ return }
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.classList.remove('bg-green-500')
        try {
          moveDragTo(drag,{in:'top', after:char.ref})
        } finally {
          clearCurrentDrag()
        }
      }} ondragenter={preventAll}></div>
    {/each}
    <div class="flex flex-col items-center gap-2 px-2">
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
  </div>
  {#if DBState.db.hamburgerButtonBottom}
  <div class="border-t border-t-selected w-full relative text-white ">
    {#if menuMode === 1}
      <div class="absolute bottom-full w-20 min-w-20 flex border-t-selected border-t bg-bgcolor flex-col items-center pt-2 rounded-t-md z-20 pb-2">
        <BarIcon
        onClick={() => {
          if ($settingsOpen) {
            reseter();
            settingsOpen.set(false);
          } else {
            reseter();
            settingsOpen.set(true);
          }
        }}><Settings /></BarIcon
      >
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          selectedCharID.set(-1)
          PlaygroundStore.set(0)
          OpenRealmStore.set(false)
        }}><HomeIcon /></BarIcon>
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter()
          if($selectedCharID === -1 && $PlaygroundStore !== 0){
            PlaygroundStore.set(0)
            return
          }
          selectedCharID.set(-1)
          PlaygroundStore.set(1)
        }}
      ><ShellIcon /></BarIcon>
      {#each additionalHamburgerMenu as menu}
        <div class="mt-2"></div>
        <BarIcon
          onClick={() => {
            reseter();
            menu.callback();
          }}>
            <PluginDefinedIcon ico={menu} />
          </BarIcon
        >
      {/each}
      <div class="mt-2"></div>
      <BarIcon
        onClick={() => {
          reseter();
          openGrid();
        }}><LayoutGridIcon /></BarIcon
      >
    </div>
    {/if}
  </div>
  <button
    class="flex h-8 min-h-8 w-14 min-w-14 cursor-pointer text-white mb-2 mt-2 items-center justify-center rounded-md bg-textcolor2 transition-colors hover:bg-blue-500"
    onclick={() => {
      menuMode = 1 - menuMode;
    }}><ListIcon />
  </button>
  {/if}
</div>
{/if}
<div
  class="setting-area h-full flex-col overflow-y-auto overflow-x-hidden bg-darkbg py-6 text-textcolor max-h-full"
  class:risu-sidebar={!$sideBarClosing}
  class:w-96={$sideBarSize === 0}
  class:w-110={$sideBarSize === 1}
  class:w-124={$sideBarSize === 2}
  class:w-138={$sideBarSize === 3}
  class:risu-sidebar-close={$sideBarClosing}
  class:min-w-96={!$DynamicGUI && $sideBarSize === 0}
  class:min-w-110={!$DynamicGUI && $sideBarSize === 1}
  class:min-w-124={!$DynamicGUI && $sideBarSize === 2}
  class:min-w-138={!$DynamicGUI && $sideBarSize === 3}
  class:px-2={$DynamicGUI}
  class:px-4={!$DynamicGUI}
  class:dynamic-sidebar={$DynamicGUI}
  class:hidden={hidden}
  class:flex={!hidden}
  onanimationend={() => {
    if($sideBarClosing){
      $sideBarClosing = false
      sideBarStore.set(false)
    }
  }}
>
  <button
    class="flex w-full justify-end text-textcolor hover:text-textcolor2"
    aria-label={language.closeSidebar}
    title={language.closeSidebar}
    onclick={async () => {
      if($sideBarClosing){
        return
      }
      $sideBarClosing = true;
    }}
  >
    <XIcon size={18} />
  </button>
  {#if sideBarMode === 0}
    {#if $selectedCharID < 0 || $settingsOpen}
      <div>
        <h1 class="text-xl">{language.sidebarWelcome}</h1>
        <span class="text-xs text-textcolor2">{language.sidebarWelcomeHint}</span>
      </div>
    {:else if DBState.db.characters[$selectedCharID]?.chaId === '§playground'}
      <SideChatList bind:chara={ DBState.db.characters[$selectedCharID]} />
    {:else}
      <div class="w-full h-8 min-h-8 border-l border-b border-r border-selected relative bottom-6 rounded-b-md flex">
        <button onclick={() => {
          devTool = false
          botMakerMode.set(false)
        }} class="grow border-r border-r-selected rounded-bl-md" class:text-textcolor2={$botMakerMode || devTool}>{language.Chat}</button>
        <button onclick={() => {
          devTool = false
          botMakerMode.set(true)
        }} class="grow rounded-br-md" class:text-textcolor2={!$botMakerMode || devTool}>{language.character}</button>
        {#if DBState.db.enableDevTools}
          <button onclick={() => {
            devTool = true
          }} class="border-l border-l-selected rounded-br-md px-1" class:text-textcolor2={!devTool}>
            <WrenchIcon size={18} />
          </button>
        {/if}
      </div>
      {#if QuickSettings.open}
        <QuickSettingsGui />
      {:else if devTool}
        <DevTool />
      {:else if $botMakerMode}
        <CharConfig />
      {:else}
        <SideChatList bind:chara={ DBState.db.characters[$selectedCharID]} />
      {/if}
    {/if}
  {/if}
</div>

{#if $DynamicGUI}
    <div role="button" tabindex="0" class="grow h-full min-w-12" class:hidden={hidden} onclick={() => {
      if($sideBarClosing){
        return
      }
      $sideBarClosing = true;
    }}
      onkeydown={(e)=>{
        if(e.key === 'Enter'){
            e.currentTarget.click()
        }
      }}
      class:sidebar-dark-animation={!$sideBarClosing}
      class:sidebar-dark-close-animation={$sideBarClosing}>

    </div>

{/if}

<style>
  .editMode {
    min-width: 6rem;
  }
  @keyframes sidebar-transition {
    from {
      width: 0rem;
    }
    to {
      width: var(--sidebar-size);
    }
  }
  @keyframes sidebar-transition-close {
    from {
      width: var(--sidebar-size);
      right:0rem;
    }
    to {
      width: 0rem;
      right: 10rem;
    }
  }
  @keyframes sidebar-transition-non-dynamic {
    from {
      width: 0rem;
      min-width: 0rem;
    }
    to {
      width: var(--sidebar-size);
      min-width: var(--sidebar-size);
    }
  }
  @keyframes sidebar-transition-close-non-dynamic {
    from {
      width: var(--sidebar-size);
      min-width: var(--sidebar-size);
      right:0rem;
    }
    to {
      width: 0rem;
      min-width: 0rem;
      right:3rem;
    }
  }
  @keyframes sub-sidebar-transition {
    from {
      width: 0rem;
      min-width: 0rem;
    }
    to {
      width: 5rem;
      min-width: 5rem;
    }
  }
  @keyframes sub-sidebar-transition-close {
    from {
      width: 5rem;
      min-width: 5rem;
      max-width: 5rem;
      right:0rem;

    }
    to {
      width: 0rem;
      min-width: 0rem;
      max-width: 0rem;
      right: 10rem;
    }
  }
  @keyframes sidebar-dark-animation{
    from {
      background-color: rgba(0,0,0,0) !important;
    }
    to {
      background-color: rgba(0,0,0,0.5) !important;
    }
  }
  @keyframes sidebar-dark-closing-animation{
    from {
      background-color: rgba(0,0,0,0.5) !important;
    }
    to {
      background-color: rgba(0,0,0,0) !important;
    }
  }

  .risu-sidebar:not(.dynamic-sidebar) {
    animation-name: sidebar-transition-non-dynamic;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sidebar-close:not(.dynamic-sidebar) {
    animation-name: sidebar-transition-close-non-dynamic;
    animation-duration: var(--risu-animation-speed);
    position: relative;
  }
  .risu-sidebar.dynamic-sidebar {
    animation-name: sidebar-transition;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sidebar-close.dynamic-sidebar {
    animation-name: sidebar-transition-close;
    animation-duration: var(--risu-animation-speed);
    position: relative;
    right: 3rem;
  }


  .risu-sub-sidebar {
    animation-name: sub-sidebar-transition;
    animation-duration: var(--risu-animation-speed);
  }
  .risu-sub-sidebar-close {
    animation-name: sub-sidebar-transition-close;
    animation-duration: var(--risu-animation-speed);
    position: relative;
  }
  .sidebar-dark-animation{
    animation-name: sidebar-dark-transition;
    animation-duration: var(--risu-animation-speed);
    background-color: rgba(0,0,0,0.5)
  }
  .sidebar-dark-close-animation{
    animation-name: sidebar-dark-closing-transition;
    animation-duration: var(--risu-animation-speed);
    background-color: rgba(0,0,0,0)
  }
</style>
