<script module lang="ts">
    import type { ThumbAborted } from "src/ts/media/avatarThumb";

    // Resolved avatar styles by lookup key, so a tile that is created again (its row regrouped by a search or a
    // column change) paints at once and asks for nothing. Bounded two ways, the least recently used entry going
    // first until both hold: the summed style length stays within STYLE_CACHE_MAX_TOTAL UTF-16 units (the budget
    // of the shared thumbnail memo, so one scroll pass over every avatar of a large list stays resident), and
    // the entry count stays within STYLE_CACHE_MAX_ENTRIES so tiny styles cannot grow the map without bound.
    // Only a lookup that resolved is stored; a failure is never remembered. A style that carries a whole file
    // (a data: URL for an animated avatar or a skipped thumbnail) is not stored either: an entry is kept only
    // up to STYLE_CACHE_MAX_LENGTH UTF-16 units, which every thumbnail fits under. A style with a blob: URL is
    // not stored either: deleting its asset revokes the URL, and a style kept past that would paint a dead URL
    // when the same content is added again. A style with an empty URL
    // (the file source failed) is not stored; the empty style of hide-all-images has no URL and is.
    const STYLE_CACHE_MAX_TOTAL = 16 * 1024 * 1024;
    const STYLE_CACHE_MAX_ENTRIES = 4000;
    const STYLE_CACHE_MAX_LENGTH = 32 * 1024;
    const styleCache = new Map<string, string>();
    // Sum of the lengths of the stored styles, kept in step with every insert, replace, eviction and reset.
    let styleCacheTotal = 0;

    function cachedStyle(key: string): string | undefined {
        const hit = styleCache.get(key);
        if (hit !== undefined) {
            styleCache.delete(key);
            styleCache.set(key, hit);
        }
        return hit;
    }

    function rememberStyle(key: string, style: string) {
        if (style.length > STYLE_CACHE_MAX_LENGTH || style.includes('url("")') || style.includes('blob:')) {
            return;
        }
        const previous = styleCache.get(key);
        if (previous !== undefined) {
            styleCacheTotal -= previous.length;
            styleCache.delete(key);
        }
        styleCache.set(key, style);
        styleCacheTotal += style.length;
        while (styleCache.size > STYLE_CACHE_MAX_ENTRIES || styleCacheTotal > STYLE_CACHE_MAX_TOTAL) {
            const [oldestKey, oldestStyle] = styleCache.entries().next().value as [string, string];
            styleCache.delete(oldestKey);
            styleCacheTotal -= oldestStyle.length;
        }
    }

    // The abort outcome of a lookup is neither a style nor null; only these two are ever painted or remembered.
    function isResolvedStyle(result: string | null | ThumbAborted): result is string | null {
        return result === null || typeof result === "string";
    }

    export function resetCharListAvatarCacheForTest() {
        styleCache.clear();
        styleCacheTotal = 0;
    }

    export function charListAvatarCacheTotalForTest(): number {
        return styleCacheTotal;
    }

    export const CHAR_LIST_AVATAR_CACHE_MAX_TOTAL = STYLE_CACHE_MAX_TOTAL;
    export const CHAR_LIST_AVATAR_CACHE_MAX_ENTRIES = STYLE_CACHE_MAX_ENTRIES;
    export const CHAR_LIST_AVATAR_CACHE_MAX_LENGTH = STYLE_CACHE_MAX_LENGTH;
</script>

<script lang="ts">
    import { untrack, type Snippet } from "svelte";
    import { getCharImage } from "src/ts/characters";
    import { DBState } from "src/ts/stores.svelte";

    interface Props {
        // The image location of the character; empty for none. The thumbnail lookup runs in
        // this component, so it re-runs only when the location changes.
        src: string;
        // The style shown when there is no image to show (the selected highlight).
        fallbackStyle?: string;
        // With both, the avatar is a button named `label`; without, it is a decorative box.
        onclick?: () => void;
        label?: string;
        class?: string;
        children?: Snippet;
        // Whether the avatar is on screen, read live when the thumbnail queue picks its next task. Without it
        // the avatar counts as visible. It is called outside this component's effects, never tracked by them.
        visible?: () => boolean;
    }

    let { src, fallbackStyle = "", onclick, label, class: className = "", children, visible }: Props = $props();

    // The lookup effect reads no visibility itself: the queue calls this later, and a change of `visible`
    // must not look the image up again.
    const isVisible = () => visible?.() ?? true;

    // The style is tied to the location it was resolved for, so a location change never shows
    // the previous character's picture, and the element itself is never re-created: a button
    // that holds focus keeps it when its picture arrives.
    // The hide-all-images setting changes what a location resolves to, so it is part of the key.
    const key = $derived(src ? `${DBState.db?.hideAllImages ? 1 : 0}|${src}` : "");
    let resolved = $state(untrack(() => {
        const hit = key ? cachedStyle(key) : undefined;
        return { key: hit === undefined ? "" : key, style: hit ?? "" };
    }));
    const style = $derived(src ? (resolved.key === key ? resolved.style : "") : fallbackStyle);

    // An avatar style may still be loading or may have failed to load: either way the avatar shows without it.
    $effect(() => {
        const location = src;
        const lookupKey = key;
        if (!location) {
            return;
        }
        const hit = cachedStyle(lookupKey);
        if (hit !== undefined) {
            resolved = { key: lookupKey, style: hit };
            return;
        }
        let current = true;
        const controller = new AbortController();
        getCharImage(location, "thumbcss", { signal: controller.signal, visible: isVisible }).then((result) => {
            // An abandoned lookup leaves no trace: nothing is painted or remembered, whatever value arrived.
            if (controller.signal.aborted || !isResolvedStyle(result)) {
                return;
            }
            rememberStyle(lookupKey, result ?? "");
            if (current) {
                resolved = { key: lookupKey, style: result ?? "" };
            }
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) {
                console.warn("CharListAvatar: avatar style rejected", error);
            }
        });
        return () => {
            current = false;
            controller.abort();
        };
    });

    const base = "ico shrink-0 flex justify-center items-center rounded-md h-14 w-14 min-h-14 shadow-lg bg-[#6b7280]";
</script>
{#if onclick && label}
    <button class="{base} cursor-pointer hover:bg-[#10b981] transition-colors duration-150 {className}" aria-label={label} style={style || null} {onclick}>
        {@render children?.()}
    </button>
{:else}
    <div class="{base} {className}" aria-hidden="true" style={style || null}></div>
{/if}
