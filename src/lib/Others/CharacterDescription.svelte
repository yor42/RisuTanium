<script lang="ts">
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme";
    import { cachedDescriptionHtml, renderDescription } from "src/ts/gui/descriptionMarkdown";
    import { clampOverflow } from "src/ts/gui/clampOverflow.svelte";
    import { previewCut } from "src/ts/gui/descriptionPreview";

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

    // `source` is what the parser receives. A clamped row of a long note that
    // `previewCut` can cut safely parses only the prefix; the full note is
    // parsed when the row is expanded, or when the prefix does not fill the
    // clamp (`escalatedFor` remembers that for this text).
    let rendered = $state<{ text: string; source: string; html: string } | null>(null);
    let escalatedFor = $state<string | null>(null);
    let measured = $state<HTMLElement | null>(null);
    const cut = $derived(previewCut(text));
    const source = $derived(!clamped || cut === null || escalatedFor === text ? text : text.slice(0, cut));
    const html = $derived(rendered !== null && rendered.text === text ? rendered.html : null);
    const needsMeasure = $derived(visible && (onClampChange !== undefined || cut !== null));
    // The rendered source's length is part of the key: an escalation from the
    // prefix to the full note re-measures even when both give the same HTML.
    const measureKey = $derived((clamped ? 'clamped:' : 'open:') + (html !== null && rendered !== null ? rendered.source.length + ':' + html : text));

    // A prefix that is not taller than the clamp may hide more note below it:
    // the row then renders the full note and measures again. That escalating
    // answer is not forwarded, so the toggle never flickers off and on.
    function onMeasured(over: boolean): void {
        if (!over && clamped && cut !== null && escalatedFor !== text && rendered !== null && rendered.text === text
            && rendered.source !== text && measured !== null && measured.clientHeight > 0) {
            escalatedFor = text;
            return;
        }
        onClampChange?.(over);
    }

    $effect(() => {
        const owner = text;
        const wanted = source;
        if (!visible) {
            return;
        }
        const hit = cachedDescriptionHtml(wanted);
        if (hit !== undefined) {
            rendered = { text: owner, source: wanted, html: hit };
            return;
        }
        let current = true;
        renderDescription(wanted).then((result) => {
            if (current) {
                rendered = { text: owner, source: wanted, html: result };
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
    bind:this={measured} use:clampOverflow={{ text: measureKey, onChange: needsMeasure ? onMeasured : undefined }}>
    {#if html !== null}
        <div class="prose prose-sm max-w-none leading-6 wrap-break-word prose-p:my-0 prose-p:leading-6 prose-headings:my-0 prose-headings:text-base prose-headings:leading-6 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-pre:my-0 prose-blockquote:my-0 [--tw-prose-body:var(--risu-theme-textcolor2)] [--tw-prose-invert-body:var(--risu-theme-textcolor2)] [--tw-prose-headings:var(--risu-theme-textcolor)] [--tw-prose-invert-headings:var(--risu-theme-textcolor)] [--tw-prose-bold:var(--risu-theme-textcolor)] [--tw-prose-invert-bold:var(--risu-theme-textcolor)] [--tw-prose-links:var(--risu-theme-textcolor)] [--tw-prose-invert-links:var(--risu-theme-textcolor)]" class:prose-invert={$ColorSchemeTypeStore}>
            {@html html}
        </div>
    {:else}
        {text}
    {/if}
</div>
