<script lang="ts">
    import { onDestroy } from "svelte";
    import { alertGenerationInfoStore, displayAlertText, STALE_ACCOUNT_NOTICE_ACK, type alertData } from "../../ts/alert";
    import { busyRefusalLine } from "../../ts/process/memory/busyActions";
    import { alertIdle, ANSWER_GUARD_MS, isConsentType, isPromptType } from "../../ts/alertPrompts";
    import { coversPage } from "../../ts/alertEscape";
    import { cancelHasOwnButton, offeredCancel } from "../../ts/alertBack";
    import { UPSTREAM_AGREEMENT_ACCEPT, UPSTREAM_AGREEMENT_DECLINE } from "../../ts/upstreamAgreement";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { currentPresetOf } from 'src/ts/storage/currentPreset';
    import { ParseMarkdown } from '../../ts/parser/parser.svelte';
    import { ChevronRightIcon } from '@lucide/svelte';
    import { isCharacterHasAssets } from 'src/ts/characterCards';
    import TextInput from '../UI/GUI/TextInput.svelte';
    import { aiLawApplies, openURL, getFetchLogs } from 'src/ts/globalApi.svelte';
    import Button from '../UI/GUI/Button.svelte';
    import PeerConflicts from './PeerConflicts.svelte';
    import ParkedReplyPrompt from './ParkedReplyPrompt.svelte';
    import UpdateOfferPrompt from './UpdateOfferPrompt.svelte';
    import PresetBundlePrompt from './PresetBundlePrompt.svelte';
    import { XIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon } from "@lucide/svelte";
    import hljs from 'highlight.js/lib/core';
    import json from 'highlight.js/lib/languages/json';
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import { language } from 'src/lang';
    import { getFetchData } from 'src/ts/globalApi.svelte';
    import { alertStore, selectedCharID } from "src/ts/stores.svelte";
    import { tokenize } from "src/ts/tokenizer";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import ModuleChatMenu from "../Setting/Pages/Module/ModuleChatMenu.svelte";
    import SelectCharGrid from "./SelectCharGrid.svelte";
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme";
    import { getChatBranches } from "src/ts/gui/branches";
    import { branchMoveTarget, branchNodeKey, branchNodeName, branchNodeText, classifyBranchKey, placeBranchPreview, resolveBranchStop, type BranchNodeLike } from "src/ts/gui/branchNode";
    import { getCurrentCharacter } from "src/ts/storage/database.svelte";
    import { translateStackTrace } from "../../ts/sourcemap";
    import { getDetailedOSLabel, getFallbackOSLabel, getRisuEnvironmentLabel } from "src/ts/platform";
    import versionData from "../../../version.json";
    import '../Nexus/pattern/pattern-dialog.css';
    import '../Nexus/pattern/pattern-alert.css';
    import '../Nexus/pattern/pattern-alert-tools.css';
    import PatternWarnMark from '../Nexus/pattern/PatternWarnMark.svelte';
    import type { PatternSeverity } from '../Nexus/pattern/patternWarning';
    import { motionPrefs } from 'src/ts/chatShell/motionPrefs.svelte';

    const uid = $props.id();

    // Severity per alert type: the edge colour and the shape of the mark. A wait is a notice that also carries the sweep.
    function severityOf(type: alertData['type']): PatternSeverity {
        switch (type) {
            case 'error':
                return 'danger'
            case 'ask':
            case 'select':
            case 'input':
            case 'selectChar':
            case 'addchar':
            case 'chatOptions':
            case 'cardexport':
            case 'pluginconfirm':
            case 'patternSelect':
            case 'patternInput':
            case 'updateOffer':
            case 'presetBundle':
                return 'confirm'
            case 'tos':
            case 'staleAccountNotice':
            case 'peerConflicts':
            case 'parkedReply':
                return 'caution'
            default:
                return 'notice'
        }
    }

    // Types that ask for an answer or report a failure interrupt a screen reader's reading; the rest are plain dialogs.
    const ALERT_DIALOG_TYPES = new Set<alertData['type']>(['error', 'ask', 'select', 'input', 'tos', 'staleAccountNotice'])
    // Reports and tool content need more room than a message.
    const WIDE_TYPES = new Set<alertData['type']>(['markdown', 'requestdata', 'hypaV2', 'requestlogs', 'cardexport', 'branches', 'selectChar', 'addchar', 'chatOptions', 'peerConflicts', 'parkedReply', 'updateOffer', 'presetBundle'])
    // Types whose body has no message element of its own; the dialog is named and described by the body instead.
    const NO_MESSAGE_TYPES = new Set<alertData['type']>(['select', 'selectChar', 'requestdata', 'addchar', 'hypaV2', 'requestlogs', 'cardexport', 'branches', 'chatOptions', 'peerConflicts', 'parkedReply'])
    // Viewers the person closes themselves: the head carries a named close, and Escape and Back close them as well.
    const CLOSE_BUTTON_TYPES = new Set<alertData['type']>(['requestdata', 'hypaV2', 'requestlogs', 'branches'])

    // The headline of a dialog that has one. A tool dialog is named by it, so every tool dialog that moves into the shared box adds its case here.
    function headingOf(a: alertData): string | null {
        switch (a.type) {
            case 'error':
                return language.error
            case 'ask':
                return language.confirm
            case 'pluginconfirm':
                return language.alertComp.pluginImport
            case 'selectChar':
                return language.select
            case 'addchar':
                return language.addCharacter
            case 'chatOptions':
                return language.chatOptions
            case 'requestdata':
                return language.alertRequestDataTitle
            case 'hypaV2':
                return language.hypaMemoryV2Modal
            case 'requestlogs':
                return language.ShowLog
            case 'cardexport':
                return language.shareExport
            case 'branches':
                return language.chatShellBranches
            case 'input':
                return language.input
            case 'updateOffer':
                return language.updateAvailableTitle
            case 'presetBundle':
                return language.presetBundleTitle
            default:
                return null
        }
    }

    function progressPercent(submsg: string | undefined): number {
        const value = Number(submsg)
        return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
    }

    const PHONE_QUERY = '(max-width: 640px)'
    // A wait that shows the same text this long says it is still working.
    const WAIT_HINT_MS = 8000
    const lowPower = $derived(motionPrefs.lowPower)
    let layout = $state<'phone' | 'wide'>('wide')

    // Phones get a bottom sheet through the pattern's own phone rules.
    $effect(() => {
        if (typeof window.matchMedia !== 'function') return
        const query = window.matchMedia(PHONE_QUERY)
        layout = query.matches ? 'phone' : 'wide'
        const onChange = (event: MediaQueryListEvent) => (layout = event.matches ? 'phone' : 'wide')
        query.addEventListener('change', onChange)
        return () => query.removeEventListener('change', onChange)
    })

    // The wait's text is the key: a same-text re-emission keeps the running timer, a new text restarts it, and the
    // hint goes with the wait.
    const waitMessage = $derived($alertStore.type === 'wait' || $alertStore.type === 'wait2' ? $alertStore.msg : null)
    let waitSlow = $state(false)
    $effect(() => {
        waitSlow = false
        if (waitMessage === null) return
        const timer = setTimeout(() => (waitSlow = true), WAIT_HINT_MS)
        return () => clearTimeout(timer)
    })

    let showDetails = $state(false);
    let translatedStackTrace = $state('');
    let stackTraceTranslationFailed = $state(false);
    let isTranslating = $state(false);
    let osLabel = $state(getFallbackOSLabel());
    const displayedStackTrace = $derived(translatedStackTrace || $alertStore.stackTrace || '');
    const risuVersion = versionData.version;
    const risuEnvironment = getRisuEnvironmentLabel();
    const userAgent = typeof navigator === "undefined" ? "Unknown" : navigator.userAgent || "Unknown";
    const stackTraceCodeBlock = $derived.by(() => {
        const lines = [
            `Risu version: ${risuVersion}`,
            `OS: ${osLabel}`,
            `User-Agent: ${userAgent}`,
            `Risu environment: ${risuEnvironment}`
        ]

        if (stackTraceTranslationFailed) {
            lines.push(language.stackTraceTranslationFailed)
        } else if (isTranslating) {
            lines.push(language.translating)
        }

        if (displayedStackTrace) {
            lines.push('', displayedStackTrace)
        }

        return lines.join('\n')
    });

    let input = $state('')
    let cardExportType = $state('realm')
    let cardExportType2 = $state('')
    let cardLicense = $state('')
    let generationInfoMenuIndex = $state(0)
    // Second selection cue besides the bg-selected fill: an inset ring keeps layout stable.
    const tabSelectedCue = 'ring-2 ring-inset ring-textcolor'
    // The branch tree: pixels per cell, the offset of the first cell from the tree's edge, and the node's own size.
    const TREE_CELL = 80
    const TREE_OFFSET = 24
    const TREE_NODE = 48
    // The link offsets that put a line through the centre of a node column.
    const TREE_LINK_LEFT = 45
    const TREE_ELBOW_LEFT = 46
    // The preview is owned by the node whose key it carries: only that node's blur clears it.
    let branchHover:null|{
        key:string,
        x:number,
        y:number,
        content:string,
    } = $state(null)
    let branchTree: HTMLElement | null = $state(null)
    let branchPreview: HTMLElement | null = $state(null)
    // The preview is measured after it renders and placed inside the tree's visible box at its current scroll position.
    // The effect runs before the next paint, so the unplaced preview is never shown. A scroll while a preview is
    // shown does not re-place it: the preview leaves with the pointer or the focus.
    $effect(() => {
        if(branchHover === null || !branchPreview || !branchTree){
            return
        }
        const placed = placeBranchPreview({
            nodeLeft: branchHover.x * TREE_CELL + TREE_OFFSET,
            nodeTop: branchHover.y * TREE_CELL + TREE_OFFSET,
            nodeSize: TREE_NODE,
            gap: TREE_CELL - TREE_NODE,
            previewWidth: branchPreview.offsetWidth,
            previewHeight: branchPreview.offsetHeight,
            scrollLeft: branchTree.scrollLeft,
            scrollTop: branchTree.scrollTop,
            viewWidth: branchTree.clientWidth,
            viewHeight: branchTree.clientHeight,
        })
        branchPreview.style.left = placed.left + 'px'
        branchPreview.style.top = placed.top + 'px'
    })
    // The one node of the tree that takes Tab, remembered by key and by index.
    let branchStop:null|{
        key:string,
        index:number,
    } = $state(null)
    let expandedLogs: Set<number> = $state(new Set())
    let allExpanded = $state(false)
    let copiedKey: string | null = $state(null)

    // Register JSON language for syntax highlighting
    if (!hljs.getLanguage('json')) {
        hljs.registerLanguage('json', json)
    }

    $effect(() => {
        void loadDetailedOSLabel();
    });

    function highlightJson(code: string): string {
        try {
            return hljs.highlight(code, { language: 'json' }).value
        } catch {
            return code.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        }
    }

    async function copyToClipboard(text: string, key: string) {
        try {
            await navigator.clipboard.writeText(text)
        } catch {
            // fallback
            const textarea = document.createElement('textarea')
            textarea.value = text
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand('copy')
            document.body.removeChild(textarea)
        }
        copiedKey = key
        setTimeout(() => {
            if (copiedKey === key) copiedKey = null
        }, 1500)
    }

    async function loadDetailedOSLabel() {
        try {
            osLabel = await getDetailedOSLabel();
        } catch (error) {
            console.warn("Failed to load detailed OS information:", error);
        }
    }

    // The prompt whose dialog is kept mounted. Another alert that covers it
    // hides the dialog instead of unmounting it, so what the user typed,
    // chose or scrolled to is still there when the prompt comes back. It is
    // replaced by the next prompt object and dropped when the store closes.
    // The consent prompts are not held: they defend their own place on screen
    // and are shown like any other alert.
    let held: alertData | null = $state.raw(null)
    const promptCovered = $derived(held !== null && $alertStore !== held)

    function resetPromptState() {
        input = ''
        cardExportType = 'realm'
        cardExportType2 = ''
        cardLicense = ''
    }

    // Every per-alert reset runs here, at the moment the store changes, not in an effect: under the async
    // scheduler a pre-effect runs after the block update that already rendered the new alert, so a new
    // prompt would render first as the live alert and then again as the held dialog. The callback also
    // runs once at creation, which leaves the initial values unchanged.
    // The prompt controller puts a prompt back when a consent or a notice over it is closed, so the store
    // shows a transient close that the controller overwrites in the same notification burst, whatever the
    // order in which the subscribers joined. A held prompt is therefore not released by that close but when
    // the controller reports the page idle (store closed and no prompt waiting), which it publishes after it
    // has processed each value. Until then the held dialog stays mounted, hidden and inert, because the store
    // no longer equals it, and its typed text survives.
    const stopIdleWatch = alertIdle.subscribe((idle) => {
        if(idle && held !== null){
            held = null
            resetPromptState()
        }
    })
    onDestroy(stopIdleWatch)

    const stopAlertStore = alertStore.subscribe((value) => {
        showDetails = false
        translatedStackTrace = ''
        stackTraceTranslationFailed = false
        isTranslating = false
        if(value.type !== 'branches'){
            branchHover = null
            branchStop = null
        }
        if(value.type !== 'requestlogs'){
            expandedLogs = new Set()
            allExpanded = false
        }
        if(isPromptType(value.type) && !isConsentType(value.type)){
            if(value !== held){
                held = value
                resetPromptState()
            }
        }
    })
    onDestroy(stopAlertStore)

    // The consent dialogs take no click made before they appeared, however late its handler runs, and
    // none until the pause after each appearance is over, so a press meant for what was on screen
    // before cannot answer them.
    let consentSeen: alertData | null = null
    let consentShownAt = 0

    $effect.pre(() => {
        const value = $alertStore
        if(value !== consentSeen){
            consentSeen = value
            consentShownAt = performance.now()
        }
    });

    function consentPaused(event: MouseEvent): boolean {
        return event.timeStamp < consentShownAt || performance.now() - consentShownAt < ANSWER_GUARD_MS
    }

    let root: HTMLElement | undefined
    // What the focus was last moved for. A `wait` or `progress` update is a new object every time, so
    // for those the type stands for the alert; every other alert is its object.
    let focusedFor: alertData | 'wait' | 'progress' | null = null

    // Focus goes to a box of the shown alert, never to a control: Enter or Space that opened the
    // alert would press a focused button.
    $effect(() => {
        const value = $alertStore
        if(!coversPage(value.type)){
            focusedFor = null
            return
        }
        const identity = value.type === 'wait' || value.type === 'progress' ? value.type : value
        if(identity === focusedFor){
            return
        }
        focusedFor = identity
        const box = Array.from(root?.querySelectorAll<HTMLElement>('[data-alert-box]') ?? [])
            .find((el) => el.closest('[inert]') === null)
        if(box && document.activeElement !== box){
            box.focus({ preventScroll: true })
        }
    });

    $effect(() => {
        if ($alertStore.type === 'error' && $alertStore.stackTrace && !translatedStackTrace && !stackTraceTranslationFailed && !isTranslating) {
            void loadTranslatedTrace();
        }
    });

    async function loadTranslatedTrace() {
        if (isTranslating || translatedStackTrace || stackTraceTranslationFailed || !$alertStore.stackTrace) return;
        isTranslating = true;
        try {
            const result = await translateStackTrace($alertStore.stackTrace);
            if (result.didTranslate) {
                translatedStackTrace = result.stackTrace;
            } else {
                stackTraceTranslationFailed = true;
            }
        } catch (e) {
            console.error("Failed to translate stack trace:", e);
            stackTraceTranslationFailed = true;
        } finally {
            isTranslating = false;
        }
    }

    const beautifyJSON = (data:string) =>{
        try {
            return JSON.stringify(JSON.parse(data), null, 2)
        } catch (error) {
            return data
        }
    }

    function showBranchPreview(node: BranchNodeLike & { x: number }) {
        branchHover = {
            key: branchNodeKey(node),
            x: node.x,
            y: node.y,
            content: branchNodeText(getCurrentCharacter(), node),
        }
    }

    // Arrow keys, Home and End move focus between the node buttons. Every other key, and any key with a modifier, is left alone.
    function onTreeKeydown(e: KeyboardEvent, nodes: BranchNodeLike[]) {
        const move = classifyBranchKey(e)
        if(move === null || !(e.target instanceof Element)){
            return
        }
        const node = e.target.closest<HTMLElement>('[data-part="pattern-alert-tree-node"]')
        const tree = node?.closest<HTMLElement>('[data-part="pattern-alert-tree"]')
        if(!node || !tree){
            return
        }
        e.preventDefault()
        const target = branchMoveTarget(nodes, Number(node.dataset.index), move)
        if(target !== null){
            tree.querySelector<HTMLElement>(`[data-part="pattern-alert-tree-node"][data-index="${target}"]`)?.focus()
        }
    }

    // A share of the context window within [0, 1]. A missing or empty window reads as zero, so the meter never gets NaN.
    const contextShare = (tokens: number | undefined, maxContext: number | undefined): number => {
        const share = (tokens ?? 0) / (maxContext ?? 0)
        return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0
    }
