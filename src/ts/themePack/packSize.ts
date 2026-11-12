// MC-1354: an "exceptionally large" pack gets a warning, never a rejection. 20 MB is read as 20 MiB, the repository's
// convention for byte sizes, and counts the uncompressed total of the stylesheets and every bundled asset of the pack.
export const PACK_SIZE_WARN_BYTES = 20 * 1024 * 1024

export interface PackSizeVerdict {
    warn: boolean
    limitBytes: number
}

export function packSizeWarning(totalBytes: number): PackSizeVerdict {
    return { warn: totalBytes > PACK_SIZE_WARN_BYTES, limitBytes: PACK_SIZE_WARN_BYTES }
}
