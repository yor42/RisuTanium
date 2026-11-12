import { describe, expect, test } from 'vitest'
import { drainMicrotasks } from '../../../ts/tests/firstFrame.test-helpers'
import { requestHomeLibrary, startHomeView } from './homeView.svelte'

describe('homeView pending library intent, before the first frame', () => {
    test('T13 a visit end clears the pending intent before the first frame, so a later creation starts at the landing', async () => {
        requestHomeLibrary()
        // Only microtasks run: a wait that needs an animation frame or a timer has not finished.
        await drainMicrotasks()
        expect(startHomeView()).toBe('landing')
    })

    test('CG a creation in the same turn as the request still resumes the library', () => {
        requestHomeLibrary()
        expect(startHomeView()).toBe('library')
    })
})
