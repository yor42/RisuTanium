<script lang="ts" module>
    import { language } from 'src/lang'
    import type { UtilityTurn } from 'src/ts/process/utility/utilityConversation.svelte'

    /** The transcript as Markdown. Turns that carry nothing to show are left out. */
    export function utilityMarkdown(presetName: string | null, turns: readonly UtilityTurn[]): string {
        const parts = [`# ${language.utility.markdownTitle}${presetName ? `: ${presetName}` : ''}`]
        for (const turn of turns) {
            const heading = turn.role === 'user' ? language.utility.roleYou : language.utility.roleAssistant
            const lines: string[] = []
            if (turn.content !== '') {
                lines.push(turn.content)
            }
            if (turn.state === 'failed') {
                lines.push(`_${language.utility.failedPrefix} ${turn.error ?? ''}_`)
            }
            else if (turn.state === 'stopped') {
                lines.push(`_${language.utility.stopped}_`)
            }
            if (lines.length > 0) {
                parts.push(`## ${heading}\n\n${lines.join('\n\n')}`)
            }
        }
        return parts.join('\n\n') + '\n'
    }
</script>

<script lang="ts">
    import { ArrowLeft } from '@lucide/svelte'
    import { fillLang } from 'src/lang/fill'
    import { alertConfirm } from 'src/ts/alert'
    import { copyPlainText } from 'src/ts/chatCopy'
    import { downloadFile } from 'src/ts/globalApi.svelte'
    import { validateTaskPreset } from 'src/ts/process/utility/taskPreset'
    import {
        getUtilityInstructions,
        getUtilitySteps,
        newUtilityConversation,
        sendUtility,
        stopUtility,
        utilityConversation,
        utilitySelection,
    } from 'src/ts/process/utility/utilityConversation.svelte'
    import { DBState } from 'src/ts/stores.svelte'
    import Button from '../UI/GUI/Button.svelte'
    import SelectInput from '../UI/GUI/SelectInput.svelte'
    import InstructionSources from './InstructionSources.svelte'
    import TaskPresetEditor from './TaskPresetEditor.svelte'
    import ToolStepList from './ToolStepList.svelte'
    import { utilityOpen } from './utilityGate'
    import WorkspaceManager from './WorkspaceManager.svelte'
    import WorkspacePicker from './WorkspacePicker.svelte'

    let draft = $state('')
    let editing = $state(false)
    let managing = $state(false)
    let notice = $state('')

    const presets = $derived(DBState.db.taskPresets ?? [])
    const chosen = $derived(presets.find((preset) => preset.id === utilitySelection.presetId))
    const chosenProblems = $derived(chosen ? validateTaskPreset(chosen) : [])
    const running = $derived(utilityConversation.runId !== null)
    const canSend = $derived(!running && chosen !== undefined && chosenProblems.length === 0 && draft.trim() !== '')

    async function send() {
        if (!canSend) {
            return
        }
        const text = draft
        draft = ''
        notice = ''
        await sendUtility(utilitySelection.presetId, text)
    }

    async function startNew() {
        notice = ''
        await newUtilityConversation(() => alertConfirm(language.utility.newConversationConfirm))
    }

    function markdown(): string {
        return utilityMarkdown(utilityConversation.presetName ?? chosen?.name ?? null, utilityConversation.turns)
    }

    function copyMarkdown() {
        copyPlainText(markdown(), (outcome) => {
            notice = outcome.ok ? language.utility.copied : language.utility.copyFailed
        })
    }

    async function saveMarkdown() {
        notice = ''
        await downloadFile(language.utility.markdownFileName, markdown())
    }
</script>

