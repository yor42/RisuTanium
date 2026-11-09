<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import { ChevronDownIcon, ChevronUpIcon, EllipsisIcon, GripVerticalIcon, PencilIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import type { Chat } from "src/ts/storage/database.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import * as composerDrafts from "../../../ts/process/composerDrafts.svelte";
    import { isGeneratingIn } from "../../../ts/process/chatOrigin";
    import { replyMarkOf } from "../../../ts/process/replyMarks";
    import { ROW_HEIGHT, isArchivedChat, previewLine, rowTime } from "../../../ts/chatShell/chatListModel";
    import { createHold, type ListEditing } from "../../../ts/chatShell/chatListEdits";
    import { isImeComposing } from "../../../ts/ime/compositionGuard";

    interface Props {
        chat: Chat;
        // The owner's id, which with the chat's own id names its composer draft.
        chaId: string;
        // Position in the flat list, for focus handling.
        index: number;
        // Whether this is the open chat of the character.
        open: boolean;
        // The roving tab stop: exactly one row of the list is tabbable.
        tabbable: boolean;
        level: 1 | 2;
        posinset: number;
        setsize: number;
        // The sidebar's editing state: the row reads it and reports menu and rename events.
        editing: ListEditing;
        onopen: (chat: Chat, event: MouseEvent) => void;
        // Edit order: the handle and the Up/Down buttons replace the menu button. `first`/`last` are the group's edges.
        reordering?: boolean;
        dragging?: boolean;
        first?: boolean;
        last?: boolean;
        onstep?: (dir: 'up' | 'down') => void;
        onhandle?: (event: PointerEvent) => void;
    }

    let { chat, chaId, index, open, tabbable, level, posinset, setsize, editing, onopen, reordering = false, dragging = false, first = false, last = false, onstep, onhandle }: Props = $props();

    // A row only reads what the chat already holds: an archived chat shows a placeholder and is never loaded here.
    const archived = $derived(isArchivedChat(chat));
    const preview = $derived(archived ? language.chatShellRowArchived : previewLine(chat));
    const time = $derived(archived ? "" : rowTime(chat, Date.now(), DBState.db.language || undefined));
    const draft = $derived.by(() => {
        const record = composerDrafts.peek(chaId && chat.id ? { chaId, chatId: chat.id } : null);
        return record.messageInput !== "" || record.messageInputTranslate !== "" || record.fileInput.length > 0;
    });
    const name = $derived(chat.name || language.settingsPage.unnamed);
    // Own chat only: the registry's version and this chat's mark, nothing a streamed token writes.
    const writing = $derived(chaId && chat.id ? isGeneratingIn({ chaId, chatId: chat.id }) : false);
    const mark = $derived(archived ? null : replyMarkOf(chat));
    const renaming = $derived(editing.renamingChat === chat);
    const menuOpen = $derived(editing.menu?.kind === "chat" && editing.menu.chat === chat);

    let rowButton = $state<HTMLButtonElement>();
    let menuButton = $state<HTMLButtonElement>();
    let nameInput = $state<HTMLInputElement>();
    let ring = $state(false);
    // True from the moment the field opens until it commits or cancels, so a later blur does not write twice.
    let fieldLive = false;

    const hold = createHold({
        onring: (on) => { ring = on; },
        onhold: (at) => openMenu(rowButton, at),
    });

    function openMenu(opener: HTMLElement | undefined, at?: { x: number; y: number }) {
        if (opener) {
            editing.openChatMenu(chat, opener, at);
        }
    }

    function onContextMenu(event: MouseEvent) {
        event.preventDefault();
        hold.stop();
        // A keyboard-initiated menu has no pointer position; the menu then anchors to the row.
        openMenu(rowButton, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
    }

    function onRowKeydown(event: KeyboardEvent) {
        if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
            event.preventDefault();
            openMenu(rowButton);
        }
    }

    function onRowClick(event: MouseEvent) {
        if (hold.takeClick()) {
            return;
        }
        onopen(chat, event);
    }

    function commitName() {
        if (!fieldLive) {
            return;
        }
        fieldLive = false;
        editing.commitChatName(chat, nameInput?.value ?? chat.name);
    }

    function cancelName() {
        if (!fieldLive) {
            return;
        }
        fieldLive = false;
        editing.cancelRename();
    }

    function onFieldKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            // The Enter that confirms an IME composition belongs to the composition.
            if (isImeComposing(event)) {
                return;
            }
            event.preventDefault();
            commitName();
        } else if (event.key === "Escape") {
            // The field consumes it: the overlay and the page must not also close.
            event.preventDefault();
            event.stopPropagation();
            cancelName();
        }
    }

    // Opening the field focuses it after the menu that started it has returned its own focus; closing it with
    // nothing focused gives the focus back to the row.
    let wasRenaming = false;
    $effect(() => {
        const now = renaming;
        untrack(() => {
            if (now) {
                fieldLive = true;
                wasRenaming = true;
                void tick().then(tick).then(() => {
                    nameInput?.focus();
                    nameInput?.select();
                });
            } else if (wasRenaming) {
                wasRenaming = false;
                fieldLive = false;
                void tick().then(() => {
                    const active = document.activeElement;
                    if (!active || active === document.body) {
                        rowButton?.focus();
                    }
                });
            }
        });
    });

    onDestroy(hold.stop);
