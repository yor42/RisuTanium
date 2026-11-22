<script lang="ts">
    import { language } from 'src/lang'
    import type { ToolApprovalView } from 'src/ts/alert'

    /**
     * The dialog of a model-driven tool call. Every string comes from a model's tool arguments and renders as text only,
     * never as markup; each path sits in its own isolated run so a bidi control in it cannot reorder the words around it.
     * The long parts (the call, an edit's replacement) show their first 400 code points until expanded and scroll inside
     * half the screen, so the buttons stay in view. Allow once answers `once`, the always button (only when offered)
     * answers `always`, Deny answers `deny`. A press inside the prompt's answer guard is discarded by the prompt queue.
     */
    interface Props {
        view: ToolApprovalView
        messageId: string
        onanswer: (message: 'once' | 'always' | 'server' | 'deny') => void
    }

    const PREVIEW_CODE_POINTS = 400

    let { view, messageId, onanswer }: Props = $props()

    let expanded = $state(false)

    function preview(text: string, open: boolean): { text: string, clipped: boolean } {
        if (open || text.length <= PREVIEW_CODE_POINTS) {
            return { text, clipped: false }
        }
        const points = Array.from(text)
        return points.length > PREVIEW_CODE_POINTS
            ? { text: `${points.slice(0, PREVIEW_CODE_POINTS).join('')}...`, clipped: true }
            : { text, clipped: false }
    }

    const summary = $derived(preview(view.summary, expanded))
    const replacement = $derived(view.replacement === null ? null : preview(view.replacement, expanded))
    const collapsible = $derived(summary.clipped || (replacement?.clipped ?? false) || expanded)
</script>

<div id={messageId} class="flex flex-col gap-3 text-left" data-tool-approval>
    <div class="flex flex-col gap-3 max-h-[50vh] overflow-y-auto" data-tool-approval-body>
        <div class="text-sm text-textcolor2 break-all" data-tool-approval-server><bdi>{view.server}</bdi></div>
        {#if view.action.length > 0}
            <div class="text-base text-textcolor whitespace-pre-wrap break-words" data-tool-approval-action>{#each view.action as part}{#if part.path}<bdi class="font-mono">{part.text}</bdi>{:else}{part.text}{/if}{/each}</div>
        {/if}
        {#if view.instructionTarget}
            <div class="text-sm text-textcolor border border-draculared rounded-md p-2" role="note" data-tool-approval-instructions>{language.toolApprovalInstructionsWarning}</div>
        {/if}
        <div class="whitespace-pre-wrap break-words border border-darkborderc rounded-md bg-darkbg text-textcolor text-sm leading-relaxed p-2 [unicode-bidi:isolate]" data-tool-approval-summary>{summary.text}</div>
        {#if replacement !== null}
            <div class="flex flex-col gap-1">
                <div class="text-sm text-textcolor2">{language.toolApprovalReplacement}</div>
                {#if replacement.text === ''}
                    <div class="text-sm text-textcolor2" data-tool-approval-replacement-empty>{language.toolApprovalReplacementEmpty}</div>
                {:else}
                    <div class="whitespace-pre-wrap break-words border border-darkborderc rounded-md bg-darkbg text-textcolor text-sm leading-relaxed p-2 [unicode-bidi:isolate]" data-tool-approval-replacement>{replacement.text}</div>
                {/if}
            </div>
        {/if}
        {#if collapsible}
            <button type="button" class="self-start min-h-[44px] px-2 text-sm text-textcolor2 underline" aria-expanded={expanded} data-tool-approval-expand onclick={() => (expanded = !expanded)}>{expanded ? language.toolApprovalShowLess : language.toolApprovalShowMore}</button>
        {/if}
    </div>
    <div class="flex flex-col gap-2" data-tool-approval-actions>
        <button type="button" class="pattern-button w-full min-h-[44px]" data-variant="confirm" data-tool-approval-once onclick={() => onanswer('once')}>{language.toolApprovalAllowOnce}</button>
        {#if view.offerAlways}
            <button type="button" class="pattern-button w-full min-h-[44px]" data-tool-approval-always onclick={() => onanswer('always')}>{language.toolApprovalAllowAlways}</button>
        {/if}
        {#if view.offerServer}
            <button type="button" class="pattern-button w-full min-h-[44px]" data-tool-approval-server onclick={() => onanswer('server')}>{language.toolApprovalAllowServer}</button>
        {/if}
        <button type="button" class="pattern-button w-full min-h-[44px]" data-variant="secondary" data-tool-approval-deny onclick={() => onanswer('deny')}>{language.toolApprovalDeny}</button>
    </div>
</div>
