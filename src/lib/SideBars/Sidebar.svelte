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
    import {
    ShellIcon,
    Settings,
    ListIcon,
    LayoutGridIcon,
    HomeIcon,
    WrenchIcon,
    User2Icon,
    XIcon,
  } from "@lucide/svelte";
    import CharConfig from "./CharConfig.svelte";
    import { language } from "../../lang";
    import SidebarRail from "./SidebarRail.svelte";
  import { sideBarSize } from "src/ts/gui/guisize";
  import DevTool from "./DevTool.svelte";
    import SideChatList from "./SideChatList.svelte";
    import QuickSettingsGui from "../Others/QuickSettingsGUI.svelte";
    import PluginDefinedIcon from "../Others/PluginDefinedIcon.svelte";
    import { panelFollowView, panelGestureAttachment } from "./panelGestureBinding";
    import { followPanelWidth, WIDE_LAYOUT_MIN_PX } from "./panelGesture";
    import { shellEligible } from "../../ts/chatShell/shellSwitch.svelte";
    import { takeOverlayReturnFocus } from "../../ts/chatShell/overlayFocus";
    import { hasOpenShell } from "../Nexus/pattern/patternFocus";
    import ShellSidebar from "../ChatShell/sidebar/ShellSidebar.svelte";
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

  interface Props {
    openGrid?: any;
    hidden?: boolean;
  }

  let { openGrid = () => {}, hidden = false }: Props = $props();

  sideBarClosing.set(false)

  // Shell mode: the new chat shell is the active surface, so the panel holds the shell sidebar and
  // there is no rail. Its overlay layouts (the window flag) are modal; the docked layout is not.
  // With the shell not eligible none of this applies and the sidebar is the old one.
  const WIDE_OVERLAY_PX = 360;
  const DOCKED_PX = 280;
  // Follow-the-finger overlay: only in the narrow overlay layout while the new chat shell is the
  // active surface. Everywhere else the panel keeps its width keyframes and the old behaviour.
  const FOLLOW_EASE = 'cubic-bezier(0.2, 0, 0, 1)';
  let viewportWidth = $state(window.innerWidth);
  let panelEl: HTMLDivElement | undefined = $state();
  const shellMode = $derived(shellEligible());
  const shellOverlay = $derived(shellMode && $DynamicGUI);
  const shellDocked = $derived(shellMode && !$DynamicGUI);
  const followMode = $derived(shellOverlay && viewportWidth < WIDE_LAYOUT_MIN_PX);
  const overlayModal = $derived(shellOverlay && $sideBarStore && !hidden);

  // A resize that mounts this overlay while a sheet or panel is open must not open the sidebar
  // over it: a second modal would take focus from the sheet and inert its host. It mounts closed.
  // The layout at mount is exactly what decides this, so the one-time read is intended.
  // svelte-ignore state_referenced_locally
  if (shellOverlay && $sideBarStore && hasOpenShell()) {
    sideBarStore.set(false);
  }
  const followDriven = $derived(followMode && $panelFollowView.phase !== 'idle');
  const followEnter = $derived(followMode && !$sideBarClosing && !followDriven && !$panelFollowView.entered);
  const followExit = $derived(followMode && $sideBarClosing && !followDriven);
  const followWidth = $derived(followPanelWidth(viewportWidth));

  function followTransform(): string {
    const sign = document.documentElement.dir === 'rtl' ? 1 : -1;
    return `transform: translateX(${sign * (1 - $panelFollowView.progress) * followWidth}px);`;
  }

  function followTransition(): string {
    return $panelFollowView.phase === 'settling'
      ? `transition: transform ${$panelFollowView.durationMs}ms ${FOLLOW_EASE};`
      : 'transition: none;';
  }

  const railStyle = $derived(followDriven ? `${followTransform()} ${followTransition()} animation: none;` : undefined);
  const panelStyle = $derived(
    followMode
      ? `width: ${followWidth}px; min-width: 0;` +
          (followDriven ? ` ${followTransform()} ${followTransition()} animation: none;` : '')
      : shellOverlay
        ? `--sidebar-size: ${WIDE_OVERLAY_PX}px; width: ${WIDE_OVERLAY_PX}px; min-width: 0;`
        : shellDocked
          ? `--sidebar-size: ${DOCKED_PX}px; width: ${DOCKED_PX}px; min-width: ${DOCKED_PX}px;`
          : undefined,
  );
  const backdropStyle = $derived(
    followMode
      ? followDriven
        ? `background-color: rgb(0 0 0); opacity: ${0.5 * $panelFollowView.progress}; ${
            $panelFollowView.phase === 'settling'
              ? `transition: opacity ${$panelFollowView.durationMs}ms ${FOLLOW_EASE};`
              : 'transition: none;'
          } animation: none;`
        : 'background-color: rgb(0 0 0); opacity: 0.5;'
      : undefined,
  );

  function closeFollowPanel() {
    if ($sideBarClosing || $panelFollowView.phase !== 'idle') {
      return;
    }
    $sideBarClosing = true;
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (overlayModal && e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      closeFollowPanel();
    }
  }

  function onWindowMouseup(e: MouseEvent) {
    // The mouse's back button (button 3) closes the modal panel like Esc.
    if (overlayModal && e.button === 3) {
      e.preventDefault();
      closeFollowPanel();
    }
  }

  // While the panel is a modal overlay the rest of the page is inert, focus moves into the
  // panel, and it returns when the modal ends: to the element a keyboard switch named, else the opener.
  $effect(() => {
    if (!overlayModal || !panelEl) {
      return;
    }
    // A name left from an earlier overlay does not apply to this one.
    takeOverlayReturnFocus();
    const panel = panelEl;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const container = panel.parentElement;
    const inerted: Element[] = [];
    for (const sibling of Array.from(container?.parentElement?.children ?? [])) {
      if (sibling !== container && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        inerted.push(sibling);
      }
    }
    panel.focus();
    return () => {
      for (const element of inerted) {
        element.removeAttribute('inert');
      }
      const named = takeOverlayReturnFocus()?.() ?? null;
      if (named?.isConnected && !named.closest('[inert]')) {
        named.focus();
        if (document.activeElement === named) {
          return;
        }
      }
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  });
</script>
<svelte:window bind:innerWidth={viewportWidth} onkeydown={onWindowKeydown} onmouseup={onWindowMouseup} />
{#if shellMode}
<!-- No rail in shell mode: the panel below holds the shell sidebar. -->
{:else if DBState.db.menuSideBar}
<div
  data-rail-root
  class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
  class:editMode
  class:risu-sub-sidebar={$sideBarClosing && !followMode}
  class:risu-sub-sidebar-close={$sideBarClosing && !followMode}
  class:follow-in={followEnter}
  class:follow-out={followExit}
  style={railStyle}
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
  data-rail-root
  class="h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar"
  class:editMode
  class:risu-sub-sidebar={$sideBarClosing && !followMode}
  class:risu-sub-sidebar-close={$sideBarClosing && !followMode}
  class:follow-in={followEnter}
  class:follow-out={followExit}
  style={railStyle}
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
  <SidebarRail {reseter} {sideBarMode} />
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
<!-- tabindex is -1 only while the panel is a modal dialog, so focus can move into it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  data-panel-surface
  bind:this={panelEl}
  role={overlayModal ? 'dialog' : undefined}
  aria-label={overlayModal ? language.chatShellSidebar : undefined}
  tabindex={overlayModal ? -1 : undefined}
  style={panelStyle}
  class="setting-area h-full flex-col overflow-y-auto overflow-x-hidden bg-darkbg py-6 text-textcolor max-h-full"
  class:follow-in={followEnter}
  class:follow-out={followExit}
  class:risu-sidebar={!$sideBarClosing && !followMode}
  class:w-96={!shellMode && $sideBarSize === 0}
  class:w-110={!shellMode && $sideBarSize === 1}
  class:w-124={!shellMode && $sideBarSize === 2}
  class:w-138={!shellMode && $sideBarSize === 3}
  class:risu-sidebar-close={$sideBarClosing && !followMode}
  class:min-w-96={!shellMode && !$DynamicGUI && $sideBarSize === 0}
  class:min-w-110={!shellMode && !$DynamicGUI && $sideBarSize === 1}
  class:min-w-124={!shellMode && !$DynamicGUI && $sideBarSize === 2}
  class:min-w-138={!shellMode && !$DynamicGUI && $sideBarSize === 3}
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
  {#if !shellDocked}
  <!-- Where SideBarArrow draws its close handle (wide desktop), the X is hidden but keeps its space so the layout below does not move. -->
  <button
    class="relative z-10 flex self-end text-textcolor hover:text-textcolor2"
    class:invisible={!$DynamicGUI}
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
  {/if}
  {#if shellMode}
    <ShellSidebar {openGrid} {reseter} />
  {:else if sideBarMode === 0}
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
    <div role="button" tabindex="0" data-panel-surface {@attach panelGestureAttachment} class="grow h-full min-w-12" class:hidden={hidden} onclick={() => {
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
      style={backdropStyle}
      class:sidebar-dark-animation={!$sideBarClosing && !followMode}
      class:sidebar-dark-close-animation={$sideBarClosing && !followMode}
      class:follow-dark-in={followEnter}
      class:follow-dark-out={followExit}>

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
      background-color: rgba(0,0,0,0);
    }
    to {
      background-color: rgba(0,0,0,0.5);
    }
  }
  @keyframes sidebar-dark-closing-animation{
    from {
      background-color: rgba(0,0,0,0.5);
    }
    to {
      background-color: rgba(0,0,0,0);
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
    animation-name: sidebar-dark-animation;
    animation-duration: var(--risu-animation-speed);
    background-color: rgba(0,0,0,0.5)
  }
  .sidebar-dark-close-animation{
    animation-name: sidebar-dark-closing-animation;
    animation-duration: var(--risu-animation-speed);
    background-color: rgba(0,0,0,0)
  }

  /* Follow mode: transform and opacity only, no width keyframes. */
  @keyframes follow-slide-in {
    from { transform: translateX(calc(-1 * min(85vw, 360px))); }
    to { transform: translateX(0); }
  }
  @keyframes follow-slide-out {
    from { transform: translateX(0); }
    to { transform: translateX(calc(-1 * min(85vw, 360px))); }
  }
  @keyframes follow-slide-in-rtl {
    from { transform: translateX(min(85vw, 360px)); }
    to { transform: translateX(0); }
  }
  @keyframes follow-slide-out-rtl {
    from { transform: translateX(0); }
    to { transform: translateX(min(85vw, 360px)); }
  }
  @keyframes follow-dark-in {
    from { opacity: 0; }
    to { opacity: 0.5; }
  }
  @keyframes follow-dark-out {
    from { opacity: 0.5; }
    to { opacity: 0; }
  }
  .follow-in {
    animation: follow-slide-in var(--chat-dur-base, 200ms) var(--chat-ease-out, cubic-bezier(0.2, 0, 0, 1)) backwards;
  }
  .follow-out {
    animation: follow-slide-out var(--chat-dur-base, 200ms) var(--chat-ease-out, cubic-bezier(0.2, 0, 0, 1)) both;
  }
  :global([dir='rtl']) .follow-in {
    animation-name: follow-slide-in-rtl;
  }
  :global([dir='rtl']) .follow-out {
    animation-name: follow-slide-out-rtl;
  }
  .follow-dark-in {
    animation: follow-dark-in var(--chat-dur-base, 200ms) var(--chat-ease-out, cubic-bezier(0.2, 0, 0, 1)) backwards;
  }
  .follow-dark-out {
    animation: follow-dark-out var(--chat-dur-base, 200ms) var(--chat-ease-out, cubic-bezier(0.2, 0, 0, 1)) both;
  }
  @media (prefers-reduced-motion: reduce) {
    .follow-in, .follow-out, .follow-dark-in, .follow-dark-out {
      animation-duration: 120ms;
    }
  }
</style>
