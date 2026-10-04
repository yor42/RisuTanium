import { globalFetch } from "../globalApi.svelte"
import { resolveSecret } from "../secretRef"

/**
 * Lists the WaveSpeed models for `key`. A `${NAME}` reference is resolved here, so the literal is
 * never sent; a failed resolution throws `SecretRefError` before any request is made.
 *
 * Kept apart from stableDiff.ts so the settings page that lists models does not load the image
 * generation module and its store dependencies.
 */
export async function requestWavespeedModels(key: string) {
    return await globalFetch('https://api.wavespeed.ai/api/v3/models', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${await resolveSecret(key)}`
        },
    })
}
