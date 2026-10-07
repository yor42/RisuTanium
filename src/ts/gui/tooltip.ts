import tippy, { type Instance } from 'tippy.js'
import 'tippy.js/dist/tippy.css';
import 'tippy.js/themes/translucent.css';

export function tooltip(node:HTMLElement, tip:string) {
    const instance = tippy(node, {
        content: tip,
        animation: 'fade',
        arrow: true,
        theme: 'translucent',
    })
    return {
        update(newTip: string) {
            instance.setContent(newTip)
        },
        destroy() {
            instance.destroy()
        }
    };
}

export function tooltipRight(node:HTMLElement, tip:string) {
    const instance = tippy(node, {
        content: tip,
        animation: 'fade',
        arrow: true,
        placement: 'right',
        theme: 'translucent',
    })
    return {
        update(newTip: string) {
            instance.setContent(newTip)
        },
        destroy() {
            instance.destroy()
        }
    };
}

let railTooltipsSuppressed = false
const railTooltips = new Set<Instance>()

/**
 * While a press or drag is running on the sidebar rail, its tooltips stay closed and any
 * open one is hidden, so a long-press or a drag never has a tooltip over the avatars.
 */
export function setRailTooltipsSuppressed(suppressed: boolean) {
    railTooltipsSuppressed = suppressed
    if (suppressed) {
        for (const instance of railTooltips) {
            instance.hide()
        }
    }
}

/** A `tooltipRight` for the sidebar rail: not shown on touch, and closed during a press or drag. */
export function tooltipRail(node:HTMLElement, tip:string) {
    const instance = tippy(node, {
        content: tip,
        animation: 'fade',
        arrow: true,
        placement: 'right',
        theme: 'translucent',
        touch: false,
        onShow: () => {
            if (railTooltipsSuppressed) {
                return false
            }
        },
    })
    railTooltips.add(instance)
    return {
        update(newTip: string) {
            instance.setContent(newTip)
        },
        destroy() {
            railTooltips.delete(instance)
            instance.destroy()
        }
    };
}
