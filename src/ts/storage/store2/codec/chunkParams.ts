/** Writer thresholds for anchored message chunks, in canonical JSON bytes. */
export const MESSAGE_CHUNKING = Object.freeze({ min: 2_048, target: 32_768, max: 131_072 })
