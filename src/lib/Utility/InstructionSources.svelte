<script lang="ts">
    import { language } from 'src/lang'
    import type { InstructionSummary } from 'src/ts/process/utility/utilityConversation.svelte'
    import { escapeBidiControls } from 'src/ts/process/mcp/bidiEscape'

    let { sources }: { sources: InstructionSummary | null } = $props()

    const empty = $derived(sources !== null && sources.agentsPaths.length === 0 && sources.skills.length === 0 && sources.damaged.length === 0)
</script>

<!-- Paths, skill names and descriptions come from workspace files: they are rendered as text only and isolated from the words around them. -->
{#if sources !== null}
    <details class="rounded-md border border-darkborderc px-3 text-sm" data-testid="instruction-sources">
        <summary class="min-h-11 cursor-pointer content-center text-textcolor2" data-testid="instruction-sources-summary">
            {language.utility.sources.heading}: {language.utility.sources.summary(sources.agentsPaths.length, sources.skills.length)}
        </summary>
        <div class="flex flex-col gap-2 pb-2">
            {#if empty}
                <p class="text-textcolor2" data-testid="instruction-sources-none">{language.utility.sources.none}</p>
            {/if}
            {#if sources.agentsPaths.length > 0}
                <div>
                    <div class="text-textcolor2">{language.utility.sources.agentsHeading}</div>
                    <ul class="list-disc pl-6">
                        {#each sources.agentsPaths as path (path)}
                            <li><bdi class="break-all" data-testid="instruction-agents-path">{escapeBidiControls(path)}</bdi></li>
                        {/each}
                    </ul>
                </div>
            {/if}
            {#if sources.skills.length > 0}
                <div>
                    <div class="text-textcolor2">{language.utility.sources.skillsHeading}</div>
                    <ul class="list-disc pl-6">
                        {#each sources.skills as skill (skill.path)}
                            <li data-testid="instruction-skill">
                                <bdi class="font-bold break-words" data-testid="instruction-skill-name">{skill.name !== null && skill.name !== undefined ? escapeBidiControls(skill.name) : language.utility.sources.skillUnnamed}</bdi>
                                <bdi class="break-all text-textcolor2" data-testid="instruction-skill-path">{escapeBidiControls(skill.path)}</bdi>
                                {#if skill.description}
                                    <bdi class="block break-words text-textcolor2" data-testid="instruction-skill-description">{escapeBidiControls(skill.description)}</bdi>
                                {/if}
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}
            {#if sources.truncated}
                <p class="text-draculared" data-testid="instruction-truncated">{language.utility.sources.truncatedNote}</p>
            {/if}
            {#if sources.damaged.length > 0}
                <div class="rounded-md border border-draculared p-2" data-testid="instruction-damaged">
                    <div class="text-draculared">{language.utility.sources.damagedHeading}</div>
                    <ul class="list-disc pl-6">
                        {#each sources.damaged as path (path)}
                            <li><bdi class="break-all">{escapeBidiControls(path)}</bdi></li>
                        {/each}
                    </ul>
                </div>
            {/if}
        </div>
    </details>
{/if}
