<script lang="ts">
    import { untrack } from "svelte";
    import { downloadRisuHub, getRisuHub, type hubType } from "src/ts/characterCards";
    import { handleHubHtmlClick, sanitizeHubHtml } from "src/ts/hubHtml";
    import { ArrowLeft, ArrowRight, MenuIcon, SearchIcon, XIcon } from "@lucide/svelte";
    import { alertInput } from "src/ts/alert";
    import { language } from "src/lang";
    import RisuHubIcon from "./RealmHubIcon.svelte";
    import { MobileGUI, RealmInitialOpenChar } from "src/ts/stores.svelte";
    import RealmPopUp from "./RealmPopUp.svelte";
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
    let menuOpen = $state(false)
    let nsfw = $state(false)

    // Monotonic generation counter: getHub() has roughly eight independent
    // call sites (search, sort, paging, NSFW toggle), each starting its own
    // 8-second-bounded request, so a slow earlier response landing after a
    // fast later one must not overwrite it. Checked before every state
    // write below -- pending, success and failure alike.
    let hubGeneration = 0

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
        if(sort === type){
            sort = 'recommended'
        }else{
            sort = type
        }
        page = 0
        return getHub()
    }

    // The one place this view loads in response to acceptance (MC-086, MC-087 #3, MC-087 #3a),
    // without tracking `search`/`page`/`nsfw`/`sort` as dependencies -- typing or paging afterwards
    // must not retrigger this effect on its own. Reruns only on a genuine transition of
    // `$upstreamAccepted` (a Svelte store skips notifying on a write that reconfirms its current
    // value), so this never becomes a second, redundant call alongside one `getHub()` already made.
    $effect(() => {
        if($upstreamAccepted){
            untrack(() => { getHub() })
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
<div class="w-full flex justify-center mt-4 mb-2">
    <div class="flex items-stretch w-2xl max-w-full">
        <input bind:value={search} class="peer focus:border-textcolor transition-colors outline-hidden text-textcolor p-2 min-w-0 border border-r-0 bg-transparent rounded-md rounded-r-none input-text text-xl grow ml-4 border-darkborderc resize-none overflow-y-hidden overflow-x-hidden max-w-full">
            <button
            onclick={() => {
                if(sort === 'random' || sort === 'recommended'){
                    sort = ''
                }
                page = 0
                getHub()
            }}
                class="flex justify-center border-y border-darkborderc items-center text-textcolor p-3 peer-focus:border-textcolor hover:bg-blue-500 hover:text-white transition-colors"
        >
            <SearchIcon />
        </button>
        <button
            onclick={(e) => {
                menuOpen = true
            }}
                class="peer-focus:border-textcolor mr-2 flex border-y border-r border-darkborderc justify-center items-center text-textcolor p-3 rounded-r-md hover:bg-blue-500 hover:text-white transition-colors"
        >
            <MenuIcon />
        </button>
    </div>
</div>
{#if $MobileGUI}
<div class="ml-4 flex items-start ">
    <div class="p-2 flex mb-3 overflow-x-auto rounded-lg border-darkborderc border gap-2">
        <button onclick={() => {
            nsfw = !nsfw
            getHub()
        }}>
            {nsfw ? 'NSFW' : 'SFW'}
        </button>
        <div class="h-full border-r border-r-selected"></div>
        <button onclick={() => {
            switch(sort){
                case '':
                    sort = 'trending'
                    break
                case 'trending':
                    sort = 'downloads'
                    break
                case 'downloads':
                    sort = 'random'
                    break
                default:
                    sort = ''
                    break
            }
            getHub()
        }}>
            {
                sort === 'recommended' ? language.recommended :
                sort === '' ? language.recent : 
                sort === 'trending' ? language.trending :
                sort === 'downloads' ? language.downloads :
                language.random
            }
        </button>
    </div>
</div>
{:else}
    <div class="w-full p-1 flex mb-3 overflow-x-auto sm:justify-center">
        <button class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow" class:ring-3={nsfw} onclick={() => {
            nsfw = !nsfw
            getHub()
        }}>
            NSFW
        </button>
        <div class="ml-2 mr-2 h-full border-r border-r-selected"></div>
        <button class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow" class:ring-3={sort === ''} onclick={() => {
            changeSort('')
        }}>
            {language.recent}
        </button>
        <button class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow" class:ring-3={sort === 'trending'} onclick={() => {
            changeSort('trending')
        }}>
            {language.trending}
        </button>
        <button class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow" class:ring-3={sort === 'downloads'} onclick={() => {
            changeSort('downloads')
        }}>
            {language.downloads}
        </button>
        <button class="bg-darkbg p-2 rounded-lg ml-2 flex justify-center items-center hover:bg-selected transition-shadow min-w-0 max-w-full" class:ring-3={sort === 'random'} onclick={() => {
            changeSort('random')
        }}>
            {language.random}
        </button>
    </div>
{/if}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- A keyboard Enter on a focused anchor dispatches a bubbling click, so this delegated handler already covers keyboard activation; see hubHtml.ts. -->
<div onclick={handleHubHtmlClick}>
    {@html sanitizeHubHtml(hubAnnouncement)}
