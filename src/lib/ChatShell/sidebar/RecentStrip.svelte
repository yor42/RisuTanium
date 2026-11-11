<script lang="ts">
    import { LayoutGridIcon, UsersIcon } from "@lucide/svelte";
    import { untrack } from "svelte";
    import { language } from "src/lang";
    import type { Database } from "src/ts/storage/database.svelte";
    import CharListAvatar from "../../Others/CharListAvatar.svelte";

    type Entry = Database['characters'][number];

    interface Props {
        // The characters to offer, most recent first (`recentCharacters`).
        characters: ReadonlyArray<Entry>;
        // The open character; it is always shown, ringed.
        current?: Entry;
        // Five avatars in both overlays, four when docked; names are left out of the follow overlay,
        // where each avatar keeps a tooltip.
        layout: 'follow' | 'wide' | 'docked';
        onpick: (entry: Entry, event: MouseEvent) => void;
        onall: () => void;
    }

    let { characters, current, layout, onpick, onall }: Props = $props();

    let stripEl: HTMLDivElement | undefined = $state();
    // Focus on an avatar follows its character across a replace or reorder of the strip, and
    // focus that went elsewhere is never taken back. Svelte moves and removes avatar nodes while it
    // reconciles, which drops focus to the body. Plain variable: it only hands the captured id from
    // `shown` to the refocus in the same flush, and must not schedule either effect itself.
    let refocusChaId: string | null = null;

    function focusedAvatarId(): string | null {
        const active = document.activeElement;
        const avatar = active instanceof HTMLElement && stripEl?.contains(active) ? active.closest<HTMLElement>('[data-part="strip-avatar"]') : null;
        return avatar?.dataset.chaId ?? null;
    }

    const slots = $derived(layout === 'docked' ? 4 : 5);
    const shown = $derived.by(() => {
        const first = characters.slice(0, slots);
        const list = !current || first.includes(current) || !characters.includes(current)
            ? first
            : first.length < slots ? [...first, current] : [...first.slice(0, slots - 1), current];
        // Deliberate side effect: the focused avatar is remembered while the list is computed, because
        // the markup reads `shown` before it touches the DOM in both schedulers, whereas an
        // `$effect.pre` runs after the block update under the async scheduler and sees focus already
        // dropped. This holds while: `activeElement` and `stripEl` are read untracked, so the
        // capture adds no dependency; a single batch computes `shown` once per update, so no second
        // evaluation can run after the DOM changed (a markup `await`, an async derived or `fork()`
        // here would need the capture revisited); and the effect below consumes and clears the id.
        refocusChaId = untrack(focusedAvatarId);
        return list;
    });
    const showNames = $derived(layout !== 'follow');

    function labelOf(entry: Entry): string {
        const name = entry.name || language.settingsPage.unnamed;
        return entry.type === 'group' ? language.chatShellGroupName(name) : name;
    }

    $effect(() => {
        void shown;
        const chaId = refocusChaId;
        refocusChaId = null;
        if (chaId === null || !stripEl) {
            return;
        }
        const active = document.activeElement;
        if (active && active !== document.body) {
            return;
        }
        for (const button of stripEl.querySelectorAll<HTMLElement>('[data-part="strip-avatar"]')) {
            if (button.dataset.chaId === chaId) {
                button.focus({ preventScroll: true });
                return;
            }
        }
    });
</script>

<div bind:this={stripEl} data-part="chat-sidebar-strip" role="group" aria-label={language.chatShellRecentCharacters} class="flex items-start gap-1 w-full">
    {#each shown as entry (entry)}
        {@const label = labelOf(entry)}
        <button
            data-part="strip-avatar"
            data-cha-id={entry.chaId}
            class="flex flex-col items-center gap-0.5 w-11 min-w-11 cursor-pointer text-textcolor hover:text-textcolor2"
            aria-label={label}
            title={label}
            aria-current={entry === current ? 'true' : undefined}
            onclick={(event) => onpick(entry, event)}
        >
            <span class="relative flex rounded-md" class:ring-2={entry === current} class:ring-textcolor={entry === current}>
                <CharListAvatar src={entry.image ?? ''} class="h-11! w-11! min-h-11!" />
                {#if entry.type === 'group'}
                    <span data-part="strip-group-glyph" class="absolute bottom-0 right-0 flex items-center justify-center rounded-tl-md rounded-br-md bg-darkbg text-textcolor p-0.5" aria-hidden="true">
                        <UsersIcon size={12} />
                    </span>
                {/if}
            </span>
            {#if showNames}
                <span data-part="strip-name" class="w-full truncate text-center text-[10px] leading-tight">{entry.name || language.settingsPage.unnamed}</span>
            {/if}
        </button>
    {/each}
    <button
        data-part="strip-all"
        class="flex items-center justify-center h-11 w-11 min-w-11 rounded-md bg-darkbutton text-textcolor hover:text-textcolor2 cursor-pointer"
        aria-label={language.chatShellAllCharacters}
        title={language.chatShellAllCharacters}
        onclick={onall}
    >
        <LayoutGridIcon size={20} />
    </button>
</div>
