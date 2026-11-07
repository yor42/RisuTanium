<script lang="ts">
    import { flushSync, onDestroy, tick, untrack } from "svelte";
    import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, EllipsisIcon, GripVerticalIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import type { Chat, ChatFolder, Database } from "src/ts/storage/database.svelte";
    import { ROW_HEIGHT, chatListItems, windowRange } from "../../../ts/chatShell/chatListModel";
    import { createHold, setFolderFolded, type ListEditing } from "../../../ts/chatShell/chatListEdits";
    import { indicatorGap, isFolderItem, siblingDropTarget, siblingEdges, stepTarget, type ChatOrdering } from "../../../ts/chatShell/chatOrder";
    import { startDragSession, type DragSession } from "../../../ts/chatShell/dragSession";
    import type { ChatSort } from "../../../ts/chatShell/deviceSettings";
    import ShellChatRow from "./ShellChatRow.svelte";

    type Entry = Database['characters'][number];

    interface Props {
        // The character whose chats are listed. The list is a function of it, so a switch redraws the whole list.
        owner: Entry;
        sort: ChatSort;
        // The sidebar's editing state: menus and inline names are opened, committed and cancelled through it.
        editing: ListEditing;
        // Opens a chat of `owner`; the caller resolves which character is selected now.
        onopen: (chat: Chat, event: MouseEvent) => void;
        // Present only while Edit order is on for this owner: it shows the handles and buttons and takes the moves.
        ordering?: ChatOrdering | null;
    }

    let { owner, sort, editing, onopen, ordering = null }: Props = $props();

    // Used until the first layout gives the real height.
    const FALLBACK_VIEWPORT = 640;

    // Literal class names so the stylesheet generator finds them.
    const folderColorClass: Record<string, string> = {
        red: "bg-red-900",
        yellow: "bg-yellow-900",
        green: "bg-green-900",
        blue: "bg-blue-900",
        indigo: "bg-indigo-900",
        purple: "bg-purple-900",
        pink: "bg-pink-900",
    };

    let scroller = $state<HTMLElement>();
    let scrollTop = $state(0);
    let viewport = $state(0);
    // -1 follows the open chat; a number is the row the user moved to.
    let focusIndex = $state(-1);

    const items = $derived(chatListItems(owner, sort));
    const range = $derived(windowRange(items.length, scrollTop, viewport || FALLBACK_VIEWPORT));
    const visible = $derived(items.slice(range.start, range.end).map((item, offset) => ({ item, index: range.start + offset })));
    const openChat = $derived(owner.chats?.[owner.chatPage]);
    const openIndex = $derived(items.findIndex((item) => item.kind === "chat" && item.chat === openChat));
    // The one tabbable row; when it is scrolled out of the mounted window the first mounted row takes the stop.
    const stop = $derived.by(() => {
        const wanted = focusIndex >= 0 ? Math.min(focusIndex, items.length - 1) : Math.max(openIndex, 0);
        return wanted >= range.start && wanted < range.end ? wanted : range.start;
    });

    // The first and last of each group, for the inert edge buttons; only needed while the mode is on.
    const edges = $derived(ordering ? siblingEdges(items) : null);

    // The drag in progress and the drop it would make. The indicator and the dragged row render from these alone, so a row
    // that is recycled and mounted again still shows as dragged.
    let drag = $state.raw<{ item: Chat | ChatFolder } | null>(null);
    let dropTarget = $state.raw<{ before: Chat | ChatFolder | null } | null>(null);
    let session: DragSession | null = null;
    let announcement = $state("");
    const indicatorTop = $derived(drag && dropTarget ? indicatorGap(items, drag.item, dropTarget) * ROW_HEIGHT : null);

    function pointDrag(clientY: number, dragged: Chat | ChatFolder) {
        if (!scroller) {
            return;
        }
        scrollTop = scroller.scrollTop;
        const rect = scroller.getBoundingClientRect();
        dropTarget = siblingDropTarget(items, dragged, clientY - rect.top + scroller.scrollTop);
    }

    function commitDrop(dragged: Chat | ChatFolder, before: Chat | ChatFolder | null) {
        if (!ordering) {
            return;
        }
        if (isFolderItem(dragged)) {
            ordering.placeFolder(dragged, before as ChatFolder | null);
        } else {
            ordering.placeChat(dragged, before as Chat | null);
        }
    }

    function startDrag(event: PointerEvent, dragged: Chat | ChatFolder) {
        if (!ordering || !scroller || session || (event.pointerType === "mouse" && event.button !== 0)) {
            return;
        }
        event.preventDefault();
        drag = { item: dragged };
        dropTarget = null;
        session = startDragSession(scroller, event, {
            onpoint: (clientY) => pointDrag(clientY, dragged),
            onend: (kind) => {
                const landing = dropTarget;
                drag = null;
                dropTarget = null;
                session = null;
                if (kind === "commit" && landing) {
                    commitDrop(dragged, landing.before);
                }
            },
        });
        pointDrag(event.clientY, dragged);
    }

    // A drag never outlives the mode, the owner or the list.
    $effect(() => {
        if (!ordering) {
            untrack(() => session?.abort());
        }
    });
    $effect(() => {
        void owner;
        untrack(() => session?.abort());
    });
    onDestroy(() => session?.abort());

    function stepMove(item: Chat | ChatFolder, dir: "up" | "down") {
        if (!ordering) {
            return;
        }
        let landed = false;
        if (isFolderItem(item)) {
            const step = stepTarget(items, item, dir);
            landed = step !== null && ordering.placeFolder(item, step.before);
        } else {
            const step = stepTarget(items, item, dir);
            landed = step !== null && ordering.placeChat(item, step.before);
        }
        if (!landed) {
            return;
        }
        const index = items.findIndex((entry) => (entry.kind === "folder" ? entry.folder === item : entry.chat === item));
        if (index === -1) {
            return;
        }
        const moved = items[index];
        announcement = language.chatShellMovedTo(item.name || language.settingsPage.unnamed, moved.posinset, moved.setsize);
        // The row may be outside the mounted window after a long move; it is mounted again before it is focused.
        focusIndex = index;
        reveal(index);
        flushSync();
        scroller?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.parentElement?.querySelector<HTMLElement>(`[data-part="chat-move-${dir}"]`)?.focus();
    }

    // A switch to another character starts the new list at the top with the tab stop on its open chat.
    $effect(() => {
        void owner;
        untrack(() => {
            focusIndex = -1;
            scrollTop = 0;
            if (scroller) {
                scroller.scrollTop = 0;
            }
        });
    });

    function setFolded(folder: ChatFolder, folded: boolean) {
        setFolderFolded(owner.chaId, folder.id, folded);
    }

    // One touch is active at a time, so one recogniser serves every folder header; it remembers which header the
    // press started on.
    let pressed: { folder: ChatFolder; opener: HTMLElement } | null = null;
    let ringFolder = $state<ChatFolder | null>(null);
    const folderHold = createHold({
        onring: (on) => { ringFolder = on && pressed ? pressed.folder : null; },
        onhold: (at) => {
            if (pressed) {
                editing.openFolderMenu(pressed.folder, pressed.opener, at);
            }
        },
    });

    function folderPointerDown(event: PointerEvent, folder: ChatFolder) {
        pressed = { folder, opener: event.currentTarget as HTMLElement };
        folderHold.down(event);
    }

    function folderContextMenu(event: MouseEvent, folder: ChatFolder) {
        event.preventDefault();
        folderHold.stop();
        editing.openFolderMenu(folder, event.currentTarget as HTMLElement, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
    }

    function folderKeydown(event: KeyboardEvent, folder: ChatFolder) {
        if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
            event.preventDefault();
            editing.openFolderMenu(folder, event.currentTarget as HTMLElement);
        }
    }

    function folderClick(folder: ChatFolder, folded: boolean) {
        if (folderHold.takeClick()) {
            return;
        }
        setFolded(folder, !folded);
    }

    // True from the moment a folder field opens until it commits or cancels, so a later blur does not write twice.
    let folderFieldLive = false;
    $effect(() => {
        const field = editing.renamingFolder;
        untrack(() => { folderFieldLive = field !== null; });
    });

    function focusRowAt(index: number) {
        void tick().then(() => {
            const active = document.activeElement;
            if (!active || active === document.body) {
                scroller?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
            }
        });
    }

    function commitFolderField(folder: ChatFolder, input: HTMLInputElement, index: number) {
        if (!folderFieldLive) {
            return;
        }
        folderFieldLive = false;
        editing.commitFolderName(folder, input.value);
        focusRowAt(index);
    }

    function folderFieldKeydown(event: KeyboardEvent, folder: ChatFolder, index: number) {
        const input = event.currentTarget as HTMLInputElement;
        if (event.key === "Enter") {
            // The Enter that confirms an IME composition belongs to the composition.
            if (event.isComposing || event.keyCode === 229) {
                return;
            }
            event.preventDefault();
            commitFolderField(folder, input, index);
        } else if (event.key === "Escape") {
            // The field consumes it: the overlay and the page must not also close.
            event.preventDefault();
            event.stopPropagation();
            if (folderFieldLive) {
                folderFieldLive = false;
                editing.cancelRename();
                focusRowAt(index);
            }
        }
    }

    // Focuses and selects a field when it appears, after the menu that opened it has returned its own focus.
    function focusField(node: HTMLInputElement) {
        void tick().then(tick).then(() => {
            node.focus();
            node.select();
        });
    }

    function reveal(index: number) {
        if (!scroller) {
            return;
        }
        const height = viewport || FALLBACK_VIEWPORT;
        const top = index * ROW_HEIGHT;
        if (top < scroller.scrollTop) {
            scroller.scrollTop = top;
        } else if (top + ROW_HEIGHT > scroller.scrollTop + height) {
            scroller.scrollTop = top + ROW_HEIGHT - height;
        }
        scrollTop = scroller.scrollTop;
    }

    function focusRow(index: number) {
        focusIndex = index;
        reveal(index);
        // The row may not be mounted until the window has moved to it.
        flushSync();
        scroller?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }
        // A name field edits text: its keys are its own.
        if (event.target instanceof HTMLInputElement) {
            return;
        }
        const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-index]") : null;
        if (!row) {
            return;
        }
        const index = Number(row.dataset.index);
        const item = items[index];
        if (!item) {
            return;
        }
        let handled = true;
        switch (event.key) {
            case "ArrowDown":
                if (index + 1 < items.length) {
                    focusRow(index + 1);
                }
                break;
            case "ArrowUp":
                if (index > 0) {
                    focusRow(index - 1);
                }
                break;
            case "Home":
                focusRow(0);
                break;
            case "End":
                focusRow(items.length - 1);
                break;
            case "ArrowRight":
                if (item.kind === "folder") {
                    if (item.folded) {
                        setFolded(item.folder, false);
                    } else if (items[index + 1]?.kind === "chat" && items[index + 1].level === 2) {
                        focusRow(index + 1);
                    }
                } else {
                    handled = false;
                }
                break;
            case "ArrowLeft":
                if (item.kind === "folder") {
                    if (!item.folded) {
                        setFolded(item.folder, true);
                    }
                } else if (item.level === 2) {
                    for (let at = index - 1; at >= 0; at--) {
                        if (items[at].kind === "folder") {
                            focusRow(at);
                            break;
                        }
                    }
                } else {
                    handled = false;
                }
                break;
            default:
                handled = false;
        }
        if (handled) {
            event.preventDefault();
        }
    }
