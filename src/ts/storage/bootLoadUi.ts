import { alertConfirm, alertNormalWait, alertSelect } from '../alert'
import type { BootLoadUi } from './bootBlockLoad'

/** The prompts a boot may show before the app is up, over the alert slot. */
export const bootLoadUi: BootLoadUi = {
    notify: (text) => alertNormalWait(text),
    choose: async (title, options, cancel) => parseInt(await alertSelect([...options], title, { cancel: String(cancel) })),
    confirm: (text) => alertConfirm(text),
}
