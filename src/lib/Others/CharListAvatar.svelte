<script module lang="ts">
    // Resolved avatar styles by lookup key, so a tile that is created again (its row regrouped by a search or a
    // column change) paints at once and asks for nothing. Bounded: the least recently used entry goes first.
    // Only a lookup that resolved is stored; a failure is never remembered. A style that carries a whole file
    // (a data: URL for an animated avatar or a skipped thumbnail) is not stored either, since this cache sits
    // outside the file cache's byte budget: an entry is kept only up to STYLE_CACHE_MAX_LENGTH UTF-16 units,
    // which every thumbnail fits under. A style with an empty URL (the file source failed) is not stored; the
    // empty style of hide-all-images has no URL and is.
    const STYLE_CACHE_LIMIT = 300;
    const STYLE_CACHE_MAX_LENGTH = 32 * 1024;
    const styleCache = new Map<string, string>();

    function cachedStyle(key: string): string | undefined {
        const hit = styleCache.get(key);
        if (hit !== undefined) {
            styleCache.delete(key);
            styleCache.set(key, hit);
        }
        return hit;
    }

    function rememberStyle(key: string, style: string) {
        if (style.length > STYLE_CACHE_MAX_LENGTH || style.includes('url("")')) {
            return;
        }
        styleCache.delete(key);
        styleCache.set(key, style);
        while (styleCache.size > STYLE_CACHE_LIMIT) {
            styleCache.delete(styleCache.keys().next().value as string);
        }
    }

    export function resetCharListAvatarCacheForTest() {
        styleCache.clear();
    }

    export const CHAR_LIST_AVATAR_CACHE_LIMIT = STYLE_CACHE_LIMIT;
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
    }

    let { src, fallbackStyle = "", onclick, label, class: className = "", children }: Props = $props();

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
        getCharImage(location, "thumbcss").then((result) => {
            rememberStyle(lookupKey, result ?? "");
            if (current) {
                resolved = { key: lookupKey, style: result ?? "" };
            }
        }).catch((error: unknown) => {
            console.warn("CharListAvatar: avatar style rejected", error);
        });
        return () => {
            current = false;
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
