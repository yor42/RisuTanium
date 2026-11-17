<script module lang="ts">
    // Must exceed the 0.5s .old-image animation, so a normal fade ends on animationend; the timer only covers a
    // fade whose animationend never fires.
    export const FADE_FALLBACK_MS = 1000
</script>

<script lang="ts">
    import { onDestroy } from "svelte";
    import { language } from "src/lang";
    import { currentPortraitMaxSide } from "src/ts/media/portraitDisplay";
    import { portraitCache, type DisplayImage } from "src/ts/media/portraitVariants";
    // Replaced wholesale, never mutated.
    let currentSrc:DisplayImage[] = $state.raw([])
    let oldSrc:DisplayImage[] = $state.raw([]);
    let showOldImage = $state(false);
    let styleType:string = $state('normal')
    let oldStyleType:string = $state('normal')

    interface Props {
        src?: string[]|Promise<string[]>;
        classType: 'waifu'|'risu'|'mobile';
    }

    let { src = [], classType }: Props = $props();

    // Plain counters, never state: they are written inside the effect that calls processSrc.
    let requestSeq = 0
    let fadeTimer: ReturnType<typeof setTimeout> | undefined
    // The originals and style marker last committed. Plain, so comparing against them is never a dependency.
    let shownOriginals: string[] = []
    let shownStyle = 'normal'
    // The seq whose shrunk set is being waited for; 0 when none.
    let requestingSeq = 0
    // This instance's references into the app-wide shrunk-portrait store.
    const holder = portraitCache().createHolder()

    // What is on screen now, including the old layer while it fades. Reads state: call it only after the
    // first await of processSrc, so the effect that calls processSrc depends on `src` alone.
    function rendered(): DisplayImage[] {
        return showOldImage ? [...currentSrc, ...oldSrc] : currentSrc
    }

    async function processSrc(src:string[]|Promise<string[]>) {
        // Only the most recently started request may change what is displayed; a superseded one,
        // whatever its outcome, is discarded.
        const seq = ++requestSeq
        let resolved:string[]
        try {
            resolved = await src
        } catch (reason) {
            console.warn('TransitionImage: emotion images rejected', reason)
            if (seq === requestSeq) holder.retain(rendered())
            return
        }
        if (seq !== requestSeq) return

        let styl = shownStyle
        let resultSrc = resolved
        // The leading entry is always the style marker, never an image; a lone marker leaves nothing to render.
        // The received array is never mutated: the producer may hand the same array to another render.
        if(resolved.length > 0){
            styl = resolved[0]
            resultSrc = resolved.slice(1)
        }
        if (JSON.stringify(resultSrc) === JSON.stringify(shownOriginals) && styl === shownStyle) {
            holder.retain(rendered())
            return
        }

        let display:DisplayImage[]
        const maxSide = currentPortraitMaxSide()
        if (maxSide === null) {
            display = resultSrc.map((original) => ({ src: original }))
        } else {
            // On a phone the previous portrait stays until the shrunk set is ready.
            requestingSeq = seq
            const shrunk = await holder.request(resultSrc, maxSide, rendered())
            if (requestingSeq === seq) requestingSeq = 0
            if (seq !== requestSeq || shrunk === null) return
            display = shrunk
        }

        stopFade()
        if(currentSrc.length === 0){
            currentSrc = display
            styleType = styl
        }
        else{
            oldSrc = currentSrc
            oldStyleType = styleType
            currentSrc = display
            styleType = styl
            showOldImage = true;
            fadeTimer = setTimeout(handleTransitionEnd, FADE_FALLBACK_MS)
        }
        shownOriginals = resultSrc
        shownStyle = styl
        holder.retain(rendered())
    }

    // Ends a fade without releasing anything; the caller releases once the new set is in place.
    function stopFade(): boolean {
        clearTimeout(fadeTimer)
        fadeTimer = undefined
        if (showOldImage) {
            showOldImage = false;
            return true
        }
        return false
    }

    function handleTransitionEnd() {
        // The old set's references end with its fade, unless a newer shrunk set is being waited for: that
        // request holds references `rendered()` does not list yet.
        if (stopFade() && requestingSeq === 0) holder.retain(rendered())
    }

    $effect.pre(() => {
        processSrc(src)
    });

    onDestroy(() => {
        requestSeq++
        clearTimeout(fadeTimer)
        // Cached URLs stay for the next instance; only this instance's references end.
        holder.dispose()
    })



