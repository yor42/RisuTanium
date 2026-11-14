<script lang="ts">
    import CornerUpLeftIcon from '@lucide/svelte/icons/corner-up-left'
    import { language } from '../../lang'
    import type { ChipHold } from '../../ts/chatShell/returnChip'

    // The chip is drawn only while a return point exists; the shell owns when it leaves. Hover and focus are reported so a reader
    // who is looking at it is not raced by its timer.
    interface Props { onreturn: () => void; onhold: (kind: ChipHold, on: boolean) => void }
    let { onreturn, onhold }: Props = $props()
</script>

<button type="button" data-part="chat-return-chip" onclick={onreturn} onpointerenter={() => onhold('hover', true)} onpointerleave={() => onhold('hover', false)} onfocus={() => onhold('focus', true)} onblur={() => onhold('focus', false)}><CornerUpLeftIcon aria-hidden="true" />{language.chatShellGoBack}</button>

<style>
    [data-part="chat-return-chip"] { position: absolute; z-index: calc(var(--pattern-z-layer) - 1); bottom: var(--size-37); left: 0; right: 0; margin-inline: auto; width: max-content; display: flex; align-items: center; gap: var(--space-5); min-height: var(--size-touch); padding: 0 var(--space-10); border-radius: var(--radius-pill); background: var(--nexus-surface-raised); color: var(--nexus-text); border: 1px solid var(--nexus-edge); animation: return-chip-in var(--chat-dur-fast) var(--chat-ease-out) both; }
    [data-part="chat-return-chip"]:focus-visible { outline: var(--stroke-bold) solid var(--nexus-text); }
    @keyframes return-chip-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-return-chip"] { animation: none; } }
    :global(html.rm) [data-part="chat-return-chip"], :global(html[data-low-power]) [data-part="chat-return-chip"], :global(html.nexus-low-power) [data-part="chat-return-chip"] { animation: none; }
</style>