</div>
{#if !$upstreamAccepted}
    <div role="status" aria-live="polite" data-testid="upstream-consent-placeholder" class="w-full flex flex-col justify-center items-center gap-2 text-textcolor2">
        <span>{language.upstreamConsentPlaceholder}</span>
        <button
            data-testid="upstream-consent-accept"
            onclick={(event) => {
                event.stopPropagation()
                // Only asks; the acceptance effect above is the sole thing that loads in
                // response to whatever answer this resolves to (MC-086, MC-087 #3, MC-087 #3a).
                askUpstreamAgreement()
            }}
        >{language.upstreamConsentShow}</button>
    </div>
{:else if hubStatus === 'offline'}
    <div role="status" aria-live="polite" class="w-full flex justify-center items-center gap-2 text-textcolor2">
        <span>{language.hubOffline}</span>
        <button aria-disabled="true" class="cursor-not-allowed opacity-50" onclick={() => {}}>{language.hubRetry}</button>
    </div>
{:else if hubStatus === 'failed'}
    <div role="status" aria-live="polite" class="w-full flex justify-center items-center gap-2 text-textcolor2">
        <span>{language.hubLoadFailed}</span>
        <button onclick={getHub}>{language.hubRetry}</button>
    </div>
{:else if hubStatus === 'empty'}
    <div role="status" aria-live="polite" class="w-full flex justify-center text-textcolor2">{language.hubEmpty}</div>
{:else}
    <div class="w-full flex gap-4 p-2 flex-wrap justify-center">
        {#key charas}
            {#each charas as chara}
                <RisuHubIcon onClick={() =>{openedData = chara}} chara={chara} />
            {/each}
        {/key}
    </div>
{/if}
{#if sort !== 'random' && sort !== 'recommended'}
    <div class="w-full flex justify-center">
        <div class="flex">
            <button class="bg-darkbg h-14 w-14 min-w-14 rounded-lg flex justify-center items-center hover:ring-3 transition-shadow" onclick={() => {
                if(page > 0){
                    page -= 1
                    getHub()
                }
            }}>
                <ArrowLeft />
            </button>
            <button class="bg-darkbg h-14 w-14 min-w-14 rounded-lg ml-2 flex justify-center items-center transition-shadow">
                <span>{page + 1}</span>
            </button>
            <button class="bg-darkbg h-14 w-14 min-w-14 rounded-lg ml-2 flex justify-center items-center hover:ring-3 transition-shadow" onclick={() => {
                page += 1
                getHub()
            }}>
                <ArrowRight />
            </button>
        </div>
    </div>
{/if}

{#if openedData}
    <RealmPopUp bind:openedData={openedData} />
{/if}


{#if menuOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="top-0 left-0 z-50 fixed w-full h-full bg-black/50 flex justify-center items-center" role="button" tabindex="0" onclick={() => {
        menuOpen = false
    }}>
        <div class="max-w-full bg-darkbg rounded-md flex flex-col gap-4 overflow-y-auto p-4">
            <h1 class="font-bold text-2xl w-full">
                <span>
                    {language.menu}
                </span>
                <button class="float-right text-textcolor2 hover:text-green-500" onclick={() => {menuOpen = false}}>
                    <XIcon />
                </button>
            </h1>
            <div class=" mt-2 w-full border-t-2 border-t-bgcolor"></div>
            <button class="w-full hover:bg-selected p-4" onclick={(async (e) => {
                e.stopPropagation()
                menuOpen = false
                const input = await alertInput(language.alerts.realmInputUrlOrId)
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

            })}>{language.uiCommon.importCharacterFromUrlOrId}</button>
        </div>
    </div>
{/if}