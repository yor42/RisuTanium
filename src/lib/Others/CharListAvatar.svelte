<script lang="ts">
    import type { Snippet } from "svelte";
    import { getCharImage } from "src/ts/characters";

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
    let resolved = $state({ src: "", style: "" });
    const style = $derived(src ? (resolved.src === src ? resolved.style : "") : fallbackStyle);

    // An avatar style may still be loading or may have failed to load: either way the avatar shows without it.
    $effect(() => {
        const location = src;
        if (!location) {
            return;
        }
        let current = true;
        getCharImage(location, "thumbcss").then((result) => {
            if (current) {
                resolved = { src: location, style: result ?? "" };
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