</script>

<div
    data-part="chat-row-host"
    data-ring={ring ? "" : undefined}
    data-dragging={dragging ? "" : undefined}
    class="relative rounded-md {ring ? 'ring-2 ring-darkborderc' : ''} {dragging ? 'opacity-60' : ''}"
    style:height="{ROW_HEIGHT}px"
>
    {#if renaming}
        <div
            data-part="chat-row-editing"
            class="flex h-full w-full flex-col justify-center rounded-md bg-selected pe-2"
            style:padding-inline-start={level === 2 ? "1.5rem" : "0.5rem"}
        >
            <input
                bind:this={nameInput}
                data-part="chat-row-name-input"
                class="w-full rounded-md border border-darkborderc bg-darkbg px-2 py-1 text-textcolor"
                aria-label={language.chatShellRename}
                value={chat.name}
                onkeydown={onFieldKeydown}
                onblur={commitName}
            />
        </div>
    {:else}
        <button
            bind:this={rowButton}
            type="button"
            role="treeitem"
            data-part="chat-row"
            data-index={index}
            class="flex h-full w-full select-none flex-col justify-center gap-0.5 rounded-md {reordering ? 'pe-28' : 'pe-10'} text-start text-textcolor hover:bg-selected cursor-pointer"
            class:bg-selected={open}
            style:padding-inline-start={level === 2 ? "1.5rem" : "0.5rem"}
            tabindex={tabbable ? 0 : -1}
            aria-level={level}
            aria-posinset={posinset}
            aria-setsize={setsize}
            aria-selected={open}
            aria-current={open ? "page" : undefined}
            onclick={onRowClick}
            oncontextmenu={onContextMenu}
            onkeydown={onRowKeydown}
            onpointerdown={hold.down}
            onpointermove={hold.move}
            onpointerup={hold.stop}
            onpointercancel={hold.stop}
        >
            <span class="flex items-baseline gap-2">
                <span data-part="chat-row-name" class="grow truncate font-medium">{chat.name || language.settingsPage.unnamed}</span>
                {#if writing}
                    <span data-part="reply-writing-badge" role="img" aria-label={language.chatWritingBadge} class="shrink-0 self-center animate-pulse text-textcolor2"><PencilIcon size={14} /></span>
                {/if}
                {#if mark === "reply"}
                    <span data-part="reply-new-dot" role="img" aria-label={language.chatNewReplyDot} class="shrink-0 self-center size-2 rounded-full bg-selected border border-textcolor2"></span>
                {:else if mark === "error"}
                    <span data-part="reply-error-dot" role="img" aria-label={language.chatReplyErrorDot} class="shrink-0 self-center size-2 rounded-full bg-draculared"></span>
                {/if}
                {#if time}
                    <span data-part="chat-row-time" class="shrink-0 text-xs text-textcolor2">{time}</span>
                {/if}
            </span>
            <span class="flex items-center gap-2 text-xs text-textcolor2">
                <span data-part="chat-row-preview" class="grow truncate">{preview}</span>
                {#if draft}
                    <span data-part="chat-row-draft" class="shrink-0 rounded-sm border border-darkborderc px-1 text-textcolor">{language.chatShellStatusDraft}</span>
                {/if}
            </span>
        </button>
        {#if reordering}
            <!-- Siblings of the row button, never inside it: the list's arrow keys rove only over [data-index]. -->
            <div class="absolute end-1 top-1/2 flex -translate-y-1/2 items-center">
                <button
                    type="button"
                    data-part="chat-move-up"
                    class="flex size-8 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer {first ? 'opacity-40' : ''}"
                    tabindex={tabbable ? 0 : -1}
                    aria-label="{language.chatShellMoveUp} {name}"
                    aria-disabled={first ? "true" : undefined}
                    onclick={() => onstep?.("up")}
                >
                    <ChevronUpIcon size={18} />
                </button>
                <button
                    type="button"
                    data-part="chat-move-down"
                    class="flex size-8 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer {last ? 'opacity-40' : ''}"
                    tabindex={tabbable ? 0 : -1}
                    aria-label="{language.chatShellMoveDown} {name}"
                    aria-disabled={last ? "true" : undefined}
                    onclick={() => onstep?.("down")}
                >
                    <ChevronDownIcon size={18} />
                </button>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span
                    data-part="chat-drag-handle"
                    aria-hidden="true"
                    data-panel-gesture="off"
                    class="flex size-8 items-center justify-center rounded-md text-textcolor2 cursor-grab"
                    style:touch-action="none"
                    onpointerdown={onhandle}
                >
                    <GripVerticalIcon size={18} />
                </span>
            </div>
        {:else}
            <button
                bind:this={menuButton}
                type="button"
                data-part="chat-row-menu"
                class="absolute end-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer"
                tabindex="-1"
                aria-label={language.chatShellRowMenu(name)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onclick={() => openMenu(menuButton)}
            >
                <EllipsisIcon size={18} />
            </button>
        {/if}
    {/if}
</div>
