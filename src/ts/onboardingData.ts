import { v4 } from 'uuid'
import type { CharacterOnboarding } from './storage/database.svelte'

/** Coerces onboarding data from an imported card into a well-formed shape, or undefined. A question without an id gets one from `newId`. */
export function normalizeOnboarding(raw: unknown, newId: () => string = v4): CharacterOnboarding | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined
    }
    const data = raw as Partial<CharacterOnboarding>
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const questions = Array.isArray(data.questions) ? data.questions : []
    return {
        enabled: data.enabled === true,
        mode: data.mode === 'html' ? 'html' : 'form',
        title: str(data.title),
        description: str(data.description),
        html: str(data.html),
        floatingButton: data.floatingButton === true,
        questions: questions.filter((q) => q && typeof q === 'object').map((q) => ({
            id: str(q.id) || newId(),
            title: str(q.title),
            description: str(q.description),
            type: q.type === 'multiple' || q.type === 'text' ? q.type : 'single',
            varName: str(q.varName),
            required: q.required === true,
            placeholder: str(q.placeholder),
            options: (Array.isArray(q.options) ? q.options : [])
                .filter((o) => o && typeof o === 'object')
                .map((o) => ({ label: str(o.label), value: str(o.value) })),
        })),
    }
}
