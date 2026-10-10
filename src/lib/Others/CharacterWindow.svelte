<script lang="ts">
    import { onDestroy, tick, untrack, type Snippet } from "svelte";
    import { buildSlices, computeWindow } from "../SideBars/railWindow";
    import { UNMEASURED_VIEWPORT_PX, WINDOW_MIN_OVERSCAN_ROWS, WINDOW_OVERSCAN_VIEWPORTS } from "../SideBars/railConstants";
    import { anchorAt, buildRowLayout, heightDeltaAbove, scrollTopFor, type CharRow, type ScrollAnchor } from "./charListRows";

    interface Props {
        rows: readonly CharRow[];
        // Height of a row that has not been measured yet.
        fallbackHeight: number;
        // Measured row heights by row key. The owner may keep the map alive across
        // this component's life (a saved scroll anchor only works against the
        // heights it was taken with); this component is its only writer.
        heights?: Map<string, number>;
        // A change scrolls to the top. The first value never does.
        resetToken?: string | number;
        // Scrolled to once, when the component is created.
        initialAnchor?: ScrollAnchor | null;
        // Applied to every row's wrapper, which is the measured box: spacing
        // between rows belongs here (padding), not on the card, because margins
        // are not part of a measured border box.
        rowClass?: string;
        class?: string;
        card: Snippet<[cardKey: string, position: number]>;
    }

    let { rows, fallbackHeight, heights = new Map<string, number>(), resetToken, initialAnchor = null, rowClass = "", class: className = "", card }: Props = $props();

    //#region geometry

    let measureTick = $state(0);
    const layout = $derived.by(() => {
        void measureTick;
        return buildRowLayout(rows, heights, fallbackHeight);
    });
    const rowByKey = $derived(new Map(rows.map((row) => [row.key, row])));
    const rowByCard = $derived(new Map(rows.flatMap((row) => row.cards.map((cardKey) => [cardKey, row] as const))));

    // A measurement outlives the row's element, so a row that is scrolled out and back
    // keeps its height and the offsets above it never move again. It is dropped with its row.
    $effect(() => {
        const live = new Set(rows.map((row) => row.key));
        untrack(() => {
            for (const key of Array.from(heights.keys())) {
                if (!live.has(key)) {
                    heights.delete(key);
                }
            }
        });
    });

    //#endregion

    //#region window

    let scroller: HTMLDivElement;
    // The scroll position and height the window is computed from. They are written from
    // the container's own values only: on a scroll (one read per frame), on a size report
    // and when a height correction moves the container.
    let viewScrollTop = $state(0);
    // The last non-zero height the container reported; 0 until it has reported one.
    let viewportH = $state(0);
    const windowViewport = $derived(
        viewportH > 0 ? viewportH : typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : UNMEASURED_VIEWPORT_PX,
    );
    const overscanPx = $derived(Math.max(WINDOW_OVERSCAN_VIEWPORTS * windowViewport, WINDOW_MIN_OVERSCAN_ROWS * fallbackHeight));

    // The row holding focus stays mounted wherever the window is, so scrolling never destroys the
    // element a keyboard user is on.
    let focusedCard: string | null = $state(null);
    const pinnedKeys = $derived.by(() => {
        const row = focusedCard === null ? undefined : rowByCard.get(focusedCard);
        return row ? [row.key] : [];
    });
    const mountedWindow = $derived(computeWindow(layout, viewScrollTop, windowViewport, overscanPx, pinnedKeys));
    const slices = $derived(buildSlices(layout, mountedWindow));

    function readViewport(el: HTMLElement) {
        viewScrollTop = el.scrollTop;
        if (el.clientHeight > 0) {
            viewportH = el.clientHeight;
        }
    }

    // The container clamps its scroll position when the content shrinks, and says so only
    // with a scroll event; the window follows the container, not the position it last read.
    $effect(() => {
        void layout;
        untrack(() => {
            if (scroller && scroller.scrollTop !== viewScrollTop) {
                viewScrollTop = scroller.scrollTop;
            }
        });
    });

    let lastResetToken = untrack(() => resetToken);
    $effect(() => {
        const token = resetToken;
        if (token === lastResetToken) {
            return;
        }
        lastResetToken = token;
        untrack(() => {
            if (scroller) {
                scroller.scrollTop = 0;
                viewScrollTop = 0;
            }
        });
    });

    /** The row at the top of the viewport; null when the list is empty. */
    export function getAnchor(): ScrollAnchor | null {
        return scroller ? anchorAt(layout, scroller.scrollTop) : null;
    }

    //#endregion

    //#region measuring

    const measuredKeys = new WeakMap<Element, string>();
    // True from an observer delivery until the frame after it. A row that mounts meanwhile (the layout
    // change of that delivery mounts rows in a later microtask) is observed on the next frame.
    let delivering = false;
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((records) => {
        delivering = true;
        requestAnimationFrame(() => {
            delivering = false;
        });
        let rectMoved = false;
        const changes: Array<[string, number]> = [];
        for (const record of records) {
            if (record.target === scroller) {
                rectMoved = true;
                continue;
            }
            // A hidden or collapsed container reports zero sizes; the last good heights stay.
            if (scroller.clientHeight === 0) {
                continue;
            }
            const key = measuredKeys.get(record.target);
            if (key === undefined) {
                continue;
            }
            const height = record.borderBoxSize?.[0]?.blockSize ?? record.contentRect.height;
            if (height > 0 && heights.get(key) !== height && layout.indexByKey.has(key)) {
                changes.push([key, height]);
            }
        }
        if (changes.length > 0) {
            // A row above the viewport that changes height would move everything below it, so the
            // container is moved by the same amount before the new layout is drawn; the cached
            // position is updated in the same step so the window is computed from where the
            // container now is. The layout used for the sum is the one before the change.
            const delta = heightDeltaAbove(layout, scroller.scrollTop, changes);
            for (const [key, height] of changes) {
                heights.set(key, height);
            }
            if (delta !== 0) {
                scroller.scrollTop += delta;
                viewScrollTop = scroller.scrollTop;
            }
            measureTick++;
        }
        if (rectMoved) {
            // Also the report after a hidden container is shown again: the window follows the DOM.
            readViewport(scroller);
        }
    });

    // A row is observed at once, so its height is known in the frame it appears in. While an observer
    // delivery is in progress it waits for the next frame instead: a row that joins the observer at the
    // depth it is already delivering would report in the same frame, and the browser would raise a
    // "loop completed with undelivered notifications" error.
    function measure(node: HTMLElement, key: string) {
        measuredKeys.set(node, key);
        let frame: number | null = null;
        if (delivering) {
            frame = requestAnimationFrame(() => {
                frame = null;
                if (node.isConnected) {
                    resizeObserver?.observe(node);
                }
            });
        } else {
            resizeObserver?.observe(node);
        }
        return {
            destroy() {
                if (frame !== null) {
                    cancelAnimationFrame(frame);
                }
                resizeObserver?.unobserve(node);
                measuredKeys.delete(node);
            },
        };
    }

    //#endregion

    //#region focus

    // Focus moves while a keyed each-block moves a focused row, and Chromium fires focusout
    // synchronously inside that block effect, where writing state throws. The pin is
    // settled in a microtask, from where focus actually is by then.
    function settleFocus() {
        queueMicrotask(() => {
            if (!scroller?.isConnected) {
                return;
            }
            const active = document.activeElement;
            const holder = active instanceof Element && scroller.contains(active) ? active.closest("[data-charlist-key]") : null;
            const next = holder?.getAttribute("data-charlist-key") ?? null;
            if (next !== focusedCard) {
                focusedCard = next;
            }
        });
    }

    // A focused row that leaves the list (deleted, restored, filtered out) takes focus with
    // it; the container receives it so keyboard users are not thrown to the page.
    $effect(() => {
        const card = focusedCard;
        if (card === null || rowByCard.has(card)) {
            return;
        }
        untrack(() => {
            focusedCard = null;
        });
        void tick().then(() => {
            const active = document.activeElement;
            if (scroller?.isConnected && (!active || active === document.body)) {
                scroller.focus();
            }
        });
    });

    //#endregion

    let viewFrame: number | null = null;

    function bindScroller(node: HTMLDivElement) {
        resizeObserver?.observe(node);
        if (initialAnchor) {
            node.scrollTop = scrollTopFor(layout, initialAnchor);
        }
        readViewport(node);
        const onScroll = () => {
            if (viewFrame === null) {
                viewFrame = requestAnimationFrame(() => {
                    viewFrame = null;
                    readViewport(node);
                });
            }
        };
        node.addEventListener("scroll", onScroll);
        node.addEventListener("focusin", settleFocus);
        node.addEventListener("focusout", settleFocus);
        return {
            destroy() {
                node.removeEventListener("scroll", onScroll);
                node.removeEventListener("focusin", settleFocus);
                node.removeEventListener("focusout", settleFocus);
                if (viewFrame !== null) {
                    cancelAnimationFrame(viewFrame);
                    viewFrame = null;
                }
                resizeObserver?.unobserve(node);
            },
        };
    }

    onDestroy(() => {
        resizeObserver?.disconnect();
    });
</script>

<!-- The container is the only scroller of the list. It does not anchor natively: the spacers would confuse it, and the height corrections above do the job. -->
<div
    bind:this={scroller}
    use:bindScroller
    role="list"
    tabindex="-1"
    class="overflow-y-auto outline-none {className}"
    style="overflow-anchor: none;"
    data-charlist-total={layout.total}
>
    {#each slices as slice (slice.key)}
        {#if slice.kind === "spacer"}
            <div aria-hidden="true" data-charlist-spacer style:height="{slice.height}px" style:min-height="{slice.height}px"></div>
        {:else}
            {@const row = rowByKey.get(slice.key)}
            {#if row}
                {@const position = (layout.indexByKey.get(row.key) ?? 0) + 1}
                <div
                    role="listitem"
                    class={rowClass}
                    aria-setsize={rows.length}
                    aria-posinset={position}
                    data-charlist-key={row.cards[0]}
                    use:measure={row.key}
                >
                    {#each row.cards as cardKey (cardKey)}
                        {@render card(cardKey, position)}
                    {/each}
                </div>
            {/if}
        {/if}
    {/each}
</div>
