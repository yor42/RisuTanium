/**
 * The reactive state of the Welcome step card. The rules (which steps show, what the answers resolve to, what a key
 * advisory says) live in `firstRunChoices`; this holds the answers, the step index and the finish lifecycle.
 */
import { changeLanguage, language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { restoreFromBinFileAtFirstRun } from 'src/ts/drive/settingsRestore'
import {
    detectLanguage,
    finishFirstRun,
    keyAdvisory,
    languageToWrite,
    nicknameReady,
    providerTakesKey,
    resolveChoices,
    stepsFor,
    useStepReady,
    type ChatLanguageChoice,
    type DetectedLanguage,
    type FirstRunChoices,
    type FirstRunLanguage,
    type FirstRunProvider,
    type FirstRunState,
    type FirstRunStep,
    type KeyAdvisory,
    type LanguageWriteMoment,
    type MemoryChoice,
    type UseChoice,
} from 'src/ts/firstRun/firstRunChoices'
import type { BrandStatus } from '../../Nexus/brand/brandStatus'

/** Each language in its own name, so a person can find theirs whatever the app currently shows. */
export const LANGUAGE_NAMES: Record<FirstRunLanguage, string> = {
    de: 'Deutsch',
    en: 'English',
    ko: '한국어',
    cn: '中文',
    'zh-Hant': '中文(繁體)',
    vi: 'Tiếng Việt',
    es: 'Español',
    ja: '日本語',
}

/** How long the finishing display stays before the choices are written. */
export const FINISH_DISPLAY_MS = 1000
/** When the finishing mark turns into the done mark, inside the finishing display. */
const DONE_MARK_MS = 700

export class WelcomeFlow {
    index = $state(0)
    /** The finishing display is up: every control is disabled and the choices are written when it ends. */
    finishing = $state(false)
    finished = $state(false)

    readonly detected: DetectedLanguage
    /** The language the person picked; null until they pick one. */
    picked: FirstRunLanguage | null = $state(null)
    appLanguage: FirstRunLanguage = $state('en')

    use: UseChoice | null = $state(null)
    name = $state('')
    description = $state('')
    keepPicture = $state(false)
    wantsNickname: boolean | null = $state(null)
    provider: FirstRunProvider | null = $state(null)
    apiKey = $state('')
    showKey = $state(false)
    setUpNow: boolean | null = $state(null)
    memory: MemoryChoice = $state('balanced')
    /** Not preselected: Continue stays disabled on the chat language step until it is chosen. */
    chatLanguage: ChatLanguageChoice | null = $state(null)

    private doneTimer: ReturnType<typeof setTimeout> | undefined
    private finishTimer: ReturnType<typeof setTimeout> | undefined

    constructor(browserLanguage: string) {
        this.detected = detectLanguage(browserLanguage)
        this.appLanguage = this.detected.shown
        this.writeLanguage('mount')
    }

    /**
     * The language table, re-read when the app language changes. `language` is a plain module binding and not reactive, so
     * the parts of the card that stay mounted while the person picks a language read their text through this.
     */
    strings: typeof language = $derived.by(() => {
        void this.appLanguage
        return language
    })

    stepList = $derived(stepsFor({ appLanguage: this.appLanguage, use: this.use, provider: this.provider, setUpNow: this.setUpNow }))
    steps = $derived(this.stepList.steps)
    total = $derived(this.steps.length)
    current: FirstRunStep = $derived(this.steps[Math.min(this.index, this.steps.length - 1)])

    advisory: KeyAdvisory | null = $derived(
        this.provider !== null && providerTakesKey(this.provider) ? keyAdvisory(this.provider, this.apiKey) : null,
    )

    canContinue = $derived.by(() => {
        switch (this.current) {
            case 'welcome':
                return false
            case 'use':
                return useStepReady(this.use)
            case 'persona':
                return true
            case 'nickname':
                return nicknameReady(this.wantsNickname, this.name)
            case 'provider':
                if (this.provider === null || this.stepList.needsAnswer !== null) {
                    return false
                }
                return this.advisory === null || this.advisory.ready
            case 'chatLanguage':
                return this.chatLanguage !== null
            case 'memory':
                return true
            case 'review':
                return true
        }
    })

    /** The mark follows the finish; on the provider step a key with the standard prefix is a quiet done mark. */
    markStatus: BrandStatus = $derived.by(() => {
        if (this.finishing) {
            return this.finished ? 'done' : 'finishing'
        }
        if (this.current === 'provider' && this.advisory !== null && this.advisory.ready && this.advisory.standardPrefix) {
            return 'done'
        }
        return 'idle'
    })

    /** The name the Review and Finish headings greet, or an empty string when none will be set. */
    greetingName = $derived.by(() => {
        if (this.use === 'tools' && this.wantsNickname !== true) {
            return ''
        }
        return this.name.trim()
    })

    private snapshot(skipped: boolean): FirstRunState {
        return {
            skipped,
            appLanguage: this.appLanguage,
            use: this.use,
            name: this.name,
            description: this.description,
            keepPicture: this.keepPicture,
            wantsNickname: this.wantsNickname,
            provider: this.provider,
            apiKey: this.apiKey,
            setUpNow: this.setUpNow,
            memory: this.memory,
            chatLanguage: this.chatLanguage ?? 'unchanged',
        }
    }

    private writeLanguage(moment: LanguageWriteMoment): void {
        const code = languageToWrite(moment, this.detected, this.picked)
        if (code !== null) {
            changeLanguage(code)
            DBState.db.language = code
        }
    }

    pickLanguage(code: FirstRunLanguage): void {
        if (this.finishing) {
            return
        }
        changeLanguage(code)
        DBState.db.language = code
        this.picked = code
        this.appLanguage = code
    }

    startSetup(): void {
        if (this.finishing) {
            return
        }
        this.writeLanguage('start')
        this.index = 1
    }

    /** The restore keeps its own language and flag; no flow state is held across it, because the promise may never settle. */
    restore(): void {
        if (this.finishing) {
            return
        }
        this.writeLanguage('restore')
        void restoreFromBinFileAtFirstRun()
    }

    skipSetup(): void {
        if (this.finishing) {
            return
        }
        this.writeLanguage('skip')
        const choices = resolveChoices(this.snapshot(true))
        if (choices !== null) {
            this.beginFinish(choices)
        }
    }

    chooseUse(use: UseChoice): void {
        if (this.finishing) {
            return
        }
        this.use = use
        if (use === 'tools') {
            // Tools carries only a nickname: the persona description and picture do not travel with it.
            this.description = ''
            this.keepPicture = false
            DBState.db.userIcon = ''
        }
    }

    chooseProvider(provider: FirstRunProvider): void {
        if (this.finishing || provider === this.provider) {
            return
        }
        this.provider = provider
        // A key belongs to the provider it was typed for.
        this.apiKey = ''
        this.showKey = false
        this.setUpNow = null
    }

    pictureChosen(): void {
        this.keepPicture = DBState.db.userIcon !== ''
    }

    removePicture(): void {
        DBState.db.userIcon = ''
        this.keepPicture = false
    }

    skipPersona(): void {
        if (this.finishing) {
            return
        }
        this.name = ''
        this.description = ''
        this.removePicture()
        this.next()
    }

    next(): void {
        if (this.finishing || !this.canContinue) {
            return
        }
        if (this.current === 'review') {
            this.finish()
            return
        }
        this.index = Math.min(this.index + 1, this.total - 1)
    }

    goBack(): void {
        if (this.finishing || this.index === 0) {
            return
        }
        this.index -= 1
    }

    goToStep(step: FirstRunStep): void {
        const at = this.steps.indexOf(step)
        if (!this.finishing && at !== -1) {
            this.index = at
        }
    }

    finish(): void {
        if (this.finishing) {
            return
        }
        const choices = resolveChoices(this.snapshot(false))
        if (choices !== null) {
            this.beginFinish(choices)
        }
    }

    private beginFinish(choices: FirstRunChoices): void {
        this.finishing = true
        // The typed key is in `choices` now; the component state must not keep a second copy.
        this.apiKey = ''
        this.showKey = false
        this.doneTimer = setTimeout(() => {
            this.finished = true
        }, DONE_MARK_MS)
        this.finishTimer = setTimeout(() => {
            finishFirstRun(choices)
        }, FINISH_DISPLAY_MS)
    }

    /** Cancels the finishing timers when the card goes away. */
    dispose(): void {
        clearTimeout(this.doneTimer)
        clearTimeout(this.finishTimer)
    }
}
