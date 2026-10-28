export type ImageType = 'JPEG' | 'PNG' | 'GIF' | 'BMP' | 'AVIF' | 'WEBP' | 'Unknown'

/** How many leading bytes the type rules read. */
export const IMAGE_TYPE_HEAD_BYTES = 12

/** How many trailing bytes the type rules read. */
export const IMAGE_TYPE_TAIL_BYTES = 2

/**
 * The type of an image from the ends of its bytes: `head` holds the first bytes (at least the first
 * `IMAGE_TYPE_HEAD_BYTES` when the image has that many) and `tail` the last `IMAGE_TYPE_TAIL_BYTES` (all of an image
 * shorter than that). A caller that cannot hold the whole image, such as a streamed export, passes the ends it kept;
 * the rules are the ones `getImageType` applies to a whole array.
 */
export function imageTypeOfEnds(head: Uint8Array, tail: Uint8Array): ImageType {
    const last = tail[tail.length - 1]
    const beforeLast = tail[tail.length - 2]
    switch (true) {
        case head[0] === 0xff && head[1] === 0xd8 && beforeLast === 0xff && last === 0xd9:
            return 'JPEG'
        case head[0] === 0x89 &&
            head[1] === 0x50 &&
            head[2] === 0x4e &&
            head[3] === 0x47 &&
            head[4] === 0x0d &&
            head[5] === 0x0a &&
            head[6] === 0x1a &&
            head[7] === 0x0a:
            return 'PNG'
        case head[0] === 0x47 &&
            head[1] === 0x49 &&
            head[2] === 0x46 &&
            head[3] === 0x38 &&
            (head[4] === 0x37 || head[4] === 0x39) &&
            head[5] === 0x61:
            return 'GIF'
        case head[0] === 0x42 && head[1] === 0x4d:
            return 'BMP'
        case head[4] === 0x66 &&
            head[5] === 0x74 &&
            head[6] === 0x79 &&
            head[7] === 0x70 &&
            head[8] === 0x61 &&
            head[9] === 0x76 &&
            head[10] === 0x69 &&
            head[11] === 0x66:
            return 'AVIF'
        case head[0] === 0x52 &&
            head[1] === 0x49 &&
            head[2] === 0x46 &&
            head[3] === 0x46 &&
            head[8] === 0x57 &&
            head[9] === 0x45 &&
            head[10] === 0x42 &&
            head[11] === 0x50:
            return 'WEBP'
    }

    return 'Unknown'
}

export function getImageType(arr: Uint8Array): ImageType {
    return imageTypeOfEnds(arr.subarray(0, IMAGE_TYPE_HEAD_BYTES), arr.subarray(Math.max(0, arr.length - IMAGE_TYPE_TAIL_BYTES)))
}
