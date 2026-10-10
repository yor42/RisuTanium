<script lang="ts">
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme";
    import { cachedDescriptionHtml, renderDescription } from "src/ts/gui/descriptionMarkdown";
    import { clampOverflow } from "src/ts/gui/clampOverflow.svelte";

    interface Props {
        // The description as plain markdown source.
        text: string;
        // True once the row is near the viewport. Before that the source is
        // shown as plain text, so a long list does not parse every description
        // when it opens.
        visible: boolean;
        // Cuts the block at three lines of height. Cutting by height (not by
        // `line-clamp`) is what makes paragraphs, lists and headings clamp the
        // same way; the last visible line may be cut mid-line.
        clamped?: boolean;
        // Receives whether the clamp hides content, measured on the rendered
        // block. Only given by a caller that offers a toggle; without it the
        // block is never measured.
        onClampChange?: (clamped: boolean) => void;
    }

    let { text, visible, clamped = true, onClampChange }: Props = $props();

    let rendered = $state<{ text: string; html: string } | null>(null);
    const html = $derived(rendered !== null && rendered.text === text ? rendered.html : null);

    $effect(() => {
        const source = text;
        if (!visible) {
            return;
        }
        const hit = cachedDescriptionHtml(source);
        if (hit !== undefined) {
            rendered = { text: source, html: hit };
            return;
        }
        let current = true;
        renderDescription(source).then((result) => {
            if (current) {
                rendered = { text: source, html: result };
            }
        }).catch((error: unknown) => {
            console.warn('CharacterDescription: markdown render failed; showing plain text.', error);
        });
        return () => {
            current = false;
        };
    });
</script>
<div data-description class="text-textcolor2 leading-6 wrap-break-word" class:max-h-18={clamped} class:overflow-hidden={clamped}
    use:clampOverflow={{ text: (clamped ? 'clamped:' : 'open:') + (html ?? text), onChange: visible ? onClampChange : undefined }}>
    {#if html !== null}
        <div class="prose prose-sm max-w-none leading-6 wrap-break-word prose-p:my-0 prose-p:leading-6 prose-headings:my-0 prose-headings:text-base prose-headings:leading-6 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-pre:my-0 prose-blockquote:my-0 [--tw-prose-body:var(--risu-theme-textcolor2)] [--tw-prose-invert-body:var(--risu-theme-textcolor2)] [--tw-prose-headings:var(--risu-theme-textcolor)] [--tw-prose-invert-headings:var(--risu-theme-textcolor)] [--tw-prose-bold:var(--risu-theme-textcolor)] [--tw-prose-invert-bold:var(--risu-theme-textcolor)] [--tw-prose-links:var(--risu-theme-textcolor)] [--tw-prose-invert-links:var(--risu-theme-textcolor)]" class:prose-invert={$ColorSchemeTypeStore}>
            {@html html}
        </div>
    {:else}
        {text}
    {/if}
</div>