</script>

<div
    bind:this={scroller}
    bind:clientHeight={viewport}
    data-part="chat-list-scroller"
    class="relative h-full overflow-y-auto"
    onscroll={() => { scrollTop = scroller?.scrollTop ?? 0 }}
>
    <!-- Focus lives on the rows (roving tab stop); the tree only routes their keys. -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div role="tree" aria-label={language.chatList} data-part="chat-list" onkeydown={onKeydown}>
        <div role="presentation" style:height="{range.start * ROW_HEIGHT}px"></div>
        {#each visible as entry (entry.item.kind === "folder" ? entry.item.folder : entry.item.chat)}
            {@const item = entry.item}
            {#if item.kind === "folder"}
                <div
                    data-part="chat-folder-host"
                    data-ring={ringFolder === item.folder ? "" : undefined}
                    data-dragging={drag?.item === item.folder ? "" : undefined}
                    class="relative rounded-md {ringFolder === item.folder ? 'ring-2 ring-darkborderc' : ''} {drag?.item === item.folder ? 'opacity-60' : ''}"
                    style:height="{ROW_HEIGHT}px"
                >
                    {#if editing.renamingFolder === item.folder}
                        <div class="flex h-full w-full items-center rounded-md bg-selected px-2">
                            <input
                                data-part="chat-folder-name-input"
                                class="w-full rounded-md border border-darkborderc bg-darkbg px-2 py-1 text-textcolor"
                                aria-label={language.chatShellRenameFolder}
                                value={item.folder.name}
                                {@attach focusField}
                                onkeydown={(event) => folderFieldKeydown(event, item.folder, entry.index)}
                                onblur={(event) => commitFolderField(item.folder, event.currentTarget, entry.index)}
                            />
                        </div>
                    {:else}
                        <button
                            type="button"
                            role="treeitem"
                            data-part="chat-folder"
                            data-index={entry.index}
                            class="flex h-full w-full select-none items-center gap-2 rounded-md ps-2 {ordering ? 'pe-28' : 'pe-10'} text-start text-textcolor hover:bg-selected cursor-pointer {folderColorClass[item.folder.color ?? ''] ?? ''}"
                            tabindex={entry.index === stop ? 0 : -1}
                            aria-level={item.level}
                            aria-posinset={item.posinset}
                            aria-setsize={item.setsize}
                            aria-selected="false"
                            aria-expanded={!item.folded}
                            onclick={() => folderClick(item.folder, item.folded)}
                            oncontextmenu={(event) => folderContextMenu(event, item.folder)}
                            onkeydown={(event) => folderKeydown(event, item.folder)}
                            onpointerdown={(event) => folderPointerDown(event, item.folder)}
                            onpointermove={folderHold.move}
                            onpointerup={folderHold.stop}
                            onpointercancel={folderHold.stop}
                        >
                            {#if item.folded}
                                <ChevronRightIcon size={16} />
                            {:else}
                                <ChevronDownIcon size={16} />
                            {/if}
                            <span data-part="chat-folder-name" class="grow truncate font-medium">{item.folder.name || language.settingsPage.unnamed}</span>
                            <span class="shrink-0 text-xs text-textcolor2">{item.count}</span>
                        </button>
                        {#if ordering}
                            {@const edge = edges?.get(item.folder)}
                            <div class="absolute end-1 top-1/2 flex -translate-y-1/2 items-center">
                                <button
                                    type="button"
                                    data-part="chat-move-up"
                                    class="flex size-8 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer {edge?.first ? 'opacity-40' : ''}"
                                    tabindex={entry.index === stop ? 0 : -1}
                                    aria-label="{language.chatShellMoveUp} {item.folder.name || language.settingsPage.unnamed}"
                                    aria-disabled={edge?.first ? "true" : undefined}
                                    onclick={() => stepMove(item.folder, "up")}
                                >
                                    <ChevronUpIcon size={18} />
                                </button>
                                <button
                                    type="button"
                                    data-part="chat-move-down"
                                    class="flex size-8 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer {edge?.last ? 'opacity-40' : ''}"
                                    tabindex={entry.index === stop ? 0 : -1}
                                    aria-label="{language.chatShellMoveDown} {item.folder.name || language.settingsPage.unnamed}"
                                    aria-disabled={edge?.last ? "true" : undefined}
                                    onclick={() => stepMove(item.folder, "down")}
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
                                    onpointerdown={(event) => startDrag(event, item.folder)}
                                >
                                    <GripVerticalIcon size={18} />
                                </span>
                            </div>
                        {:else}
                            <button
                                type="button"
                                data-part="chat-folder-menu"
                                class="absolute end-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-textcolor2 hover:bg-selected hover:text-textcolor cursor-pointer"
                                tabindex="-1"
                                aria-label={language.chatShellFolderMenu(item.folder.name || language.settingsPage.unnamed)}
                                aria-haspopup="menu"
                                aria-expanded={editing.menu?.kind === "folder" && editing.menu.folder === item.folder}
                                onclick={(event) => editing.openFolderMenu(item.folder, event.currentTarget)}
                            >
                                <EllipsisIcon size={18} />
                            </button>
                        {/if}
                    {/if}
                </div>            {:else}
                <ShellChatRow
                    chat={item.chat}
                    chaId={owner.chaId}
                    index={entry.index}
                    open={item.chat === openChat}
                    tabbable={entry.index === stop}
                    level={item.level}
                    posinset={item.posinset}
                    setsize={item.setsize}
                    {editing}
                    {onopen}
                    reordering={ordering !== null}
                    dragging={drag?.item === item.chat}
                    first={edges?.get(item.chat)?.first ?? false}
                    last={edges?.get(item.chat)?.last ?? false}
                    onstep={(dir) => stepMove(item.chat, dir)}
                    onhandle={(event) => startDrag(event, item.chat)}
                />
            {/if}
        {/each}
        <div role="presentation" style:height="{(items.length - range.end) * ROW_HEIGHT}px"></div>
    </div>
    {#if indicatorTop !== null}
        <div
            data-part="chat-drop-indicator"
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-1/2 bg-selected"
            style:top="{indicatorTop}px"
        ></div>
    {/if}
    <div data-part="chat-order-status" class="sr-only" role="status" aria-live="polite">{announcement}</div>
</div>
