<script lang="ts">
    // A one-line note over the transcript: never in the layout, never hit by a pointer, and announced by the shell, not by itself.
    interface Props { line: string }
    let { line }: Props = $props()
</script>

<div data-part="chat-long-hint" aria-hidden="true">{line}</div>

<style>
    [data-part="chat-long-hint"] { position: absolute; z-index: calc(var(--pattern-z-layer) - 1); bottom: var(--size-37); left: var(--space-10); max-width: calc(100% - var(--space-10) * 2); padding: var(--space-5) var(--space-10); border-radius: var(--radius-pill); background: var(--nexus-surface-raised); color: var(--nexus-text); border: 1px solid var(--nexus-edge); pointer-events: none; user-select: none; animation: long-chat-hint-in var(--chat-dur-fast) var(--chat-ease-out) both; }
    @keyframes long-chat-hint-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { :global(html:not(.rm-off)) [data-part="chat-long-hint"] { animation: none; } }
    :global(html.rm) [data-part="chat-long-hint"], :global(html[data-low-power]) [data-part="chat-long-hint"], :global(html.nexus-low-power) [data-part="chat-long-hint"] { animation: none; }
</style>
