import { selectSingleFile } from './util'

// Lets the user pick an image and returns it as the preset icon: a 48x48 JPEG data URL, small enough (max 2304
// pixels) to be stored directly on the preset. Null when the pick is cancelled, so a cancelled pick writes nothing.
// The classic preset editor and the Studio preset form both use this one pipeline, so the two cannot drift.
export async function pickPresetIcon(): Promise<string | null> {
    const sel = await selectSingleFile(['png', 'jpg', 'jpeg', 'webp'])
    if (!sel) {
        return null
    }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    //@ts-expect-error Uint8Array buffer type (ArrayBufferLike) is incompatible with BlobPart's ArrayBuffer
    const blob = new Blob([sel.data], {type: "image/png"})
    img.src = URL.createObjectURL(blob)
    await img.decode()
    canvas.width = 48
    canvas.height = 48
    ctx.drawImage(img, 0, 0, 48, 48)
    return canvas.toDataURL('image/jpeg', 0.7)
}
