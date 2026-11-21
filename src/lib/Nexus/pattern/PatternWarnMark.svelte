<script lang="ts">
    import type { PatternSeverity } from './patternWarning'

    interface Props {
        severity: PatternSeverity
    }

    let { severity }: Props = $props()
</script>

<!-- The shape of the mark carries the severity too, so it never relies on the edge colour alone. -->
<svg class="pattern-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    {#if severity === 'notice'}
        <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
    {:else if severity === 'caution'}
        <path d="M12 3 22 20H2Z" /><path d="M12 10v4M12 17h.01" />
    {:else if severity === 'confirm'}
        <rect x="3" y="3" width="18" height="18" rx="5" /><path d="m8 12 3 3 5-6" />
    {:else if severity === 'danger'}
        <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8Z" /><path d="M12 7v6M12 16.5h.01" />
    {:else}
        <circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" />
    {/if}
</svg>
