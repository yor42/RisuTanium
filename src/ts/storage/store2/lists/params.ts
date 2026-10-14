/**
 * Writer parameters of the derived lists.
 */

/** Default size above which an inlay list body is replaced by the overflow marker: 8 MiB of serialised JSON. */
export const DEFAULT_MAX_INLAY_BODY_BYTES = 8 * 1024 * 1024

export interface ListParams {
    /**
     * Largest serialised inlay body (UTF-8 bytes of its JSON) that is listed. A
     * larger one is written as the overflow marker (`x: true`), never truncated.
     */
    maxInlayBodyBytes: number
}

export function resolveListParams(params?: Partial<ListParams>): ListParams {
    const maxInlayBodyBytes = params?.maxInlayBodyBytes ?? DEFAULT_MAX_INLAY_BODY_BYTES
    if (!Number.isFinite(maxInlayBodyBytes) || maxInlayBodyBytes < 0) {
        throw new RangeError('maxInlayBodyBytes must be a non-negative number.')
    }
    return { maxInlayBodyBytes }
}
