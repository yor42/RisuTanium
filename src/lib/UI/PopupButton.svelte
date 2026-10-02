<script lang="ts">
    import { MenuIcon } from "@lucide/svelte";
    import { popupStore } from "src/ts/stores.svelte";
    import { sleep } from "src/ts/util";

    const {
        children
    }:{
        children: import("svelte").Snippet
    } = $props();
    
    let buttonId = Math.random()
</script>

<button onclick={async (e:MouseEvent) => {
    // The open state is read before the yield: PopupList's document click listener
    // closes the popup during this same click, and the toggle must act on what the user saw.
    const wasOpen = popupStore.children !== null && popupStore.openId === buttonId
    const mouseX = e.clientX
    const mouseY = e.clientY
    await sleep(0)
    if(wasOpen){
        popupStore.children = null
        popupStore.openId = 0
        return
    }
    popupStore.mouseX = mouseX
    popupStore.mouseY = mouseY
    popupStore.children = children
    popupStore.openId = buttonId
}} class="hover:text-blue-500 transition-colors button-icon-menu">
    <MenuIcon size={20} />
</button>