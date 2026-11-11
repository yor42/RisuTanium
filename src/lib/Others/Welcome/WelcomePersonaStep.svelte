<script lang="ts">
    import { language } from 'src/lang'
    import { useCharImageLookups } from 'src/ts/media/charImageLookups'
    import { createEnterKeyController } from 'src/ts/chatShell/enterKey'
    import { selectUserImg } from 'src/ts/persona'
    import { DBState } from 'src/ts/stores.svelte'
    import type { WelcomeFlow } from './welcomeFlow.svelte'

    /** `persona` for stories and both (name, description, picture); `nickname` for tools (a yes or no, then a nickname). */
    let { flow, mode }: { flow: WelcomeFlow, mode: 'persona' | 'nickname' } = $props()

    // The picture keeps one hold until the step goes away.
    const lookups = useCharImageLookups()

    // The name and nickname inputs never coexist, so one controller serves whichever is mounted.
    const enter = createEnterKeyController()

    function advanceOnEnter(e: KeyboardEvent): void {
        // Only a composing keydown is left to the IME; the Enter after compositionend is the user's press and advances.
        if (enter.shouldSend(e, 'send')) {
            e.preventDefault()
            flow.next()
        }
    }

    async function choosePicture(): Promise<void> {
        await selectUserImg()
        flow.pictureChosen()
    }
</script>

{#if mode === 'persona'}
    <h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{language.onboarding.personaTitle}</h2>
    <p class="text-textcolor2 mt-2">{language.onboarding.personaLead}</p>

    <div class="mt-4 flex items-center gap-4">
        {#if flow.keepPicture && DBState.db.userIcon !== ''}
            {#await lookups.get('user', DBState.db.userIcon, 'css')}
                <div class="rounded-md h-20 w-20 shrink-0 bg-darkbg"></div>
            {:then style}
                <div class="rounded-md h-20 w-20 shrink-0 bg-darkbg" style={style ?? undefined} data-persona-picture></div>
            {:catch}
                <div class="rounded-md h-20 w-20 shrink-0 bg-darkbg"></div>
            {/await}
        {:else}
            <div class="rounded-md h-20 w-20 shrink-0 bg-darkbg"></div>
        {/if}
        <div class="flex flex-wrap gap-2">
            <button
                type="button"
                class="min-h-11 px-4 rounded-md border border-darkborderc hover:bg-bgcolor disabled:opacity-50"
                disabled={flow.finishing}
                onclick={choosePicture}
            >{language.onboarding.choosePicture}</button>
            {#if flow.keepPicture}
                <button
                    type="button"
                    class="min-h-11 px-4 rounded-md text-textcolor2 hover:text-textcolor disabled:opacity-50"
                    disabled={flow.finishing}
                    onclick={() => flow.removePicture()}
                >{language.onboarding.removePicture}</button>
            {/if}
        </div>
    </div>

    <label class="flex flex-col gap-1 mt-4">
        <span class="text-sm text-textcolor2">{language.name}</span>
        <input
            type="text"
            class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor"
            bind:value={flow.name}
            disabled={flow.finishing}
            autocomplete="off"
            onkeydown={advanceOnEnter}
        />
    </label>
    <label class="flex flex-col gap-1 mt-4">
        <span class="text-sm text-textcolor2">{language.description}</span>
        <textarea
            class="min-h-24 p-3 rounded-md border border-darkborderc bg-transparent text-textcolor"
            bind:value={flow.description}
            disabled={flow.finishing}
        ></textarea>
    </label>
    {#if flow.name.trim() !== ''}
        <p class="mt-3 text-textcolor2" aria-hidden="true">{language.onboarding.niceToMeet(flow.name.trim())}</p>
    {/if}
    <div class="mt-4">
        <button
            type="button"
            class="min-h-11 px-4 rounded-md text-textcolor2 hover:text-textcolor disabled:opacity-50"
            disabled={flow.finishing}
            onclick={() => flow.skipPersona()}
        >{language.onboarding.skip}</button>
    </div>
{:else}
    <h2 class="text-2xl font-bold outline-hidden" tabindex="-1" data-step-heading>{language.onboarding.nicknameQuestion}</h2>
    <!-- Nothing is preselected: Continue stays disabled until the question is answered. -->
    <fieldset class="mt-4 border-none p-0 m-0 min-w-0" disabled={flow.finishing}>
        <legend class="sr-only">{language.onboarding.nicknameQuestion}</legend>
        <div class="flex flex-col gap-2">
            <label class="flex items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input type="radio" name="welcome-nickname" value="yes" checked={flow.wantsNickname === true} onchange={() => { flow.wantsNickname = true }} />
                <span>{language.onboarding.yes}</span>
            </label>
            <label class="flex items-center gap-3 min-h-11 px-3 rounded-md border border-darkborderc cursor-pointer has-checked:border-selected has-checked:bg-bgcolor">
                <input type="radio" name="welcome-nickname" value="no" checked={flow.wantsNickname === false} onchange={() => { flow.wantsNickname = false }} />
                <span>{language.onboarding.no}</span>
            </label>
        </div>
    </fieldset>
    {#if flow.wantsNickname === true}
        <label class="flex flex-col gap-1 mt-4">
            <span class="text-sm text-textcolor2">{language.nickname}</span>
            <input
                type="text"
                class="min-h-11 px-3 rounded-md border border-darkborderc bg-transparent text-textcolor"
                bind:value={flow.name}
                disabled={flow.finishing}
                autocomplete="off"
                onkeydown={advanceOnEnter}
            />
        </label>
        {#if flow.name.trim() !== ''}
            <p class="mt-3 text-textcolor2" aria-hidden="true">{language.onboarding.niceToMeet(flow.name.trim())}</p>
        {/if}
    {/if}
{/if}
