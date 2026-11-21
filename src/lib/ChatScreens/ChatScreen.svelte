<script lang="ts">
    import { getCustomBackground, getEmotion } from "../../ts/util";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { CharEmotion, moduleBackgroundEmbedding, selectedCharID } from "../../ts/stores.svelte";
    import ResizeBox from './ResizeBox.svelte'
    import DefaultChatScreen from "./DefaultChatScreen.svelte";
    import ChatShell from '../ChatShell/ChatShell.svelte';
    import { shellEligible } from '../../ts/chatShell/shellSwitch.svelte';
    import defaultWallpaper from '../../etc/bg.jpg'
    import ChatList from "../Others/ChatList.svelte";
    import TransitionImage from "./TransitionImage.svelte";
    import BackgroundDom from "./BackgroundDom.svelte";
    import SideBarArrow from "../UI/GUI/SideBarArrow.svelte";
    import ModuleChatMenu from "../Setting/Pages/Module/ModuleChatMenu.svelte";
    import { chatSurface } from "./chatSurface.svelte";
    import { onMount } from 'svelte';
    import { holdChatView } from '../../ts/process/chatOnScreen.svelte';
    import { useCharImageLookups } from '../../ts/media/charImageLookups';
    import { packBaseTone } from '../../ts/gui/surfaceTone';
    import { canvasYieldDeclaration, hasUserChatBackground } from '../../ts/gui/chatBackground';
    let openChatList = $state(false)
    let openModuleList = $state(false)

    // A mounted ChatScreen is one of the conditions for a chat to count as on screen; the release runs on destroy.
    onMount(() => holdChatView())

    // Opening Settings closes the chat and module menus.
    let seenCloseEpoch = chatSurface.closeEpoch
    $effect(() => {
        const epoch = chatSurface.closeEpoch
        if(epoch === seenCloseEpoch){
            return
        }
        seenCloseEpoch = epoch
        openChatList = false
        openModuleList = false
    })

    const wallPaper = `background: url(${defaultWallpaper})`
    const overlayBackground = $derived(DBState.db.textScreenColor ? (DBState.db.textScreenColor + '80') : "rgba(0,0,0,0.8)")
    const externalStyles = $derived(
            ("background: " + overlayBackground + ';\n')
        +   (DBState.db.textBorder ? "text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;" : '')
        +   (DBState.db.textScreenRounded ? "border-radius: 2rem; padding: 1rem;" : '')
        +   (DBState.db.textScreenBorder ? `border: 0.3rem solid ${DBState.db.textScreenBorder};` : ''))
    // One hold per read position of this screen: the background and the waifu portrait.
    const lookups = useCharImageLookups()
    let bgImg= $state('')
    let lastBg = $state('')
    $effect.pre(() => {
        (async () =>{
            if(DBState.db.customBackground !== lastBg){
                lastBg = DBState.db.customBackground
                bgImg = await getCustomBackground(DBState.db.customBackground, lookups)
            }
        })()
    });
    const userBackground = $derived(hasUserChatBackground({
        customImageStyle: bgImg,
        backgroundHTML: DBState.db.characters[$selectedCharID]?.backgroundHTML,
        moduleEmbedding: $moduleBackgroundEmbedding,
        selected: $selectedCharID >= 0,
    }))
    // Only a pack in colour mode paints the canvas parts, so only then is there anything for the user's background to outrank.
    const canvasYield = $derived(userBackground && $packBaseTone !== null)
    const shellStyle = $derived((bgImg.length > 2 ? externalStyles : '') + (canvasYield ? canvasYieldDeclaration(bgImg.length > 2 ? overlayBackground : null) : ''))
</script>

{#if DBState.db.theme === 'waifu'}
    <div class="grow h-full flex justify-center relative" style="{bgImg.length < 4 ? wallPaper : bgImg}">
        <SideBarArrow />
        <BackgroundDom />
        {#if $selectedCharID >= 0}
            {#if DBState.db.characters[$selectedCharID] && DBState.db.characters[$selectedCharID].viewScreen !== 'none'}
                <div class="h-full mr-10 flex justify-end halfw" style:width="{42 * (DBState.db.waifuWidth2 / 100)}rem">
                    <TransitionImage classType="waifu" src={getEmotion(DBState.db, $CharEmotion, 'plain', lookups)}/>
                </div>
            {/if}
        {/if}
        <div class="h-full w-2xl" style:width="{42 * (DBState.db.waifuWidth / 100)}rem" class:halfwp={$selectedCharID >= 0 && DBState.db.characters[$selectedCharID] && DBState.db.characters[$selectedCharID].viewScreen !== 'none'}>
            <DefaultChatScreen customStyle={`${externalStyles}backdrop-filter: blur(4px);`} bind:openChatList bind:openModuleList/>
        </div>
    </div>
{:else}
    <div class="chat-area grow h-full min-w-0 relative justify-center flex" data-user-background={userBackground ? '' : undefined}>
        {#if !shellEligible()}
            <SideBarArrow />
        {/if}
        <BackgroundDom />
        <div style={bgImg} class="h-full w-full" class:max-w-6xl={DBState.db.classicMaxWidth}>
            {#if $selectedCharID >= 0}
                {#if DBState.db.characters[$selectedCharID] && DBState.db.characters[$selectedCharID].viewScreen !== 'none' && (DBState.db.characters[$selectedCharID].type === 'group' || (!DBState.db.characters[$selectedCharID].inlayViewScreen))}
                    <ResizeBox />
                {/if}
            {/if}
            {#if shellEligible()}
                <ChatShell customStyle={shellStyle} {userBackground} {canvasYield} bind:openChatList bind:openModuleList />
            {:else}
                <DefaultChatScreen customStyle={bgImg.length > 2 ? `${externalStyles}`: ''} bind:openChatList bind:openModuleList/>
            {/if}
        </div>
    </div>
{/if}
{#if openChatList}
    <ChatList close={() => {openChatList = false}}/>
{:else if openModuleList}
    <ModuleChatMenu close={() => {openModuleList = false}}/>
{/if}

<style>
    /* Under a theme pack, a chat area with no user background is the pack canvas over black. A user background (custom image, card or module background) is always shown, and the card background is never hidden. */
    :global(:root:where([data-theme-pack-base])) .chat-area:not([data-user-background]) { background-color: var(--surface-pack-backdrop); background-image: linear-gradient(var(--nexus-canvas), var(--nexus-canvas)); }
    .halfw{
        max-width: calc(50% - 5rem);
    }
    .halfwp{
        max-width: calc(50% - 5rem);
    }
</style>
