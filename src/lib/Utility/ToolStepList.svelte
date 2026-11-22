<script lang="ts">
    import { language } from 'src/lang'
    import type { ToolStep, ToolStepOutcome } from 'src/ts/process/request/toolLoop'

    let { steps }: { steps: readonly ToolStep[] } = $props()

    // A path or a tool name comes from the model: it is rendered as text only and isolated from the words around it.
    function failed(outcome: ToolStepOutcome): boolean {
        return outcome === 'denied' || outcome === 'refused' || outcome === 'error'
    }
</script>

{#if steps.length > 0}
    <div class="flex flex-col gap-1" data-testid="tool-step-list">
        <div class="text-sm text-textcolor2">{language.utility.steps.heading}</div>
        <ul class="flex flex-col gap-1">
            {#each steps as step, index (index)}
                <li class="flex flex-wrap items-baseline gap-x-2 rounded-md border border-darkborderc px-3 py-1 text-sm" data-testid="tool-step">
                    <bdi class="font-bold" data-testid="tool-step-name">{step.name}</bdi>
                    <span class={failed(step.outcome) ? 'text-draculared' : 'text-textcolor2'} data-testid="tool-step-outcome">{language.utility.steps.outcome[step.outcome]}</span>
                    {#if step.summary !== ''}
                        <bdi class="min-w-0 break-all text-textcolor2" data-testid="tool-step-target">{step.summary}</bdi>
                    {/if}
                </li>
            {/each}
        </ul>
    </div>
{/if}