</script>

<style>
    .image-container {
      position: relative;
      overflow: hidden;
    }

    .image-container img {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: scale-down;
      object-position: 50% 100%;
    }

    .old-image {
        animation: fadeOutFromNone 0.5s ease-out;
    }

    .new-image {
        animation: fadeInFromNone 0.5s ease-out;
    }
    .img-waifu{
        width: 100%; height: 90vh;
        margin-top: 10vh;
    }

    .img-mobile{
        width: 100%;
        height: 100%;
    }

    .img-risu{
        width: 100%;
        position: absolute;
        bottom: 0;
        left: 0;
        height: 100%;
    }

    @keyframes fadeInFromNone {
        0% {
            opacity: 0;
        }

        100% {
            opacity: 1;
        }
    }
    @keyframes fadeOutFromNone {
        0% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }
</style>

{#if currentSrc && currentSrc.length > 0}
    <div class="image-container"
        class:img-waifu={classType === 'waifu'}
        class:img-risu={classType === 'risu'}
        class:img-mobile={classType === 'mobile'}>
        {#if !showOldImage}
            {#each currentSrc as img, i}
                {#if styleType === 'normal'}
                    <img
                        src={img.src}
                        width={img.width}
                        height={img.height}
                        decoding="async"
                        alt={language.uiCommon.imageAlt}
                        style:width={`${100 / currentSrc.length}%`}
                        style:left={`${100 / currentSrc.length * i}%`}
                    />
                {:else if styleType === 'emp'}
                    {#if i <= 1}
                        <img
                            src={img.src}
                            width={img.width}
                            height={img.height}
                            decoding="async"
                            alt={language.uiCommon.imageAlt}
                            style:width={`${80 - (i*10)}%`}
                            style:left={`${30-(i*30)}%`}
                            style:z-index={9 - i}
                        />
                    {/if}
                {/if}
            {/each}
        {:else}
            {#if oldStyleType === 'normal'}
                {#each oldSrc as img2, i}
                    <img
                        src={img2.src}
                        width={img2.width}
                        height={img2.height}
                        decoding="async"
                        alt={language.uiCommon.imageAlt}
                        class="old-image"
                        onanimationend={handleTransitionEnd}
                        style:width={`${100 / oldSrc.length}%`}
                        style:left={`${100 / oldSrc.length * i}%`}
                    />
                {/each}
            {:else if oldStyleType === 'emp'}
                
                {#each oldSrc as img2, i}
                    {#if i <= 1}
                        <img
                            src={img2.src}
                            width={img2.width}
                            height={img2.height}
                            decoding="async"
                            alt={language.uiCommon.imageAlt}
                            class="old-image"
                            onanimationend={handleTransitionEnd}
                            style:width={`${80 - (i*10)}%`}
                            style:left={`${30-(i*30)}%`}
                            style:z-index={9 - i}
                        />
                    {/if}
                {/each}
            {/if}
            {#if styleType === 'normal'}
                {#each currentSrc as img3, i}
                    <img
                        src={img3.src}
                        width={img3.width}
                        height={img3.height}
                        decoding="async"
                        alt={language.uiCommon.imageAlt}
                        class="new-image"
                        style:width={`${100 / currentSrc.length}%`}
                        style:left={`${100 / currentSrc.length * i}%`}
                    />
                {/each}
            {:else if styleType === 'emp'}

                {#each currentSrc as img3, i}
                    {#if i <= 1}
                        <img
                            src={img3.src}
                            width={img3.width}
                            height={img3.height}
                            decoding="async"
                            alt={language.uiCommon.imageAlt}
                            class="new-image"
                            style:width={`${80 - (i*10)}%`}
                            style:left={`${30-(i*30)}%`}
                            style:z-index={9 - i}
                        />
                    {/if}
                {/each}
            {/if}
        {/if}
    </div>
{/if}
