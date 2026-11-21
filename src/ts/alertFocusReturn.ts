/**
 * Gives focus back to the page control that was focused when an alert covering the page opened, once the alert is gone.
 *
 * The opener is recorded synchronously when a covering value arrives, because the page goes inert and loses focus as soon
 * as the alert renders. The return runs after one `tick()`, when the alert has unmounted and the page is no longer inert,
 * and only while focus is on nowhere or the body, so a user who moved focus elsewhere keeps it. The store is read again at
 * that point: a covering value that arrived in between keeps the opener for the alert that is now shown, and the return
 * that was scheduled for the earlier value does nothing.
 */
import { tick } from 'svelte'
import { get } from 'svelte/store'
import { returnFocus } from '../lib/Nexus/pattern/patternFocus'
import { alertStore } from './stores.svelte'
import { coversPage } from './alertEscape'
import { clearAlertOpener, noteAlertOpener, pageOpener, pendingAlertOpener } from './alertOpener'

/** Starts watching the alert store; the returned function stops it. */
export function installAlertFocusReturn(): () => void {
    let stopped = false

    const unsubscribe = alertStore.subscribe((value) => {
        if (coversPage(value.type)) {
            if (pendingAlertOpener() === null) noteAlertOpener(pageOpener(document.activeElement))
            return
        }
        if (pendingAlertOpener() === null) return
        void tick().then(() => {
            if (stopped || coversPage(get(alertStore).type)) return
            const opener = pendingAlertOpener()
            clearAlertOpener()
            const active = document.activeElement
            if (active === null || active === document.body) returnFocus(opener)
        })
    })

    return () => {
        stopped = true
        unsubscribe()
    }
}
