<script lang="ts">
    import { BanIcon, BookIcon, FlagIcon, ImageIcon, PaperclipIcon, SmileIcon, XIcon } from "@lucide/svelte";
    import { untrack } from "svelte";
    import { language } from "src/lang";
    import { fillLang } from "src/lang/fill";
    import { alertConfirm, alertInput, alertNormal } from "src/ts/alert";
    import { ALERT_INPUT_CANCEL } from "src/ts/alertCancel";
    import { copyPlainText } from "src/ts/chatCopy";
    import { hubURL, type hubType, downloadRisuHub, getRealmInfo } from "src/ts/characterCards";
    import { askUpstreamAgreement } from "src/ts/upstreamAgreement";

    import { get } from "svelte/store";
    import { DBState, alertStore } from 'src/ts/stores.svelte';
    import { coversPage } from "src/ts/alertEscape";
    import RealmLicense from "./RealmLicense.svelte";
    import MultiLangDisplay from "../GUI/MultiLangDisplay.svelte";
    import { tooltip } from "src/ts/gui/tooltip";
    import { addBlockedRealmCreator } from "src/ts/realmBlocking";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";
    import { isTopmostShell, makeInert, registerShell, returnFocus, trapTab, watchFocus } from "src/lib/Nexus/pattern/patternFocus";

    interface Props {
        openedData: hubType;
        onBlock?: (creatorId: string) => void;
    }

    let { openedData = $bindable(), onBlock = () => {} }: Props = $props();

    let layer:HTMLElement|undefined = $state()
    let panel:HTMLElement|undefined = $state()
    let closeButton:HTMLElement|undefined = $state()
    // Mirrors the More disclosure; its actions are hidden while it is closed, so the Tab trap skips
    // controls the browser cannot focus.
    let moreOpen = $state(false)

    const token = {}
    // The control that opened this dialog; focus returns to it on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // The backdrop click, the close button, Escape and Back all run this. The same component serves
    // the App-level popup and the Realm tab.
    function closePopUp() {
        openedData = null
    }

    /** Every sibling along the path from `node` up to the enclosing `<main>` (or the body). */
    function backgroundOf(node: HTMLElement): HTMLElement[] {
        const held: HTMLElement[] = []
        let current = node
        for (let parent = current.parentElement; parent && parent !== document.body; parent = current.parentElement) {
            for (const sibling of Array.from(parent.children)) {
                if (sibling !== current && sibling instanceof HTMLElement) held.push(sibling)
            }
            if (parent.tagName === 'MAIN') break
            current = parent
        }
        return held
    }

    // While open: Back and Escape close this dialog first, the shell holds a modal layer, the page
    // behind goes inert, focus starts on the close button and Tab stays inside the panel. Teardown
    // undoes all of it in reverse and returns focus last, once the page is no longer inert.
    $effect(() => {
        const shell = panel
        const area = layer
        const initial = closeButton
        if (!shell || !area || !initial) return
        const unregisterBack = registerBackHandler(backCloseHandler({
            isOpen: () => openedData !== null && openedData !== undefined,
            snapshot: () => openedData === null || openedData === undefined,
            close: closePopUp,
        }))
        const unregisterShell = registerShell(token)
        const restoreInert = makeInert(backgroundOf(area))
        initial.focus()
        const stopWatching = watchFocus(shell, initial, () => isTopmostShell(token))

        const onKeyDown = (event: KeyboardEvent) => {
            // Report and Block raise an alert over this dialog; while one covers the page its own Esc
            // and Tab rules apply, so closing here would leave the alert's pending answer without a card.
            if (coversPage(get(alertStore).type)) return
            if (!isTopmostShell(token)) return
            if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                if (!event.repeat && !event.isComposing) closePopUp()
                return
            }
            trapTab(event, shell)
        }
        window.addEventListener('keydown', onKeyDown, true)

        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            stopWatching()
            unregisterBack()
            unregisterShell()
            restoreInert()
            untrack(() => returnFocus(opener))
        }
    })

</script>


