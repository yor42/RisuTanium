<script lang="ts">
    import LogOutIcon from '@lucide/svelte/icons/log-out'
    import { language } from '../../../lang'
    import { quitPill, QUIT_PILL_LEAVE_MS } from '../../../ts/quitPill.svelte'
</script>

<!-- The region persists, so a screen reader reads each inserted pill once. The pill takes no focus and no pointer. -->
<div
    class="quit-pill-region"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-part="quit-pill-region"
>
    {#if quitPill.phase !== 'hidden'}
        {#key quitPill.seq}
            <div
                class="quit-pill"
                data-part="quit-pill"
                data-leaving={quitPill.phase === 'leaving' ? '' : undefined}
                style:--quit-pill-leave="{QUIT_PILL_LEAVE_MS}ms"
            >
                <LogOutIcon size={18} aria-hidden="true" />
                <span>{language.alerts.pressBackAgainToQuit}</span>
            </div>
        {/key}
    {/if}
</div>

<style>
    .quit-pill-region {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        max-width: min(90vw, 360px);
        z-index: var(--pattern-z-toast);
        pointer-events: none;
    }

    .quit-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        border-radius: 9999px;
        background: var(--nexus-surface-flat);
        color: var(--nexus-text);
        opacity: 1;
        transition: opacity var(--quit-pill-leave) linear;
        animation: quit-pill-rise 150ms ease-out;
    }

    .quit-pill[data-leaving] {
        opacity: 0;
    }

    @keyframes quit-pill-rise {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: none; }
    }

    @keyframes quit-pill-fade {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @media (prefers-reduced-motion: reduce) {
        .quit-pill { animation-name: quit-pill-fade; }
    }
</style>
