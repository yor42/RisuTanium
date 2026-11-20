<script lang="ts">
    import { tick, untrack } from "svelte";
    import { downloadRisuHub, getRisuHub, type hubType } from "src/ts/characterCards";
    import { handleHubHtmlClick, sanitizeHubHtml } from "src/ts/hubHtml";
    import { ArrowLeft, ArrowRight, SearchIcon } from "@lucide/svelte";
    import { alertInput } from "src/ts/alert";
    import { ALERT_INPUT_CANCEL } from "src/ts/alertCancel";
    import { language } from "src/lang";
    import RisuHubIcon from "./RealmHubIcon.svelte";
    import { DBState, OpenRealmStore, RealmInitialOpenChar } from "src/ts/stores.svelte";
    import RealmPopUp from "./RealmPopUp.svelte";
    import RealmBlockedCreators from "./RealmBlockedCreators.svelte";
    import { askUpstreamAgreement, upstreamAccepted } from "src/ts/upstreamAgreement";

    // Whether the upstream-services agreement still needs confirming is read
    // directly from `$upstreamAccepted` in the template below, not tracked
    // as a member of this type.
    type HubStatus = 'offline' | 'pending' | 'failed' | 'empty' | 'populated';

    let openedData:null|hubType = $state(null)

    let charas:hubType[] = $state([])
    let hubStatus:HubStatus = $state('pending')
    let hubAnnouncement = $state('')

    let page = $state(0)
    let sort = $state('recommended')

    let search = $state('')
    let blockedCreatorsOpen = $state(false)
    let nsfw = $state(false)

    let resultsRegion:HTMLElement|undefined = $state()
    // The latest load started by the acceptance effect, so the accept button can wait for exactly
    // that load before moving focus to the results.
    let acceptanceLoad:Promise<void> = Promise.resolve()

    // Sort options in display order; the value is exactly what `getRisuHub` receives ('' is Recent).
    const sortOptions = $derived([
        { value: 'recommended', label: language.hubSortRecommended },
        { value: '', label: language.recent },
        { value: 'trending', label: language.trending },
        { value: 'downloads', label: language.downloads },
        { value: 'random', label: language.random },
    ])
    const paged = $derived(sort !== 'random' && sort !== 'recommended')

    // Monotonic generation counter: getHub() has roughly eight independent
    // call sites (search, sort, paging, NSFW toggle), each starting its own
    // 8-second-bounded request, so a slow earlier response landing after a
    // fast later one must not overwrite it. Checked before every state
    // write below -- pending, success and failure alike.
    let hubGeneration = 0

    const uid = $props.id()

    // The single guarded load entry point: every explicit control (search, sort, NSFW, paging,
    // Retry, the online listener) calls this directly, and it is inert while this view still
    // believes the upstream-services agreement needs confirming (MC-086, MC-087 #3) -- nothing
    // reaches `getRisuHub` through this path until acceptance, in any tab. The acceptance effect
    // further down calls this too, since its own `$upstreamAccepted` check already decides when a
    // call is warranted.
    async function getHub(){
        if(!$upstreamAccepted){
            return
        }

        const generation = ++hubGeneration
        hubStatus = 'pending'

        const result = await getRisuHub({
            search: search,
            page: page,
            nsfw: nsfw,
            sort: sort
        })

        if(generation !== hubGeneration){
            return
        }

        if(result.ok !== true){
            if(result.reason === 'consent'){
                // `getRisuHub` already published a fresh, negative read into `upstreamAccepted`
                // before returning this via `publishUpstreamAccepted()`
                // (`src/ts/upstreamAgreement.ts`) -- the placeholder is showing again because
                // `$upstreamAccepted` now agrees with storage, not because of anything this
                // branch still needs to do.
                return
            }
            hubStatus = result.reason === 'offline' ? 'offline' : 'failed'
            return
        }

        // Only ever assign non-empty announcements: this reproduces the old
        // module-global cache's "keep the previous value" behaviour now that
        // the value lives in per-consumer $state instead.
        if(result.additionalHTML){
            hubAnnouncement = result.additionalHTML
        }
        charas = result.cards
        hubStatus = result.cards.length > 0 ? 'populated' : 'empty'
    }

    function changeSort(type:string) {
        sort = type
        page = 0
        return getHub()
    }

    // Opens the agreement prompt; once it is accepted and the acceptance effect's load has
    // finished, focus moves to the results region. A decline or a dismissal moves nothing.
    async function acceptFromButton(){
        const accepted = await askUpstreamAgreement()
        if(!accepted){
            return
        }
        await tick()
        await acceptanceLoad
        await tick()
        resultsRegion?.focus()
    }

    async function importFromUrlOrId(){
        const input = await alertInput(language.alerts.realmInputUrlOrId, undefined, undefined, { cancel: ALERT_INPUT_CANCEL })
        if(input === ALERT_INPUT_CANCEL){
            return
        }
        if(input.startsWith("http")){
            const url = new URL(input)
            const id = url.searchParams.get("realm") ?? url.searchParams.get("code") ?? input.split("/").at(-1)
            if(id){
                downloadRisuHub(id)
                return
            }
        }
        const id = input.split("?").at(-1)
        downloadRisuHub(id)
    }

    // The one place this view loads in response to acceptance (MC-086, MC-087 #3, MC-087 #3a),
    // without tracking `search`/`page`/`nsfw`/`sort` as dependencies -- typing or paging afterwards
    // must not retrigger this effect on its own. Reruns only on a genuine transition of
    // `$upstreamAccepted` (a Svelte store skips notifying on a write that reconfirms its current
    // value), so this never becomes a second, redundant call alongside one `getHub()` already made.
    $effect(() => {
        if($upstreamAccepted){
            untrack(() => { acceptanceLoad = getHub() })
        }
    })

    $effect(() => {
        if($RealmInitialOpenChar){
            openedData = $RealmInitialOpenChar
            $RealmInitialOpenChar = null
        }
    })

    // Recover automatically: leave the offline state and reload as soon as
    // the browser reports connectivity again, instead of stranding the
    // user until they find the (inert, in that state) retry control.
    $effect(() => {
        function handleOnline() {
            if(hubStatus === 'offline'){
                getHub()
            }
        }
        window.addEventListener('online', handleOnline)
        return () => window.removeEventListener('online', handleOnline)
    })
