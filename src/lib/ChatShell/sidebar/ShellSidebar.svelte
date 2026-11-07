<script lang="ts">
    import { onDestroy, onMount, tick, untrack } from "svelte";
    import { get } from "svelte/store";
    import { ChevronDownIcon, EllipsisIcon, HomeIcon, SettingsIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import { DBState, DynamicGUI, OpenRealmStore, PlaygroundStore, selIdState, selectedCharID, settingsOpen, sideBarClosing } from "src/ts/stores.svelte";
    import { alertConfirm } from "src/ts/alert";
    import { createNewChat, exportAllChats, exportChat, importChat, removeChatConfirmed } from "src/ts/characters";
    import type { Chat, ChatFolder, Database } from "src/ts/storage/database.svelte";
    import { openChatOf, selectedOwner } from "../../../ts/chatShell/chatOpen";
    import { recentCharacters } from "../../../ts/chatShell/recentCharacters";
    import { abandonPendingSwitch, refuseSwitchWhileWriting, switchCharacter, switchTarget } from "../../../ts/chatShell/switchTarget.svelte";
    import { readChatSort, writeChatSort, type ChatSort } from "../../../ts/chatShell/deviceSettings";
    import { resolveSwitchFocus, setOverlayReturnFocus } from "../../../ts/chatShell/overlayFocus";
    import { WIDE_LAYOUT_MIN_PX } from "../../SideBars/panelGesture";
    import { installShellSidebarKeys } from "../../../ts/chatShell/shellSidebarKeys";
    import { createFolder, deleteFolder, duplicateChat, moveChat, renameChat, renameFolder, setFolderColor, type ListEditing, type MenuTarget } from "../../../ts/chatShell/chatListEdits";
    import { isArchivedChat } from "../../../ts/chatShell/chatListModel";
    import type { PatternAnswer } from "../../Nexus/pattern/patternWarning";
    import ChatDeleteConfirm from "../ChatDeleteConfirm.svelte";
    import RecentStrip from "./RecentStrip.svelte";
    import ShellChatList from "./ShellChatList.svelte";
    import ShellRowMenu from "./ShellRowMenu.svelte";
    import SidebarMoreMenu from "./SidebarMoreMenu.svelte";

    type Entry = Database['characters'][number];

    interface Props {
        openGrid: () => void;
        // Resets the sidebar's own state before a destination replaces the page.
        reseter: () => void;
    }

    let { openGrid, reseter }: Props = $props();

    const uid = $props.id();
    let viewportWidth = $state(window.innerWidth);
    // The overlay layouts are the ones the sidebar covers the chat in (the narrow window flag).
    const layout = $derived<'follow' | 'wide' | 'docked'>(!$DynamicGUI ? 'docked' : viewportWidth < WIDE_LAYOUT_MIN_PX ? 'follow' : 'wide');

    // Derived from the selection mirror so it follows a switch the moment it is made.
    const owner = $derived(selectedOwner());
    const recent = $derived(recentCharacters(DBState.db.characters));

    let sort = $state<ChatSort>(readChatSort());

    // Alt+Up / Alt+Down belong to the new shell and live as long as its sidebar does.
    onMount(() => installShellSidebarKeys());
    let newMenuOpen = $state(false);
    let moreOpen = $state(false);
    let newMenuButton = $state<HTMLButtonElement>();
    let moreButton = $state<HTMLButtonElement>();

    function closeOverlay() {
        if (!get(DynamicGUI) || get(sideBarClosing)) {
            return;
        }
        sideBarClosing.set(true);
    }

    // What is open for editing: at most one menu, one inline name field and one delete confirm. They share ONE record of the
    // selection they were opened under; a selection change cancels all of them together (see the effect below).
    type PendingKind = "menu" | "rename" | "folderName" | "confirm";
    type DeleteRequest = { chat: Chat; busy: boolean; trigger: HTMLElement | null; resolve: (confirmed: boolean) => void };

    let content = $state<HTMLElement>();
    let menu = $state.raw<MenuTarget | null>(null);
    let renamingChat = $state.raw<Chat | null>(null);
    let renamingFolder = $state.raw<ChatFolder | null>(null);
    let deleteRequest = $state.raw<DeleteRequest | null>(null);
    // Recorded by the first element that opens while nothing is pending; a successor (menu to field, menu to confirm, a second
    // element at the same time) keeps the recorded selection and only updates the kind, which is informational.
    let pending = $state.raw<{ kind: PendingKind; selId: number } | null>(null);

    function begin(kind: PendingKind) {
        pending = { kind, selId: pending ? pending.selId : selIdState.selId };
    }

    // The record ends only when nothing of its chain is left open: a menu that closes under its own confirm or field keeps it.
    function release() {
        if (!menu && !renamingChat && !renamingFolder && !deleteRequest) {
            pending = null;
        }
    }

    // A commit may run between the selection change and the effect that cancels; it must write nothing then.
    function canWrite(): boolean {
        return pending !== null && pending.selId === selIdState.selId;
    }

    // The confirm's layer is gone (inert released, focus returned) before the removal that waits for it runs.
    async function settleDelete(confirmed: boolean): Promise<void> {
        const request = deleteRequest;
        if (!request) {
            return;
        }
        deleteRequest = null;
        release();
        await tick();
        request.resolve(confirmed);
    }

    function confirmDelete(request: { chat: Chat; busy: boolean }, trigger: HTMLElement | null): Promise<boolean> {
        void settleDelete(false);
        begin("confirm");
        return new Promise((resolve) => { deleteRequest = { ...request, trigger, resolve }; });
    }

    function cancelPending() {
        void settleDelete(false);
        menu = null;
        renamingChat = null;
        renamingFolder = null;
        pending = null;
    }

    $effect(() => {
        if (pending && pending.selId !== selIdState.selId) {
            untrack(cancelPending);
        }
    });

    // A switch to a group or home removes the panel itself; nothing it had open may outlive it.
    onDestroy(cancelPending);

    function openMenu(target: MenuTarget) {
        begin("menu");
        menu = target;
    }

    function closeMenu() {
        menu = null;
        release();
    }

    function commitChatName(chat: Chat, value: string) {
        const allowed = canWrite();
        renamingChat = null;
        release();
        if (allowed && owner) {
            renameChat(owner.chaId, chat, value);
        }
    }

    function commitFolderName(folder: ChatFolder, value: string) {
        const allowed = canWrite();
        renamingFolder = null;
        release();
        if (allowed && owner) {
            renameFolder(owner.chaId, folder.id, value);
        }
    }

    function cancelRename() {
        renamingChat = null;
        renamingFolder = null;
        release();
    }

    const editing: ListEditing = {
        get renamingChat() { return renamingChat; },
        get renamingFolder() { return renamingFolder; },
        get menu() { return menu; },
        openChatMenu: (chat, opener, anchor) => openMenu({ kind: "chat", chat, opener, anchor }),
        openFolderMenu: (folder, opener, anchor) => openMenu({ kind: "folder", folder, opener, anchor }),
        commitChatName,
        commitFolderName,
        cancelRename,
    };

    // The field replaces the menu that started it, so the record is already set when the menu closes.
    function renameFromMenu() {
        const current = menu;
        if (!current) {
            return;
        }
        if (current.kind === "chat") {
            begin("rename");
            renamingChat = current.chat;
        } else {
            begin("folderName");
            renamingFolder = current.folder;
        }
        closeMenu();
    }

    function moveFromMenu(folderId: string | null) {
        const current = menu;
        closeMenu();
        if (current?.kind === "chat" && owner) {
            moveChat(owner.chaId, current.chat, folderId);
        }
    }

    function newFolderFromMenu() {
        const current = menu;
        closeMenu();
        if (current?.kind === "chat" && owner) {
            const id = createFolder(owner.chaId);
            if (id) {
                moveChat(owner.chaId, current.chat, id);
            }
        }
    }

    function duplicateFromMenu(event: MouseEvent) {
        const current = menu;
        closeMenu();
        if (current?.kind !== "chat" || !owner) {
            return;
        }
        if (!duplicateChat(owner.chaId, current.chat)) {
            return;
        }
        // The copy opens in the character that is still selected, which drops a loading or failed switch to another one for good.
        abandonPendingSwitch();
        if (get(DynamicGUI)) {
            // A click with no pointer detail is a keyboard activation: focus then follows the opened copy.
            if (event.detail === 0) {
                setOverlayReturnFocus(() => resolveSwitchFocus(switchTarget.phase));
            }
            closeOverlay();
        }
    }

    function exportFromMenu() {
        const current = menu;
        closeMenu();
        if (current?.kind === "chat" && owner) {
            const page = owner.chats.indexOf(current.chat);
            if (page !== -1) {
                void exportChat(page);
            }
        }
    }

    // The menu steps aside once the confirm is open, so the pending record has to outlive it. An archived chat has no message
    // count to show, so it is confirmed by an alert outside `pending`; a selection change while that alert is open answers it as
    // cancelled, like every other delete confirm, because a switch that was already running can finish under the alert.
    async function confirmUnlessSelectionMoves(message: string): Promise<boolean> {
        const selId = selIdState.selId;
        const confirmed = await alertConfirm(message);
        return confirmed && selIdState.selId === selId;
    }

    function deleteFromMenu() {
        const current = menu;
        if (current?.kind !== "chat" || !owner) {
            return;
        }
        const victim = current.chat;
        const confirm = isArchivedChat(victim)
            ? () => confirmUnlessSelectionMoves(language.chatShellDeleteArchivedChatConfirm(victim.name || language.settingsPage.unnamed))
            : (request: { chat: Chat; busy: boolean }) => confirmDelete(request, current.opener);
        void removeChatConfirmed(owner, victim, confirm, { keepCurrent: true }).then(async (removed) => {
            if (!removed) {
                return;
            }
            // The deleted row held the focus; the open chat's row is where the user continues.
            await tick();
            const active = document.activeElement;
            if (!active || active === document.body) {
                content?.querySelector<HTMLElement>('[data-part="chat-row"][aria-current="page"]')?.focus();
            }
        });
        closeMenu();
    }

    function colourFromMenu(color: string) {
        const current = menu;
        closeMenu();
        if (current?.kind === "folder" && owner) {
            setFolderColor(owner.chaId, current.folder.id, color);
        }
    }

    async function deleteFolderFromMenu() {
        const current = menu;
        closeMenu();
        if (current?.kind !== "folder" || !owner) {
            return;
        }
        const chaId = owner.chaId;
        const folder = current.folder;
        if (await confirmUnlessSelectionMoves(`${language.removeConfirm}${folder.name}`)) {
            deleteFolder(chaId, folder.id);
        }
    }

    // New chat acts on the character selected now, not the one drawn at the last render.
    function newChat() {
        const target = selectedOwner();
        if (!target) {
            return;
        }
        createNewChat(target);
        // Opening a chat of the character that is still selected drops a loading or failed switch to another one for good.
        if (openChatOf(target, target.chats[0]) === 'opened') {
            abandonPendingSwitch();
        }
    }

    function pickCharacter(entry: Entry, event: MouseEvent) {
        if (refuseSwitchWhileWriting()) {
            return;
        }
        const overlay = get(DynamicGUI);
        // A click with no pointer detail is a keyboard activation: focus then follows the switch.
        if (overlay && event.detail === 0) {
            setOverlayReturnFocus(() => resolveSwitchFocus(switchTarget.phase));
        }
        void switchCharacter(entry);
        if (overlay) {
            closeOverlay();
        }
    }

    // A row opens its chat through the character selected now: a row drawn for the previous character that is
    // activated before the list redraws finds its owner no longer selected and opens nothing.
    function openRow(chat: Chat, event: MouseEvent) {
        const target = owner;
        if (!target || openChatOf(target, chat) !== 'opened') {
            return;
        }
        // The row belongs to the selected character, so a loading or failed switch to another one is dropped for good.
        abandonPendingSwitch();
        if (get(DynamicGUI)) {
            // A click with no pointer detail is a keyboard activation: focus then follows the open chat.
            if (event.detail === 0) {
                setOverlayReturnFocus(() => resolveSwitchFocus(switchTarget.phase));
            }
            closeOverlay();
        }
    }

    function allCharacters() {
        reseter();
        openGrid();
    }

    function goHome() {
        reseter();
        // Going home leaves any loading or failed switch behind; a restore still running must not select its character later.
        // Dropped before the selection moves: the selection watcher would otherwise idle the phase first and skip the supersede.
        abandonPendingSwitch();
        selectedCharID.set(-1);
        PlaygroundStore.set(0);
        OpenRealmStore.set(false);
    }

    function toggleSettings() {
        const wasOpen = get(settingsOpen);
        reseter();
        settingsOpen.set(!wasOpen);
    }

    function afterMoreAction() {
        moreOpen = false;
        closeOverlay();
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key !== 'Escape' || event.defaultPrevented) {
            return;
        }
        // An open menu takes Escape before the overlay does.
        if (moreOpen) {
            event.preventDefault();
            moreOpen = false;
            moreButton?.focus();
        } else if (newMenuOpen) {
            event.preventDefault();
            newMenuOpen = false;
            newMenuButton?.focus();
        }
    }

    function menuFocusOut(event: FocusEvent) {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget || !(event.currentTarget as Node).contains(next)) {
            newMenuOpen = false;
        }
    }

    const footerClass = "flex flex-1 flex-col items-center gap-1 rounded-md py-2 text-xs text-textcolor2 hover:text-textcolor cursor-pointer";
    const menuItemClass = "w-full rounded-md px-3 py-2 text-start text-textcolor hover:bg-selected cursor-pointer";