<div class="flex h-full w-full flex-col items-center overflow-y-auto" data-testid="utility-screen">
    <div class="flex w-full max-w-4xl flex-col gap-3 p-4 text-textcolor">
        <div class="flex items-center gap-2">
            <button class="mr-2 flex min-h-11 min-w-11 items-center justify-center text-textcolor2 hover:text-green-500" aria-label={language.utility.back} onclick={() => utilityOpen.set(false)}>
                <ArrowLeft />
            </button>
            <h1 class="text-2xl font-bold">{language.utility.title}</h1>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            {#if presets.length > 0}
                <span id="utility-preset-label" class="text-textcolor2">{language.utility.presetLabel}</span>
                <SelectInput labelId="utility-preset-label" bind:value={utilitySelection.presetId} className="min-w-48">
                    <option value="" disabled>{language.utility.presetLabel}</option>
                    {#each presets as preset (preset.id)}
                        <option value={preset.id}>
                            {validateTaskPreset(preset).length > 0
                                ? fillLang(language.utility.damagedOption, { name: preset.name })
                                : preset.name || language.utility.editor.untitled}
                        </option>
                    {/each}
                </SelectInput>
            {:else}
                <span class="text-textcolor2" data-testid="utility-no-presets">{language.utility.noPresets}</span>
            {/if}
            <Button className="min-h-11" styled="outlined" onclick={() => { editing = !editing }}>
                {editing ? language.utility.doneEditing : language.utility.editPresets}
            </Button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <WorkspacePicker />
            <Button className="min-h-11" styled="outlined" onclick={() => { managing = !managing }}>
                {managing ? language.utility.workspaces.doneManaging : language.utility.workspaces.manage}
            </Button>
        </div>

        {#if managing}
            <WorkspaceManager />
        {/if}

        {#if chosenProblems.length > 0}
            <div class="rounded-md border border-draculared p-2 text-draculared" role="alert" data-testid="utility-damaged-preset">
                <p>{language.utility.damagedPreset}</p>
                <ul class="list-disc pl-6">
                    {#each chosenProblems as problem}
                        <li>{problem}</li>
                    {/each}
                </ul>
            </div>
        {/if}

        {#if editing}
            <TaskPresetEditor />
        {/if}

        <p class="text-sm text-textcolor2" data-testid="utility-not-saved">{language.utility.notSavedNote}</p>

        <div class="flex flex-col gap-3" data-testid="utility-turns">
            {#each utilityConversation.turns as turn}
                <div class="rounded-md border border-darkborderc bg-darkbg p-3">
                    <div class="mb-1 text-sm text-textcolor2">
                        {turn.role === 'user' ? language.utility.roleYou : language.utility.roleAssistant}
                    </div>
                    <!-- Reply text is shown as plain text only; it is never parsed as markup. -->
                    <div class="whitespace-pre-wrap break-words" data-testid="utility-turn-text">{turn.content}</div>
                    {#if turn.state === 'streaming' && turn.content === ''}
                        <div class="text-textcolor2">{language.utility.waiting}</div>
                    {:else if turn.state === 'stopped'}
                        <div class="text-textcolor2" data-testid="utility-turn-stopped">{language.utility.stopped}</div>
                    {:else if turn.state === 'failed'}
                        <div class="text-draculared" role="alert" data-testid="utility-turn-error">{language.utility.failedPrefix} {turn.error}</div>
                    {/if}
                </div>
            {/each}
        </div>

        <InstructionSources sources={getUtilityInstructions()} />
        <ToolStepList steps={getUtilitySteps()} />

        <span id="utility-input-label" class="sr-only">{language.utility.messagePlaceholder}</span>
        <textarea
            class="min-h-24 w-full resize-y rounded-md border border-darkborderc bg-transparent px-4 py-2 text-textcolor focus:border-borderc focus:outline-hidden risu-focus-ring"
            placeholder={language.utility.messagePlaceholder}
            aria-labelledby="utility-input-label"
            aria-describedby="utility-input-label"
            data-testid="utility-input"
            bind:value={draft}
        ></textarea>

        <div class="flex flex-wrap items-center gap-2">
            {#if running}
                <Button className="min-h-11" styled="danger" onclick={stopUtility}>{language.utility.stop}</Button>
            {:else}
                <Button className="min-h-11" disabled={!canSend} onclick={send}>{language.utility.send}</Button>
            {/if}
            <Button className="min-h-11" styled="outlined" onclick={startNew}>{language.utility.newConversation}</Button>
            <Button className="min-h-11" styled="outlined" disabled={utilityConversation.turns.length === 0} onclick={copyMarkdown}>{language.utility.copyMarkdown}</Button>
            <Button className="min-h-11" styled="outlined" disabled={utilityConversation.turns.length === 0} onclick={saveMarkdown}>{language.utility.saveMarkdown}</Button>
            {#if notice}
                <span class="text-sm text-textcolor2" role="status">{notice}</span>
            {/if}
        </div>
    </div>
</div>
