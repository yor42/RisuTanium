import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

// Guard (post-fix only): the Android reply channel's sound is the page's own chime, so the two
// files must stay byte-identical; a copy that drifted would make the in-page and the notification
// sound differ.
test('the Android reply chime is byte-identical to the in-page send chime', () => {
    const pageChime = readFileSync(path.join(process.cwd(), 'src/etc/send.mp3'))
    const androidChime = readFileSync(
        path.join(process.cwd(), 'src-tauri/gen/android/app/src/main/res/raw/reply_chime.mp3'),
    )
    expect(pageChime.length).toBeGreaterThan(0)
    expect(androidChime.equals(pageChime)).toBe(true)
})