</script>
<div class="flex w-full flex-col gap-3 pb-4">
    <header class="flex flex-wrap items-center gap-3 pl-14 pr-4 pt-4 lg:pl-4">
        <button
            type="button"
            class="risu-focus-ring flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-darkborderc bg-darkbutton px-3 text-textcolor hover:bg-selected/50"
            onclick={() => ($OpenRealmStore = false)}
        >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{language.hubBackToHome}</span>
        </button>
        <h1 class="min-w-0 text-2xl font-bold tracking-tight text-textcolor whitespace-nowrap">{language.hub}</h1>
    </header>
    <div class="flex w-full flex-wrap items-center gap-2 px-4">
        <div class="flex w-full max-w-2xl min-w-0 grow items-stretch sm:w-auto">
            <span id="{uid}-search" class="sr-only">{language.hubSearchLabel}</span>
            <input
                bind:value={search}
                aria-labelledby="{uid}-search"
                aria-describedby="{uid}-search"
                placeholder={language.hubSearchLabel}
                class="risu-focus-ring min-h-11 min-w-0 max-w-full grow rounded-md rounded-r-none border border-r-0 border-darkborderc bg-transparent px-3 text-textcolor outline-hidden"
            >
            <button
                type="button"
                aria-label={language.search}
                onclick={() => {
                    if(sort === 'random' || sort === 'recommended'){
                        sort = ''
                    }
                    page = 0
                    getHub()
                }}
                class="risu-focus-ring flex min-h-11 min-w-11 items-center justify-center rounded-md rounded-l-none border border-darkborderc bg-darkbutton text-textcolor hover:bg-selected/50"
            >
                <SearchIcon size={18} aria-hidden="true" />
            </button>
        </div>
        <label class="flex items-center gap-2 text-textcolor2">
            <span id="{uid}-sort">{language.hubSortLabel}</span>
            <select
                aria-labelledby="{uid}-sort"
                class="risu-focus-ring min-h-11 rounded-md border border-darkborderc bg-darkbutton px-2 text-textcolor"
                value={sort}
                onchange={(event) => {
                    changeSort(event.currentTarget.value)
                }}
            >
                {#each sortOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                {/each}
            </select>
        </label>
        <button
            type="button"
            aria-pressed={nsfw}
            class="risu-focus-ring min-h-11 rounded-md border px-3 text-textcolor hover:bg-selected/50 {nsfw ? 'border-selected bg-selected' : 'border-darkborderc bg-darkbutton'}"
            onclick={() => {
                nsfw = !nsfw
                getHub()
            }}
        >NSFW</button>
        <button
            type="button"
            class="risu-focus-ring min-h-11 rounded-md border border-darkborderc bg-darkbutton px-3 text-textcolor hover:bg-selected/50"
            onclick={() => {
                blockedCreatorsOpen = true
            }}
        >{language.hubBlockedCreatorsCount.replace('{count}', String((DBState.db.blockedRealmCreators ?? []).length))}</button>
        <button
            type="button"
            class="risu-focus-ring min-h-11 rounded-md border border-darkborderc bg-darkbutton px-3 text-textcolor hover:bg-selected/50"
            onclick={importFromUrlOrId}
        >{language.uiCommon.importCharacterFromUrlOrId}</button>
    </div>
    {#if hubAnnouncement}
        <section class="mx-4 rounded-xl bg-darkbg p-4 text-textcolor" aria-labelledby="hub-announcement-title">
            <h2 id="hub-announcement-title" class="mb-2 text-lg font-bold">{language.hubAnnouncementTitle}</h2>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- A keyboard Enter on a focused anchor dispatches a bubbling click, so this delegated handler already covers keyboard activation; see hubHtml.ts. -->
            <div class="wrap-anywhere [&_a]:underline" onclick={handleHubHtmlClick}>
                {@html sanitizeHubHtml(hubAnnouncement)}
            </div>
        </section>
    {/if}
    <div bind:this={resultsRegion} tabindex="-1" aria-busy={$upstreamAccepted && hubStatus === 'pending'} class="flex w-full flex-col gap-3 outline-hidden">
        {#if !$upstreamAccepted}
            <div role="status" aria-live="polite" data-testid="upstream-consent-placeholder" class="flex w-full flex-col items-center justify-center gap-3 px-4 text-textcolor2">
                <span class="text-center">{language.upstreamConsentPlaceholder}</span>
                <button
                    type="button"
                    data-testid="upstream-consent-accept"
                    class="risu-focus-ring min-h-11 rounded-md bg-selected px-4 text-textcolor hover:bg-selected/50"
                    onclick={(event) => {
                        event.stopPropagation()
                        // Only asks; the acceptance effect above is the sole thing that loads in
                        // response to whatever answer this resolves to (MC-086, MC-087 #3, MC-087 #3a).
                        acceptFromButton()
                    }}
                >{language.upstreamConsentShow}</button>
            </div>
        {:else if hubStatus === 'offline'}
            <div role="status" aria-live="polite" class="flex w-full flex-wrap items-center justify-center gap-3 px-4 text-textcolor2">
                <span>{language.hubOffline}</span>
                <button type="button" aria-disabled="true" class="risu-focus-ring min-h-11 cursor-not-allowed rounded-md border border-darkborderc bg-darkbutton px-3 opacity-50" onclick={() => {}}>{language.hubRetry}</button>
            </div>
        {:else if hubStatus === 'failed'}
            <div role="status" aria-live="polite" class="flex w-full flex-wrap items-center justify-center gap-3 px-4 text-textcolor2">
                <span>{language.hubLoadFailed}</span>
                <button type="button" class="risu-focus-ring min-h-11 rounded-md border border-darkborderc bg-darkbutton px-3 text-textcolor hover:bg-selected/50" onclick={getHub}>{language.hubRetry}</button>
            </div>
        {:else if hubStatus === 'empty'}
            <div role="status" aria-live="polite" class="flex w-full justify-center px-4 text-textcolor2">{language.hubEmpty}</div>
        {:else}
            {#if hubStatus === 'pending'}
                <div role="status" aria-live="polite" class="flex w-full items-center justify-center gap-2 px-4 text-textcolor2">
                    <div class="h-5 w-5 animate-spin rounded-full border-2 border-textcolor2 border-t-transparent"></div>
                    <span>{language.loading}...</span>
                </div>
            {/if}
            {#if charas.length > 0}
                <div class="grid w-full grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4 px-4 {hubStatus === 'pending' ? 'opacity-60' : ''}">
                    {#key charas}
                        {#each charas as chara}
                            <RisuHubIcon onClick={() =>{openedData = chara}} chara={chara} />
                        {/each}
                    {/key}
                </div>
            {/if}
        {/if}
    </div>
    <!-- Past page 0 the pager stays whatever the status, so an empty or failed later page still offers Previous. -->
    {#if paged && (hubStatus === 'populated' || hubStatus === 'pending' || page > 0)}
        <nav class="flex w-full items-center justify-center gap-2" aria-label={language.hubPageIndicator.replace('{page}', String(page + 1))}>
            <button
                type="button"
                aria-label={language.realmPrevPage}
                disabled={page === 0}
                class="risu-focus-ring flex size-11 items-center justify-center rounded-md border border-darkborderc bg-darkbutton text-textcolor hover:bg-selected/50 disabled:opacity-50"
                onclick={() => {
                    if(page > 0){
                        page -= 1
                        getHub()
                    }
                }}
            >
                <ArrowLeft size={18} aria-hidden="true" />
            </button>
            <span class="min-w-16 text-center text-textcolor2">{language.hubPageIndicator.replace('{page}', String(page + 1))}</span>
            <button
                type="button"
                aria-label={language.realmNextPage}
                disabled={hubStatus !== 'populated' && hubStatus !== 'pending'}
                class="risu-focus-ring flex size-11 items-center justify-center rounded-md border border-darkborderc bg-darkbutton text-textcolor hover:bg-selected/50 disabled:opacity-50"
                onclick={() => {
                    page += 1
                    getHub()
                }}
            >
                <ArrowRight size={18} aria-hidden="true" />
            </button>
        </nav>
    {/if}
</div>

{#if openedData}
    <RealmPopUp bind:openedData={openedData} onBlock={(creatorId) => {
        charas = charas.filter((card) => card.creator !== creatorId)
        if(charas.length === 0 && hubStatus === 'populated'){
            hubStatus = 'empty'
        }
    }} />
{/if}

{#if blockedCreatorsOpen}
    <RealmBlockedCreators onClose={() => {
        blockedCreatorsOpen = false
    }} onUnblock={getHub} />
{/if}
