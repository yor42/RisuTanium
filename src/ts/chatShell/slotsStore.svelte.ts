import { readSlots, writeSlots, type ActionSlots } from './actionSlots'

// One reactive copy of the device-local action layout. Every message row and every customize sheet reads it and
// changes it only through updateSlots, so no instance can write back a layout older than the latest change.
const store = $state<{ slots: ActionSlots }>({ slots: readSlots() })
// What device storage held when the shared copy last agreed with it; an unwritable storage keeps the session layout.
let storedSerial = JSON.stringify(readSlots())

export function currentSlots(): ActionSlots {
    return store.slots
}

// Adopts the stored layout when storage changed behind the shared copy, for example another tab.
export function syncSlots(): void {
    const stored = readSlots()
    const serial = JSON.stringify(stored)
    if (serial === storedSerial) return
    storedSerial = serial
    store.slots = stored
}

export function updateSlots(next: ActionSlots): void {
    store.slots = next
    writeSlots(next)
    storedSerial = JSON.stringify(readSlots())
}