</script>

<svelte:window bind:innerWidth={viewportWidth} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={content} data-part="chat-sidebar" class="relative flex h-full min-h-0 w-full flex-col gap-3 text-textcolor" onkeydown={onKeydown}>
    <RecentStrip characters={recent} current={owner} {layout} onpick={pickCharacter} onall={allCharacters} />
    {#if owner}
        <div data-part="chat-sidebar-header" class="flex flex-col gap-2">
            <h2 class="truncate text-lg font-bold">{owner.name || language.settingsPage.unnamed}</h2>
            <div class="relative flex gap-1" onfocusout={menuFocusOut}>
                <button class="grow rounded-md bg-darkbutton px-3 py-2 text-textcolor hover:bg-selected cursor-pointer" onclick={newChat}>{language.newChat}</button>
                <button
                    bind:this={newMenuButton}
                    class="flex items-center justify-center rounded-md bg-darkbutton px-2 text-textcolor hover:bg-selected cursor-pointer"
                    aria-label={language.chatShellNewChatMenu}
                    aria-haspopup="menu"
                    aria-expanded={newMenuOpen}
                    onclick={() => { newMenuOpen = !newMenuOpen }}
                >
                    <ChevronDownIcon size={18} />
                </button>
                {#if newMenuOpen}
                    <div role="menu" class="absolute right-0 top-full z-10 mt-1 flex min-w-48 flex-col rounded-md border border-darkborderc bg-bgcolor p-1 shadow-lg">
                        <button role="menuitem" class={menuItemClass} onclick={() => { newMenuOpen = false; void importChat(); }}>{language.chatShellImportChat}</button>
                        <button role="menuitem" class={menuItemClass} onclick={() => { newMenuOpen = false; void exportAllChats(); }}>{language.chatShellExportAllChats}</button>
                    </div>
                {/if}
            </div>
            <div class="flex flex-col gap-1">
                <select
                    data-part="sidebar-sort"
                    class="rounded-md border border-darkborderc bg-darkbutton px-2 py-1 text-textcolor"
                    aria-label={language.chatShellSortLabel}
                    aria-describedby="{uid}-sort-help"
                    value={sort}
                    onchange={(event) => {
                        sort = event.currentTarget.value === 'manual' ? 'manual' : 'recent';
                        writeChatSort(sort);
                    }}
                >
                    <option value="recent">{language.chatShellSortRecent}</option>
                    <option value="manual">{language.chatShellSortManual}</option>
                </select>
                <span id="{uid}-sort-help" class="text-xs text-textcolor2">{language.chatShellOnThisDevice}</span>
            </div>
        </div>
    {/if}
    <div data-part="chat-sidebar-list" class="min-h-0 flex-1 overflow-hidden">
        {#if owner}
            <ShellChatList {owner} {sort} {editing} onopen={openRow} />
        {/if}
    </div>
    <div data-part="chat-sidebar-footer" class="flex gap-1 border-t border-darkborderc pt-2">
        <button data-part="sidebar-home" class={footerClass} onclick={goHome}>
            <HomeIcon size={20} />
            <span>{language.home}</span>
        </button>
        <button data-part="sidebar-settings" class={footerClass} onclick={toggleSettings}>
            <SettingsIcon size={20} />
            <span>{language.settings}</span>
        </button>
        <button
            bind:this={moreButton}
            data-part="sidebar-more"
            class={footerClass}
            aria-expanded={moreOpen}
            onclick={() => { moreOpen = !moreOpen }}
        >
            <EllipsisIcon size={20} />
            <span>{language.chatShellMore}</span>
        </button>
    </div>
    {#if moreOpen}
        <SidebarMoreMenu {reseter} onclose={() => { moreOpen = false; moreButton?.focus(); }} afterAction={afterMoreAction} />
    {/if}
</div>

<!-- The menu and the delete confirm sit beside the content, never inside it: the content goes inert under them. -->
<ShellRowMenu
    target={menu}
    folders={owner?.chatFolders ?? []}
    soleChat={owner?.chats.length === 1}
    onclose={closeMenu}
    onrename={renameFromMenu}
    onmove={moveFromMenu}
    onnewfolder={newFolderFromMenu}
    onduplicate={duplicateFromMenu}
    onexport={exportFromMenu}
    ondelete={deleteFromMenu}
    onfoldercolor={colourFromMenu}
    onfolderdelete={deleteFolderFromMenu}
/>
{#if deleteRequest}
    <ChatDeleteConfirm
        chat={deleteRequest.chat}
        busy={deleteRequest.busy}
        trigger={deleteRequest.trigger}
        background={content ? [content] : []}
        onanswer={(answer: PatternAnswer) => void settleDelete(answer === "confirm")}
    />
{/if}