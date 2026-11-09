/**
 * A one-bit signal from the cold-character restore to the save loop: a character became resident since the loop last
 * asked. A load is activity that ends the idle net's back-off. A leaf with no imports, so the restore path and the loop
 * can both reach it without a cycle.
 */
let loaded = false

/** Records that a character was installed in place of its stub. */
export function noteResidentLoaded(): void {
    loaded = true
}

/** True once after a load was noted; clears the flag. */
export function takeResidentLoaded(): boolean {
    const was = loaded
    loaded = false
    return was
}