{#if openedData}
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div bind:this={layer} class="top-0 left-0 z-50 fixed w-full h-full bg-black/50 flex justify-center items-center p-2 sm:p-4 text-textcolor" onclick={(e) => {
    if(e.target === e.currentTarget){
        closePopUp()
    }
}}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        bind:this={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="realm-popup-title"
        tabindex="-1"
        class="p-4 sm:p-6 max-w-full w-3xl bg-darkbg rounded-[18px] flex flex-col gap-4 overflow-y-auto max-h-full outline-hidden"
        onclick={(e) => e.stopPropagation()}
    >
        <div class="flex items-start justify-between gap-4">
            <div class="flex min-w-0 flex-col">
                <h1 id="realm-popup-title" class="text-2xl font-bold line-clamp-2 wrap-anywhere">{openedData.name}</h1>
                {#if openedData.authorname}
                    <span class="text-textcolor2 wrap-anywhere">{fillLang(language.uiCommon.madeBy, { name: openedData.authorname })}</span>
                {/if}
                {#if openedData.original}
                    <button type="button" class="risu-focus-ring min-h-11 self-start text-textcolor2 underline text-start" onclick={() => {
                        const original = openedData.original
                        openedData = null
                        getRealmInfo(original)
                    }}>{language.uiCommon.forked}</button>
                {/if}
            </div>
            <button
                type="button"
                bind:this={closeButton}
                class="risu-focus-ring flex size-11 shrink-0 items-center justify-center rounded-md text-textcolor2 hover:bg-selected/50"
                onclick={closePopUp}
                aria-label={language.uiCommon.close}
            >
                <XIcon aria-hidden="true" />
            </button>
        </div>

        <div class="flex min-w-0 flex-col gap-4 sm:flex-row">
            {#if DBState.db.hideAllImages}
                <div class="h-40 w-full sm:h-auto sm:w-60 sm:aspect-3/4 shrink-0 rounded-xl bg-darkbutton flex items-center justify-center text-textcolor2">
                    <span class="text-4xl">?</span>
                </div>
            {:else}
                <img class="w-full max-h-72 sm:max-h-none sm:w-60 shrink-0 self-start aspect-3/4 rounded-xl object-top object-cover" alt={openedData.name} src={`${hubURL}/resource/` + openedData.img}>
            {/if}
            <div class="flex min-w-0 grow flex-col gap-4">
                <section class="flex min-w-0 flex-col gap-1">
                    <h2 class="text-lg font-bold">{language.realmDescriptionHeading}</h2>
                    <div data-testid="realm-popup-description" class="min-w-0 max-w-full wrap-anywhere">
                        <MultiLangDisplay value={openedData.desc} markdown={true} />
                    </div>
                </section>
                <RealmLicense license={openedData.license}/>

                {#if openedData.tags.length > 0}
                    <div class="flex flex-wrap gap-2">
                        {#each openedData.tags as tag, i}
                            <div class="rounded-md border border-darkborderc px-2 py-1 text-xs text-textcolor2 wrap-anywhere">{tag}</div>
                        {/each}
                    </div>
                {/if}
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span class="text-textcolor2" use:tooltip={language.popularityLevelDesc}>
                        {language.popularityLevel.replace('{}', openedData.download.toString())}
                    </span>
                    {#if openedData.hasEmotion}
                        <span class="flex items-center gap-1 text-textcolor2"><SmileIcon size={18} aria-hidden="true" />{language.realmBadgeEmotion}</span>
                    {/if}
                    {#if openedData.hasAsset}
                        <span class="flex items-center gap-1 text-textcolor2"><ImageIcon size={18} aria-hidden="true" />{language.realmBadgeAssets}</span>
                    {/if}
                    {#if openedData.hasLore}
                        <span class="flex items-center gap-1 text-textcolor2"><BookIcon size={18} aria-hidden="true" />{language.realmBadgeLore}</span>
                    {/if}
                </div>
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <div class="flex flex-wrap gap-2">
                <button type="button" class="risu-focus-ring min-h-11 grow rounded-md bg-selected px-4 font-bold text-textcolor hover:bg-selected/50" onclick={() => {
                    downloadRisuHub(openedData.id, { creator: openedData.creator })
                    openedData = null
                }}>
                    {language.realmImportAndChat}
                </button>
                <button type="button" class="risu-focus-ring flex min-h-11 items-center justify-center gap-2 rounded-md border border-darkborderc bg-darkbutton px-4 text-textcolor hover:bg-selected/50" onclick={((e) => {
                    e.stopPropagation()
                    copyPlainText(`https://realm.risuai.net/character/${openedData.id}`, (outcome) => {
                        alertNormal(outcome.ok ? language.clipboardSuccess : language.copyFailed)
                    })
                })}>
                    <PaperclipIcon size={18} aria-hidden="true" />
                    {language.realmCopyLink}
                </button>
            </div>
            <details class="rounded-md border border-darkborderc" bind:open={moreOpen}>
                <summary class="risu-focus-ring flex min-h-11 cursor-pointer items-center px-3 text-textcolor2">{language.realmDetailMore}</summary>
                <div class="flex flex-wrap gap-2 p-2" hidden={!moreOpen}>
                    <button type="button" class="risu-focus-ring flex min-h-11 items-center gap-2 rounded-md border border-darkborderc bg-darkbutton px-4 text-draculared hover:bg-selected/50" onclick={(async (e) => {
                        e.stopPropagation()
                        const conf = await alertConfirm(language.alerts.realmReportConfirm)
                        if(conf){
                            const report = await alertInput(language.alerts.realmReportPrompt, undefined, undefined, { cancel: ALERT_INPUT_CANCEL })
                            if(report === ALERT_INPUT_CANCEL){
                                return
                            }
                            if(!(await askUpstreamAgreement())){
                                return
                            }
                            const da = await fetch(hubURL + '/hub/report', {
                                method: "POST",
                                body: JSON.stringify({
                                    id: openedData.id,
                                    report: report
                                })
                            })
                            alertNormal(await da.text())
                        }
                    })}>
                        <FlagIcon size={18} aria-hidden="true" />
                        {language.realmReport}
                    </button>
                    {#if openedData.creator}
                        <button type="button" class="risu-focus-ring flex min-h-11 items-center gap-2 rounded-md border border-darkborderc bg-darkbutton px-4 text-draculared hover:bg-selected/50" onclick={async (e) => {
                            e.stopPropagation()
                            const creatorId = openedData.creator
                            if(!creatorId){
                                return
                            }
                            const creatorName = openedData.authorname ?? openedData.creatorName ?? creatorId
                            const conf = await alertConfirm(fillLang(language.blockRealmCreatorConfirm, { creator: creatorName }))
                            if(!conf){
                                return
                            }
                            DBState.db.blockedRealmCreators = addBlockedRealmCreator(
                                DBState.db.blockedRealmCreators,
                                { id: creatorId, name: creatorName },
                            )
                            onBlock(creatorId)
                            openedData = null
                            alertNormal(language.realmCreatorBlockedSuccess)
                        }}>
                            <BanIcon size={18} aria-hidden="true" />
                            {language.blockRealmCreator}
                        </button>
                    {/if}
                </div>
            </details>
        </div>
    </div>
</div>
{/if}
