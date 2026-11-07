<script lang="ts">
    import { flushSync } from "svelte";
    import { SearchIcon } from "@lucide/svelte";
    import { language } from "src/lang";
    import type { Chat, Database } from "src/ts/storage/database.svelte";
    import { ROW_HEIGHT, previewLine, isArchivedChat, windowRange } from "../../../ts/chatShell/chatListModel";
    import type { SearchResult } from "../../../ts/chatShell/chatSearch";

    type Entry = Database['characters'][number];

    type Row =
        | { kind: "label"; text: string }
        | { kind: "character"; entry: Entry; posinset: number }
        | { kind: "chat"; chat: Chat; posinset: number };

    interface Props {
        // What the field holds right now; the sidebar reads it for the debounce and for Enter.
        query: string;
        // The landed results, or null while nothing is searched. They replace the chat list.
        results: SearchResult | null;
        // Docked, an empty field's Escape hands the focus to the transcript; in the overlay it closes the panel instead.
        docked: boolean;
        onpickcharacter: (entry: Entry, event: MouseEvent | KeyboardEvent) => void;
        onpickchat: (chat: Chat, event: MouseEvent | KeyboardEvent) => void;
        // Enter in the field: the sidebar opens the first result of the typed text.
        onsubmit: (event: KeyboardEvent) => void;
    }

    let { query = $bindable(), results, docked, onpickcharacter, onpickchat, onsubmit }: Props = $props();

    // Used until the first layout gives the real height.
    const FALLBACK_VIEWPORT = 320;

    let field = $state<HTMLInputElement>();
    let scroller = $state<HTMLElement>();
    let scrollTop = $state(0);
    let viewport = $state(0);
    let focusIndex = $state(0);

    // Group labels and result rows share one fixed height, so the window of mounted rows is placed by arithmetic.
    const rows = $derived.by<Row[]>(() => {
        if (!results) {
            return [];
        }
        const out: Row[] = [];
        let position = 0;
        if (results.characters.length > 0) {
            out.push({ kind: "label", text: language.chatShellSearchCharacters });
            for (const entry of results.characters) {
                out.push({ kind: "character", entry, posinset: ++position });
            }
        }
        if (results.chats.length > 0) {
            out.push({ kind: "label", text: language.chatShellSearchThisCharacterChats });
            for (const chat of results.chats) {
                out.push({ kind: "chat", chat, posinset: ++position });
            }
        }
        return out;
    });
    const setsize = $derived(results ? results.characters.length + results.chats.length : 0);
    const range = $derived(windowRange(rows.length, scrollTop, viewport || FALLBACK_VIEWPORT));
    const visible = $derived(rows.slice(range.start, range.end).map((row, offset) => ({ row, index: range.start + offset })));
    const summary = $derived.by(() => {
        if (!results) {
            return "";
        }
        if (results.total === 0) {
            return language.chatShellNoResults;
        }
        return results.shown < results.total ? language.chatShellResultsShown(results.shown, results.total) : language.chatShellResultsCount(results.total);
    });

    // The one tabbable result: the row last moved to, else the first. Group labels are never tabbable.
    const stop = $derived.by(() => {
        const options = optionIndexes();
        return options.includes(focusIndex) ? focusIndex : (options[0] ?? -1);
    });

    function labelOf(entry: Entry): string {
        const name = entry.name || language.settingsPage.unnamed;
        return entry.type === "group" ? language.chatShellGroupName(name) : name;
    }

    function optionIndexes(): number[] {
        const out: number[] = [];
        rows.forEach((row, index) => {
            if (row.kind !== "label") {
                out.push(index);
            }
        });
        return out;
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

    function onFieldKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            // The Enter that confirms an IME composition belongs to the composition.
            if (event.isComposing || event.keyCode === 229) {
                return;
            }
            event.preventDefault();
            onsubmit(event);
        } else if (event.key === "ArrowDown") {
            const first = optionIndexes()[0];
            if (first !== undefined) {
                event.preventDefault();
                focusRow(first);
            }
        } else if (event.key === "Escape") {
            if (event.defaultPrevented) {
                return;
            }
            if (query !== "") {
                event.preventDefault();
                query = "";
            } else if (docked) {
                event.preventDefault();
                document.querySelector<HTMLElement>('[data-part="chat-transcript"]')?.focus();
            }
        }
    }

    function onRowsKeydown(event: KeyboardEvent) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
        }
        const row = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-index]") : null;
        if (!row) {
            return;
        }
        const index = Number(row.dataset.index);
        const options = optionIndexes();
        const at = options.indexOf(index);
        if (at === -1) {
            return;
        }
        switch (event.key) {
            case "ArrowDown":
                if (at + 1 < options.length) {
                    focusRow(options[at + 1]);
                }
                break;
            case "ArrowUp":
                if (at > 0) {
                    focusRow(options[at - 1]);
                } else {
                    field?.focus();
                }
                break;
            case "Home":
                focusRow(options[0]);
                break;
            case "End":
                focusRow(options[options.length - 1]);
                break;
            case "Enter": {
                const entry = rows[index];
                if (entry.kind === "character") {
                    onpickcharacter(entry.entry, event);
                } else if (entry.kind === "chat") {
                    onpickchat(entry.chat, event);
                }
                break;
            }
            case "Escape":
                if (event.defaultPrevented) {
                    return;
                }
                field?.focus();
                break;
            default:
                return;
        }
        event.preventDefault();
    }