</script>

{#snippet tabButton(index: number, label: string, labelId?: string)}
    <button type="button" class="pattern-button {generationInfoMenuIndex === index ? tabSelectedCue : ''}" data-part="pattern-alert-tab" aria-pressed={generationInfoMenuIndex === index} onclick={() => {generationInfoMenuIndex = index}}>
        {#if labelId !== undefined}
            <span id={labelId}>{label}</span>
        {:else}
            {label}
        {/if}
    </button>
{/snippet}

<!-- A labelled code panel. `html` is highlighter output (its fallback escapes markup) and replaces `text` on screen; `text` is what the copy button copies. -->
{#snippet codePanel(label: string, text: string, html?: string, copyKey?: string)}
    <div data-part="pattern-alert-code-block">
        <div data-part="pattern-alert-code-head">
            <span data-part="pattern-alert-code-label">{label}</span>
            {#if copyKey !== undefined}
                <button
                    type="button"
                    data-part="pattern-alert-copy"
                    data-state={copiedKey === copyKey ? 'copied' : undefined}
                    title={language.copy}
                    aria-label={language.copy}
                    onclick={(e) => { e.stopPropagation(); copyToClipboard(text, copyKey) }}
                >
                    {#if copiedKey === copyKey}
                        <CheckIcon size={14} />
                    {:else}
                        <CopyIcon size={14} />
                    {/if}
                </button>
            {/if}
        </div>
        <pre data-part="pattern-alert-code">{#if html !== undefined}{@html html}{:else}{text}{/if}</pre>
    </div>
{/snippet}

{#snippet alertView(a: alertData, slot: 'held' | 'live')}
{#if a.type !== 'none' &&  a.type !== 'toast' && a.type !== 'selectModule' && a.type !== 'pukmakkurit'}
    {@const severity = severityOf(a.type)}
    {@const heading = headingOf(a)}
    {@const headingId = `${uid}-${slot}-heading`}
    {@const messageId = `${uid}-${slot}-message`}
    {@const bodyId = `${uid}-${slot}-body`}
    {@const hasMessage = a.type === 'select' ? a.msg.startsWith('__DISPLAY__') : !NO_MESSAGE_TYPES.has(a.type)}
    {@const waiting = a.type === 'wait' || a.type === 'wait2'}
    <!-- The two prompts draw their own title inside the body and name the dialog by it (it carries headingId). -->
    {@const titledByBody = a.type === 'peerConflicts' || a.type === 'parkedReply'}
    <div data-part="pattern-layer" data-layout={layout} data-low-power={lowPower ? '' : undefined}>
        <div data-part="pattern-scrim" aria-hidden="true"></div>
        <div
            data-part="pattern-dialog"
            class="break-any"
            tabindex="-1"
            data-alert-box
            data-alert-size={WIDE_TYPES.has(a.type) ? 'wide' : undefined}
            role={ALERT_DIALOG_TYPES.has(a.type) ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby={heading !== null || titledByBody ? headingId : hasMessage ? messageId : bodyId}
            aria-describedby={heading !== null && hasMessage ? messageId : undefined}
        >
        <div data-part="pattern-warn-root" data-alert-root data-alert-headed={heading !== null ? '' : undefined} data-form="sheet" data-pattern-severity={severity} data-alert-kind={waiting || a.type === 'progress' ? 'wait' : undefined}>
            <!-- The severity tint paints under the mark and the headline only; the body sits on the plain surface. -->
            <div data-part="pattern-alert-head">
                <span data-part="pattern-warn-mark" aria-hidden="true"><PatternWarnMark {severity} /></span>
                {#if heading !== null}
                    <h2 id={headingId} data-part="pattern-warn-headline">{heading}</h2>
                {/if}
                {#if CLOSE_BUTTON_TYPES.has(a.type)}
                    <button type="button" data-part="pattern-alert-close" aria-label={language.uiCommon.close} onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: ''
                        })
                    }}><XIcon size={20} /></button>
                {:else if a.type === 'cardexport'}
                    <button type="button" data-part="pattern-alert-close" aria-label={language.uiCommon.close} onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: JSON.stringify({
                                type: 'cancel',
                                type2: cardExportType2
                            })
                        })
                    }}><XIcon size={20} /></button>
                {/if}
            </div>
            <div id={bodyId} data-part="pattern-alert-body">
            {#if a.type === 'markdown'}
                <div id={messageId} class="overflow-y-auto">
                    <span class="text-textcolor chattext prose chattext2" class:prose-invert={$ColorSchemeTypeStore === 'dark'}>
                        {#await ParseMarkdown(a.msg) then msg}
                            {@html msg}
                        {/await}
                    </span>
                </div>
            {:else if a.type === 'tos'}
                <!-- svelte-ignore a11y_missing_attribute -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->

                <div id={messageId} class="text-textcolor">{language.upstreamAgreementPromptBefore}<a role="button" tabindex="0" class="risu-link risu-focus-ring underline transition-colors duration-200 cursor-pointer" onclick={() => {
                        openURL('https://account.sionyw.com/terms')
                    }}>{language.upstreamAgreementTermsOfService}</a>{language.upstreamAgreementPromptBetween}<a role="button" tabindex="0" class="risu-link risu-focus-ring underline transition-colors duration-200 cursor-pointer" onclick={() => {
                        openURL('https://account.sionyw.com/privacy')
                    }}>{language.upstreamAgreementPrivacyPolicy}</a>{language.upstreamAgreementPromptAfter}</div>
            {:else if a.type === 'pluginconfirm'}
                {@const parts = a.msg.split('\n\n')}
                {@const mainPart = parts[0]}
                {@const confirmMessage = parts[1]}
                {@const mainParts = mainPart.split('\n')}
                {@const pluginName = mainParts[0]}
                {@const warnings = mainParts.slice(1)}
                <div id={messageId} class="plugin-confirm-content">
                    <p class="plugin-name">{pluginName}</p>
                    {#if warnings.length > 0}
                        <ul class="warnings-list">
                            {#each warnings as warning}
                                <li class="warning-item">{warning}</li>
                            {/each}
                        </ul>
                    {/if}
                    <p class="confirm-message">{confirmMessage}</p>
                </div>
            {:else if a.type === 'peerConflicts'}
                <PeerConflicts rows={a.peerConflicts ?? []} title={a.msg} titleId={headingId} onanswer={(message) => {
                    alertStore.set({ type: 'none', msg: message })
                }} />
            {:else if a.type === 'parkedReply'}
                <ParkedReplyPrompt name={a.parkedReply?.name ?? ''} text={a.parkedReply?.text ?? ''} title={a.msg} titleId={headingId} onanswer={(message) => {
                    alertStore.set({ type: 'none', msg: message })
                }} />
            {:else if a.type === 'cardexport'}
                <div data-part="pattern-alert-stack">
                    <span data-part="pattern-alert-field-label">{language.type}</span>
                    <div data-part="pattern-alert-tiles">
                        {#if a.submsg === 'preset'}
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === 'realm'} aria-pressed={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === ''} aria-pressed={cardExportType === ''} onclick={() => {cardExportType = ''}}>Risupreset</button>
                        {:else if a.submsg === 'module'}
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === 'realm'} aria-pressed={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === ''} aria-pressed={cardExportType === ''} onclick={() => {cardExportType = ''}}>RisuM</button>
                        {:else}
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === 'realm'} aria-pressed={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === ''} aria-pressed={cardExportType === ''} onclick={() => {
                                cardExportType = ''
                                cardExportType2 = 'charxJpeg'
                            }}>Character Card V3</button>
                            <button type="button" data-part="pattern-alert-tile" class:ring-1={cardExportType === 'ccv2'} aria-pressed={cardExportType === 'ccv2'} onclick={() => {cardExportType = 'ccv2'}}>Character Card V2</button>
                        {/if}
                    </div>
                    {#if cardExportType === ''}
                        {#if a.submsg === 'module'}
                            <p data-part="pattern-alert-note">{language.risuMDesc}</p>
                        {:else if a.submsg === 'preset'}
                            <p data-part="pattern-alert-note">{language.risupresetDesc}</p>
                            {#if cardExportType2 === 'preset' && (currentPresetOf(DBState.db)?.image || currentPresetOf(DBState.db)?.regex?.length > 0)}
                                <p data-part="pattern-alert-warning"><span data-part="pattern-alert-warning-mark" aria-hidden="true">!</span>{language.alertComp.realmShareNotice}</p>
                            {/if}
                        {:else}
                            <p data-part="pattern-alert-note">{language.ccv3Desc}</p>
                            {#if cardExportType2 !== 'charx' && cardExportType2 !== 'charxJpeg' && isCharacterHasAssets(DBState.db.characters[$selectedCharID])}
                                <p data-part="pattern-alert-warning"><span data-part="pattern-alert-warning-mark" aria-hidden="true">!</span>{language.notCharxWarn}</p>
                            {/if}
                        {/if}
                    {:else if cardExportType === 'json'}
                        <p data-part="pattern-alert-note">{language.jsonDesc}</p>
                    {:else if cardExportType === 'ccv2'}
                        <p data-part="pattern-alert-note">{language.ccv2Desc}</p>
                        <p data-part="pattern-alert-warning"><span data-part="pattern-alert-warning-mark" aria-hidden="true">!</span>{language.v2Warning}</p>
                    {:else}
                        <p data-part="pattern-alert-note">{language.realmDesc}</p>
                    {/if}
                    {#if a.submsg === '' && cardExportType === ''}
                        <span id="{uid}-export-format" data-part="pattern-alert-field-label">{language.format}</span>
                        <SelectInput bind:value={cardExportType2} labelId="{uid}-export-format">
                            <OptionInput value="charx">CHARX</OptionInput>
                            <OptionInput value="charxJpeg">CHARX-JPEG</OptionInput>
                            <OptionInput value="">PNG</OptionInput>
                            <OptionInput value="json">JSON</OptionInput>
                        </SelectInput>
                    {/if}
                </div>
                <div data-part="pattern-warn-actions" data-count="1">
                    <button type="button" class="pattern-button" data-variant="confirm" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: JSON.stringify({
                                type: cardExportType,
                                type2: cardExportType2
                            })
                        })
                    }}>{cardExportType === 'realm' ? language.shareCloud : language.export}</button>
                </div>
            {:else if a.type === 'updateOffer'}
                <UpdateOfferPrompt offer={a.updateOffer ?? { currentVersion: '', version: '', notes: '' }} {messageId} onanswer={(message) => {
                    alertStore.set({ type: 'none', msg: message })
                }} />
            {:else if a.type === 'presetBundle'}
                <PresetBundlePrompt view={a.presetBundle ?? { rows: [], existingNames: [] }} {messageId} onanswer={(message) => {
                    alertStore.set({ type: 'none', msg: message })
                }} />
            {:else if a.type !== 'select' && a.type !== 'selectChar' && a.type !== 'requestdata' && a.type !== 'addchar' && a.type !== 'hypaV2' && a.type !== 'requestlogs' && a.type !== 'chatOptions' && a.type !== 'branches'}
                <span id={messageId} data-part="pattern-alert-message">{displayAlertText(a, $busyRefusalLine)}</span>
                {#if a.submsg && a.type !== 'progress'}
                    <span data-part="pattern-warn-detail">{a.submsg}</span>
                {/if}

                {#if a.type === 'error' && a.stackTrace}
                    <div>
                        <button type="button" class="pattern-button" onclick={() => showDetails = !showDetails}>
                            {showDetails ? language.hideErrorDetails : language.showErrorDetails}
                            {#if showDetails}
                                <XIcon size={16} />
                            {:else}
                                <ChevronRightIcon size={16} />
                            {/if}
                        </button>
                        {#if showDetails}
                            <div class="stack-trace-wrap">
                                <button
                                    class="stack-trace-copy"
                                    onclick={() => copyToClipboard(stackTraceCodeBlock, 'stack-trace')}
                                    title={language.copy}
                                    aria-label={language.copy}
                                >
                                    {#if copiedKey === 'stack-trace'}
                                        <CheckIcon size={14} />
                                    {:else}
                                        <CopyIcon size={14} />
                                    {/if}
                                </button>
                                <pre class="stack-trace">{stackTraceCodeBlock}</pre>
                            </div>
                        {/if}
                    </div>
                {/if}
            {/if}
            {#if a.type === 'error' && a.link}
                <button type="button" class="pattern-button" onclick={() => {
                    const open = a.link?.open
                    alertStore.set({
                        type: 'none',
                        msg: ''
                    })
                    open?.()
                }}>{a.link.label}</button>
            {/if}
            {#if waiting}
                <div data-part="pattern-alert-bar" aria-hidden="true">
                    <div data-part="pattern-alert-bar-sweep"></div>
                </div>
                {#if waitSlow}
                    <p data-part="pattern-warn-detail">{language.alertWaitSlowHint}</p>
                {/if}
            {/if}
            {#if a.type === 'wait' && a.onCancel}
                <button type="button" class="pattern-button" onclick={() => {
                    a.onCancel?.()
                }}>{language.cancel}</button>
            {/if}

            {#if a.type === 'progress'}
                {@const percent = progressPercent(a.submsg)}
                <div data-part="pattern-alert-bar" role="progressbar" aria-labelledby={messageId} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
                    <div data-part="pattern-alert-bar-fill" style:--p-fill={percent / 100}></div>
                </div>
                <span data-part="pattern-warn-detail">{a.submsg + '%'}</span>
            {/if}

            {#if a.type === 'ask' || a.type === 'pluginconfirm'}
                <div data-part="pattern-warn-actions" data-count="2">
                    <button type="button" class="pattern-button" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'no'
                        })
                    }}>{language.alertComp.no}</button>
                    <button type="button" class="pattern-button" data-variant="confirm" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'yes'
                        })
                    }}>{language.alertComp.yes}</button>
                </div>
            {:else if a.type === 'tos' && import.meta.env.VITE_RISU_LEGAL_CONFIGURED}
                <div data-part="pattern-warn-actions" data-count="2">
                    <button type="button" class="pattern-button" data-variant="confirm" onclick={(event) => {
                        if(consentPaused(event)){
                            return
                        }
                        alertStore.set({
                            type: 'none',
                            msg: UPSTREAM_AGREEMENT_ACCEPT
                        })
                    }}>{language.upstreamAgreementAccept}</button>
                    <button type="button" class="pattern-button" onclick={(event) => {
                        if(consentPaused(event)){
                            return
                        }
                        alertStore.set({
                            type: 'none',
                            msg: UPSTREAM_AGREEMENT_DECLINE
                        })
                    }}>{language.upstreamAgreementDecline}</button>
                </div>
            {:else if a.type === 'select'}
                {@const hasDisplay = a.msg.startsWith('__DISPLAY__')}
                {@const cancel = offeredCancel(a)}
                {#if hasDisplay}
                    {@const parts = a.msg.substring(11).split('||')}
                    <div id={messageId} data-part="pattern-alert-message">{parts[0]}</div>
                    <div data-part="pattern-alert-choices">
                        {#each parts.slice(1) as n, i}
                            <button type="button" class="pattern-button" onclick={() => {
                                alertStore.set({
                                    type: 'none',
                                    msg: i.toString()
                                })
                            }}>{n}</button>
                        {/each}
                    </div>
                {:else}
                    {@const parts = a.msg.split('||')}
                    <div data-part="pattern-alert-choices">
                        {#each parts as n, i}
                            <button type="button" class="pattern-button" onclick={() => {
                                alertStore.set({
                                    type: 'none',
                                    msg: i.toString()
                                })
                            }}>{n}</button>
                        {/each}
                    </div>
                {/if}
                {#if cancel !== undefined && !cancelHasOwnButton(a)}
                    <button type="button" class="pattern-button" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: cancel
                        })
                    }}>{language.cancel}</button>
                {/if}
            {:else if a.type === 'error' || a.type === 'normal' || a.type === 'markdown'}
               <button type="button" class="pattern-button" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        msg: ''
                    })
                }}>{language.alertComp.ok}</button>
            {:else if a.type === 'staleAccountNotice'}
               <button type="button" class="pattern-button" onclick={(event) => {
                    if(consentPaused(event)){
                        return
                    }
                    alertStore.set({
                        type: 'none',
                        msg: STALE_ACCOUNT_NOTICE_ACK
                    })
                }}>{language.alertComp.ok}</button>
            {:else if a.type === 'input'}
                {@const cancel = offeredCancel(a)}
                <TextInput value={a.defaultValue} id="alert-input" labelId={messageId} autocomplete="off" marginTop list="alert-input-list" />
                <div data-part="pattern-warn-actions" data-count={cancel !== undefined ? 2 : 1}>
                    <button type="button" class="pattern-button" data-variant="confirm" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            //@ts-expect-error 'value' doesn't exist on Element, but target is HTMLInputElement here
                            msg: document.querySelector('#alert-input')?.value
                        })
                    }}>{language.alertComp.ok}</button>
                    {#if cancel !== undefined}
                        <button type="button" class="pattern-button" onclick={() => {
                            alertStore.set({
                                type: 'none',
                                msg: cancel
                            })
                        }}>{language.cancel}</button>
                    {/if}
                </div>
                {#if a.datalist}
                    <datalist id="alert-input-list">
                        {#each a.datalist as item}
                            <option
                                value={item[0]}
                                label={item[1] ? item[1] : item[0]}
                            >{item[1] ? item[1] : item[0]}</option>
                        {/each}
                    </datalist>
                {/if}
            {:else if a.type === 'selectChar'}
                <SelectCharGrid onPick={(chaId) => alertStore.set({type: 'none', msg: chaId})} />
                <div data-part="pattern-warn-actions" data-count="1">
                    <button type="button" class="pattern-button" onclick={() => {
                        alertStore.set({type: 'none', msg: ''})
                    }}>{language.cancel}</button>
                </div>
            {:else if a.type === 'requestdata'}
                {#if aiLawApplies()}
                    <p data-part="pattern-alert-note">{language.generatedByAIDisclaimer}</p>
                {/if}
                <div data-part="pattern-alert-tabs">
                    {@render tabButton(0, language.tokens)}
                    {@render tabButton(1, language.metaData)}
                    {@render tabButton(2, language.log)}
                    {@render tabButton(3, language.prompt)}
                </div>
                {#if generationInfoMenuIndex === 0}
                    {@const info = $alertGenerationInfoStore.genInfo}
                    {@const shareInput = contextShare(info.inputTokens, info.maxContext)}
                    {@const shareOutput = Math.min(contextShare(info.outputTokens, info.maxContext), 1 - shareInput)}
                    <div data-part="pattern-alert-stack">
                        <!-- The legend carries the numbers; the meter is the picture of them. -->
                        <div data-part="pattern-alert-meter" aria-hidden="true" style:--p-in={shareInput} style:--p-out={shareOutput}>
                            <div data-part="pattern-alert-meter-input"></div>
                            <div data-part="pattern-alert-meter-output"></div>
                        </div>
                        <ul data-part="pattern-alert-legend">
                            <li><span data-part="pattern-alert-swatch" data-kind="input" aria-hidden="true"></span><span>{language.inputTokens}</span><span>{info.inputTokens ?? '?'} {language.tokens}</span></li>
                            <li><span data-part="pattern-alert-swatch" data-kind="output" aria-hidden="true"></span><span>{language.outputTokens}</span><span>{info.outputTokens ?? '?'} {language.tokens}</span></li>
                            <li><span data-part="pattern-alert-swatch" data-kind="max" aria-hidden="true"></span><span>{language.maxContextSize}</span><span>{info.maxContext ?? '?'} {language.tokens}</span></li>
                        </ul>
                        <span data-part="pattern-warn-detail">{language.tokenWarning}</span>
                    </div>
                {/if}
                {#if generationInfoMenuIndex === 1}
                    <dl data-part="pattern-alert-facts">
                        <dt>{language.index}</dt>
                        <dd>{$alertGenerationInfoStore.idx}</dd>
                        <dt>{language.model}</dt>
                        <dd>{$alertGenerationInfoStore.genInfo.model}</dd>
                        <dt>ID</dt>
                        <dd>{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].chatId ?? language.none}</dd>
                        <dt>GenID</dt>
                        <dd>{$alertGenerationInfoStore.genInfo.generationId}</dd>
                        <dt>{language.alertComp.saying}</dt>
                        <dd>{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].saying}</dd>
                        <dt>{language.alertComp.size}</dt>
                        <dd>{JSON.stringify(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx]).length} Bytes</dd>
                        <dt>{language.alertComp.time}</dt>
                        <dd>{(new Date(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].time ?? 0)).toLocaleString()}</dd>
                        {#if $alertGenerationInfoStore.genInfo.stageTiming}
                            {@const stage1 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage1 ?? 0) / 1000).toFixed(1)))}
                            {@const stage2 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage2 ?? 0) / 1000).toFixed(1)))}
                            {@const stage3 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage3 ?? 0) / 1000).toFixed(1)))}
                            {@const stage4 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage4 ?? 0) / 1000).toFixed(1)))}
                            {@const totalRounded = (stage1 + stage2 + stage3 + stage4).toFixed(1)}
                            <dt>{language.alertComp.timing}</dt>
                            <dd>{stage1} + {stage2} + {stage3} + {stage4} = <strong>{totalRounded}s</strong></dd>
                        {/if}
                        <dt>{language.tokens}</dt>
                        {#await tokenize(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].data)}
                            <dd>{language.alertComp.loading}</dd>
                        {:then tokens}
                            <dd>{tokens}</dd>
                        {/await}
                    </dl>
                {/if}
                {#if generationInfoMenuIndex === 2}
                    {#await getFetchData(a.msg) then data}
                        {#if !data}
                            <div data-part="pattern-alert-empty">
                                <strong>{language.errors.requestLogRemoved}</strong>
                                <span>{language.errors.requestLogRemovedDesc}</span>
                            </div>
                        {:else}
                            <!-- A log entry that lost a field still renders: the empty text stands in for it. -->
                            {@const requestBody = beautifyJSON(data.body) ?? ''}
                            {@const responseBody = beautifyJSON(data.response) ?? ''}
                            <div data-part="pattern-alert-stack">
                                {@render codePanel('URL', data.url)}
                                {@render codePanel('Request Body', requestBody, highlightJson(requestBody))}
                                {@render codePanel('Response', responseBody, highlightJson(responseBody))}
                            </div>
                        {/if}
                    {/await}
                {/if}
                {#if generationInfoMenuIndex === 3}
                    {#if Object.keys(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo || {}).length === 0}
                        <div data-part="pattern-alert-empty">{language.promptInfoEmptyMessage}</div>
                    {:else}
                        <div data-part="pattern-alert-stack">
                            <dl data-part="pattern-alert-facts">
                                <dt>{language.alertComp.presetName}</dt>
                                <dd>{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptName}</dd>
                            </dl>
                            <div data-part="pattern-alert-code-block">
                                <span data-part="pattern-alert-code-label">{language.alertComp.toggles}</span>
                                <div data-part="pattern-alert-panel">
                                    {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptToggles.length === 0}
                                        <div data-part="pattern-alert-empty">{language.promptInfoEmptyToggle}</div>
                                    {:else}
                                        <dl data-part="pattern-alert-facts">
                                            {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptToggles as toggle}
                                                <dt>{toggle.key}</dt>
                                                <dd>{toggle.value}</dd>
                                            {/each}
                                        </dl>
                                    {/if}
                                </div>
                            </div>
                            <div data-part="pattern-alert-code-block">
                                <span data-part="pattern-alert-code-label">{language.alertComp.promptText}</span>
                                <div data-part="pattern-alert-panel">
                                    {#if !DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptText}
                                        <div data-part="pattern-alert-empty">{language.promptInfoEmptyText}</div>
                                    {:else}
                                        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptText as block}
                                            {@render codePanel(block.role, block.content)}
                                        {/each}
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {/if}
                {/if}
            {:else if a.type === 'hypaV2'}
                <div data-part="pattern-alert-tabs">
                    {@render tabButton(0, 'Chunks', `${uid}-chunks-tab`)}
                    {@render tabButton(1, language.alertComp.summarized)}
                </div>
                {#if generationInfoMenuIndex === 0}
                    <div data-part="pattern-alert-stack">
                        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data.chunks as chunk, i}
                            <TextAreaInput bind:value={chunk.text} labelId="{uid}-chunks-tab" />
                        {/each}

                        <!-- Adding non-bound chunk is not okay, change the user flow to edit existing ones. -->
                    </div>
                {:else}
                    <div data-part="pattern-alert-stack">
                    {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data.mainChunks as chunk, i} <!-- Summarized should be mainChunks, afaik. Be aware of that chunks are created with mainChunks, however this editing would not change related chunks. -->
                        <div data-part="pattern-alert-chunk" data-state={i === 0 ? 'active' : undefined}>
                            <span id="{uid}-summary-{i}" data-part="pattern-alert-chunk-label">{i === 0 ? language.active : language.alertComp.inactive}</span>
                            <TextAreaInput bind:value={chunk.text} labelId="{uid}-summary-{i}" />
                        </div>
                    {/each}
                    </div>
                {/if}
            {:else if a.type === 'requestlogs'}
                {@const logs = getFetchLogs()}
                <div data-part="pattern-alert-toolbar">
                    <button type="button" class="pattern-button" onclick={() => {
                        if(allExpanded) {
                            expandedLogs = new Set()
                        } else {
                            expandedLogs = new Set(logs.map((_, i) => i))
                        }
                        allExpanded = !allExpanded
                    }}>
                        {allExpanded ? language.collapseAll : language.expandAll}
                    </button>
                </div>
                {#if logs.length === 0}
                    <div data-part="pattern-alert-empty">{language.noRequestLogs}</div>
                {:else}
                    <div data-part="pattern-alert-logs">
                        {#each logs as log, i}
                            {@const isExpanded = expandedLogs.has(i)}
                            <div data-part="pattern-alert-log" data-state={log.success ? 'ok' : 'err'}>
                                <button
                                    type="button"
                                    data-part="pattern-alert-log-summary"
                                    aria-expanded={isExpanded}
                                    onclick={() => {
                                        const newSet = new Set(expandedLogs)
                                        if(isExpanded) {
                                            newSet.delete(i)
                                        } else {
                                            newSet.add(i)
                                        }
                                        expandedLogs = newSet
                                    }}
                                >
                                    <!-- The state is told by a glyph and the code; the colour of the edge only repeats it. -->
                                    <span data-part="pattern-alert-log-status" data-state={log.success ? 'ok' : 'err'}>
                                        {#if log.success}
                                            <CheckIcon size={14} aria-hidden="true" />
                                        {:else}
                                            <XIcon size={14} aria-hidden="true" />
                                        {/if}
                                        {log.status ?? (log.success ? 'OK' : 'ERR')}
                                    </span>
                                    <span data-part="pattern-alert-log-url" title={log.url}>{log.url}</span>
                                    <span data-part="pattern-alert-log-date">{log.date}</span>
                                    <span data-part="pattern-alert-log-chevron" aria-hidden="true">
                                        {#if isExpanded}
                                            <ChevronUpIcon size={20} />
                                        {:else}
                                            <ChevronDownIcon size={20} />
                                        {/if}
                                    </span>
                                </button>
                                {#if isExpanded}
                                    <div data-part="pattern-alert-log-detail">
                                        {@render codePanel('URL', log.url, undefined, `${i}-url`)}
                                        {@render codePanel('Request Body', log.body, highlightJson(log.body), `${i}-body`)}
                                        {@render codePanel('Request Header', log.header, highlightJson(log.header), `${i}-header`)}
                                        {@render codePanel('Response', log.response, highlightJson(log.response), `${i}-response`)}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            {:else if a.type === 'addchar'}
                <div data-part="pattern-alert-rows">
                    <button type="button" data-part="pattern-alert-row" data-emphasis="hero" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'importFromRealm'
                        })
                    }}>
                        <span data-part="pattern-alert-row-title">{language.importFromRealm}</span>
                        <span data-part="pattern-alert-row-desc">{language.importFromRealmDesc}</span>
                        <span aria-hidden="true"><ChevronRightIcon /></span>
                    </button>
                    <button type="button" data-part="pattern-alert-row" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'importCharacter'
                        })
                    }}>
                        <span data-part="pattern-alert-row-title">{language.importCharacter}</span>
                        <span aria-hidden="true"><ChevronRightIcon /></span>
                    </button>
                    <button type="button" data-part="pattern-alert-row" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'createfromScratch'
                        })
                    }}>
                        <span data-part="pattern-alert-row-title">{language.createfromScratch}</span>
                        <span aria-hidden="true"><ChevronRightIcon /></span>
                    </button>
                    <button type="button" data-part="pattern-alert-row" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'createGroup'
                        })
                    }}>
                        <span data-part="pattern-alert-row-title">{language.createGroup}</span>
                        <span aria-hidden="true"><ChevronRightIcon /></span>
                    </button>
                </div>
                <div data-part="pattern-warn-actions" data-count="1">
                    <button type="button" class="pattern-button" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'cancel'
                        })
                    }}>{language.cancel}</button>
                </div>
            {:else if a.type === 'chatOptions'}
                <div data-part="pattern-alert-rows">
                    <button type="button" data-part="pattern-alert-row" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: '0'
                        })
                    }}>
                        <span data-part="pattern-alert-row-title">{language.createCopy}</span>
                        <span aria-hidden="true"><ChevronRightIcon /></span>
                    </button>
                    <button type="button" data-part="pattern-alert-row" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: '1'
                        })
                    }}>
                        <span data-part="pattern-alert-row-title">{language.bindPersona}</span>
                        <span aria-hidden="true"><ChevronRightIcon /></span>
                    </button>
                </div>
                <div data-part="pattern-warn-actions" data-count="1">
                    <button type="button" class="pattern-button" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'cancel'
                        })
                    }}>{language.cancel}</button>
                </div>
            {:else if a.type === 'branches'}
                {@const nodes = getChatBranches()}
                {@const stop = resolveBranchStop(nodes, branchStop)}
                <!-- The tree only routes the keys of the node buttons inside it; it is not a control itself. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                    data-part="pattern-alert-tree"
                    bind:this={branchTree}
                    style:height={(nodes.reduce((deepest, node) => Math.max(deepest, node.y), 0) * TREE_CELL + TREE_OFFSET * 2 + TREE_NODE) + 'px'}
                    onkeydown={(e) => onTreeKeydown(e, nodes)}
                >
                    {#each nodes as obj, i (branchNodeKey(obj))}
                        <button
                            type="button"
                            data-part="pattern-alert-tree-node"
                            data-index={i}
                            tabindex={i === stop ? 0 : -1}
                            aria-label={branchNodeName(branchNodeText(getCurrentCharacter(), obj), language.chatShellTogglesEmpty)}
                            style:top={(obj.y * TREE_CELL + TREE_OFFSET) + 'px'}
                            style:left={(obj.x * TREE_CELL + TREE_OFFSET) + 'px'}
                            style:width={TREE_NODE + 'px'}
                            style:height={TREE_NODE + 'px'}
                            onmouseenter={() => {
                                if(branchHover === null){
                                    showBranchPreview(obj)
                                }
                            }}
                            onclick={() => showBranchPreview(obj)}
                            onmouseleave={() => {
                                branchHover = null
                            }}
                            onfocus={() => {
                                showBranchPreview(obj)
                                branchStop = { key: branchNodeKey(obj), index: i }
                            }}
                            onblur={() => {
                                if(branchHover?.key === branchNodeKey(obj)){
                                    branchHover = null
                                }
                            }}
                        ></button>
                        {#if obj.connectX === obj.x}
                            <div
                                data-part="pattern-alert-tree-link"
                                data-kind={obj.multiChild ? 'branch' : 'line'}
                                data-axis="vertical"
                                style:top={((obj.y - 1) * TREE_CELL + TREE_OFFSET) + 'px'}
                                style:left={(obj.x * TREE_CELL + TREE_LINK_LEFT) + 'px'}
                                style:height={TREE_CELL + 'px'}
                            ></div>
                        {:else if obj.connectX !== -1}
                            <div
                                data-part="pattern-alert-tree-link"
                                data-kind="branch"
                                data-axis="vertical"
                                style:top={(obj.y * TREE_CELL) + 'px'}
                                style:left={(obj.x * TREE_CELL + TREE_LINK_LEFT) + 'px'}
                                style:height={(TREE_CELL / 2) + 'px'}
                            ></div>
                            <div
                                data-part="pattern-alert-tree-link"
                                data-kind="branch"
                                data-axis="horizontal"
                                style:top={(obj.y * TREE_CELL) + 'px'}
                                style:left={(obj.connectX * TREE_CELL + TREE_ELBOW_LEFT) + 'px'}
                                style:width={Math.abs((obj.x - obj.connectX) * TREE_CELL) + 'px'}
                            ></div>
                        {/if}
                    {/each}
                    {#if branchHover !== null}
                        <div
                            data-part="pattern-alert-tree-preview"
                            bind:this={branchPreview}
                        >{branchHover.content}</div>
                    {/if}
                </div>
            {/if}
            </div>
        </div>
        </div>
    </div>


{:else if a.type === 'toast'}
    <div class="toast-anime absolute right-0 bottom-0 bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-11/12 overflow-y-auto z-50 text-textcolor"
        onanimationend={() => {
            alertStore.set({
                type: 'none',
                msg: ''
            })
        }}
    >{a.msg}</div>
{:else if a.type === 'selectModule'}
    <ModuleChatMenu alertMode close={(d) => {
        alertStore.set({
            type: 'none',
            msg: d
        })
    }} />
{:else if a.type === 'pukmakkurit'}
    <!-- Log Generator by dootaang, GPL3 -->
    <!-- Svelte, Typescript version by Kwaroran -->
    
    <div class="absolute w-full h-full z-50 bg-black/50 flex justify-center items-center">
        <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-full overflow-y-auto outline-none" tabindex="-1" data-alert-box>
            <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.preview}</h2>

        </div>
    </div>
{/if}
{/snippet}

<div class="contents" data-alert-root bind:this={root}>
    <!-- A prompt stays mounted, hidden and inert, while another alert covers it. -->
    {#if held}
        {#key held}
            <div style="display: contents" style:visibility={promptCovered ? 'hidden' : null} inert={promptCovered}>
                {@render alertView(held, 'held')}
            </div>
        {/key}
    {/if}
    {#if $alertStore !== held && $alertStore.type !== 'none'}
        {@render alertView($alertStore, 'live')}
    {/if}
</div>

<style>
    .plugin-confirm-content .plugin-name {
        font-size: 1.25rem;
        font-weight: bold;
        color: inherit;
    }
    .plugin-confirm-content .warnings-list {
        list-style-type: disc;
        list-style-position: inside;
        margin-top: 0.5rem;
        margin-bottom: 0.5rem;
        padding-left: 1rem;
        color: inherit;
    }
    .plugin-confirm-content .warning-item {
        margin-bottom: 0.25rem;
    }
    .plugin-confirm-content .confirm-message {
        margin-top: 1rem;
        color: inherit;
    }
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }
    @keyframes toastAnime {
        0% {
            opacity: 0;
        }
        50% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }

    .toast-anime {
        animation: toastAnime 1s ease-out;
    }

    .stack-trace-wrap {
        position: relative;
        margin-top: 0.5rem;
    }

    .stack-trace {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor2);
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.25rem;
        padding: 0.75rem 2.75rem 0.75rem 0.75rem;
        font-family: monospace;
        font-size: 0.75rem;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
    }

    .stack-trace-copy {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.375rem;
        background-color: var(--risu-theme-darkbg);
        color: var(--risu-theme-textcolor2);
        transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
    }

    .stack-trace-copy:hover {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor);
    }
</style>
