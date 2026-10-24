<script lang="ts">
    import { popupStore } from "src/ts/stores.svelte";
    import { sleep } from "src/ts/util";
    import { onDestroy, onMount } from "svelte";
    import { backCloseHandler, registerBackHandler } from "src/ts/backHandlers";

    let styleString = $derived.by(() => {
        let styleString = '';
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const mouseX = popupStore.mouseX;
        const mouseY = popupStore.mouseY;

        if(mouseX < windowWidth / 2) {
            styleString += `left: ${mouseX}px;`;
        } else {
            styleString += `right: ${windowWidth - mouseX}px;`;
        }
        if(mouseY < windowHeight / 2) {
            styleString += `top: ${mouseY}px;`;
        } else {
            styleString += `bottom: ${windowHeight - mouseY}px;`;
        }
        return styleString;
    });

    const close = (() => {
        popupStore.children = null;
    });

    // Back does what a document click does. The effect reads no reactive state, so a popup replaced
    // by another does not re-register; the host mounts this component only while a popup is open.
    $effect(() => registerBackHandler(backCloseHandler({
        isOpen: () => Boolean(popupStore.children),
        snapshot: () => Boolean(popupStore.children),
        close,
    })))

    onMount(async () => {
        await sleep(0)
        document.addEventListener('click', close);
    })

    onDestroy(() => {
        document.removeEventListener('click', close);
    })

</script>

{#if popupStore.children}
    <div class="bg-darkbg border-darkborderc border rounded-md p-4 gap-2 flex flex-col fixed z-50 items-start" style={styleString}>
        {@render popupStore.children()}
    </div>
{/if}