</script>

<div data-part="chat-sidebar-search" class="flex min-h-0 flex-col gap-2 {results ? 'flex-1' : ''}">
    <div class="relative">
        <SearchIcon size={16} class="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-textcolor2" />
        <input
            bind:this={field}
            bind:value={query}
            data-part="chat-sidebar-search-field"
            type="text"
            class="w-full rounded-md border border-darkborderc bg-darkbutton ps-8 pe-2 py-2 text-textcolor"
            placeholder={language.chatShellSearchPlaceholder}
            aria-label={language.chatShellSearchPlaceholder}
            autocomplete="off"
            spellcheck="false"
            onkeydown={onFieldKeydown}
        />
    </div>
    {#if results}
        <div data-part="chat-search-status" class="text-xs text-textcolor2" role="status" aria-live="polite">{summary}</div>
        <div
            bind:this={scroller}
            bind:clientHeight={viewport}
            data-part="chat-search-scroller"
            class="relative min-h-0 flex-1 overflow-y-auto"
            onscroll={() => { scrollTop = scroller?.scrollTop ?? 0 }}
        >
            <!-- Focus lives on the rows (roving tab stop); the list only routes their keys. -->
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <div role="listbox" aria-label={language.chatShellSearchPlaceholder} data-part="chat-search-results" onkeydown={onRowsKeydown}>
                <div role="presentation" style:height="{range.start * ROW_HEIGHT}px"></div>
                {#each visible as entry (entry.index)}
                    {@const row = entry.row}
                    {#if row.kind === "label"}
                        <div
                            role="presentation"
                            data-part="chat-search-group"
                            class="flex items-end px-2 pb-1 text-xs font-medium text-textcolor2"
                            style:height="{ROW_HEIGHT}px"
                        >{row.text}</div>
                    {:else if row.kind === "character"}
                        <button
                            type="button"
                            role="option"
                            data-part="chat-search-character"
                            data-index={entry.index}
                            class="flex w-full select-none flex-col justify-center rounded-md px-2 text-start text-textcolor hover:bg-selected cursor-pointer"
                            style:height="{ROW_HEIGHT}px"
                            tabindex={entry.index === stop ? 0 : -1}
                            aria-selected="false"
                            aria-posinset={row.posinset}
                            aria-setsize={setsize}
                            onclick={(event) => onpickcharacter(row.entry, event)}
                        >
                            <span class="truncate font-medium">{labelOf(row.entry)}</span>
                        </button>
                    {:else}
                        <button
                            type="button"
                            role="option"
                            data-part="chat-search-chat"
                            data-index={entry.index}
                            class="flex w-full select-none flex-col justify-center gap-0.5 rounded-md px-2 text-start text-textcolor hover:bg-selected cursor-pointer"
                            style:height="{ROW_HEIGHT}px"
                            tabindex={entry.index === stop ? 0 : -1}
                            aria-selected="false"
                            aria-posinset={row.posinset}
                            aria-setsize={setsize}
                            onclick={(event) => onpickchat(row.chat, event)}
                        >
                            <span class="truncate font-medium">{row.chat.name || language.settingsPage.unnamed}</span>
                            <span class="truncate text-xs text-textcolor2">{isArchivedChat(row.chat) ? language.chatShellRowArchived : previewLine(row.chat)}</span>
                        </button>
                    {/if}
                {/each}
                <div role="presentation" style:height="{(rows.length - range.end) * ROW_HEIGHT}px"></div>
            </div>
        </div>
    {/if}
</div>
