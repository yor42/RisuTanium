import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import type { ModelIdStatus } from './modelStatus'

/** Short label shown beside a model name; null for an ok id. */
export function modelStatusTag(status: ModelIdStatus): string | null {
    switch (status.kind) {
        case 'retired':
            return language.modelStatus.retiredTag
        case 'redirected':
            return fillLang(language.modelStatus.redirectedTag, { target: status.target })
        case 'deprecated':
            return fillLang(language.modelStatus.retiresTag, { date: status.date })
        case 'ok':
            return null
    }
}

/** Sentence explaining the status of the model currently selected; null for an ok id. */
export function modelStatusWarning(status: ModelIdStatus, modelName: string): string | null {
    switch (status.kind) {
        case 'retired':
            return fillLang(language.modelStatus.retiredWarning, { model: modelName })
        case 'redirected':
            return fillLang(language.modelStatus.redirectedWarning, { model: modelName, target: status.target })
        case 'deprecated':
            return fillLang(language.modelStatus.retiresWarning, { model: modelName, date: status.date })
        case 'ok':
            return null
    }
}
