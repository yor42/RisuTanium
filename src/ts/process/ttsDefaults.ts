/**
 * The provider configs a character gets when it picks a TTS mode. Each call
 * returns a fresh object, so a default is never shared between characters.
 */

export function createNovelAIVoiceDefaults() {
    return {
        customvoice: false,
        voice: 'Aini',
        version: 'v2',
    }
}

export function createVoicevoxDefaults() {
    return {
        SPEED_SCALE: 1,
        PITCH_SCALE: 0,
        INTONATION_SCALE: 1,
        VOLUME_SCALE: 1,
    }
}

export function createFishSpeechDefaults() {
    return {
        model: {
            _id: '',
            title: '',
            description: '',
        },
        chunk_length: 200,
        normalize: false,
    }
}
