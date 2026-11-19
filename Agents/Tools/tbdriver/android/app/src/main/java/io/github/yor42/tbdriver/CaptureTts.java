package io.github.yor42.tbdriver;

import android.media.AudioFormat;
import android.speech.tts.SynthesisCallback;
import android.speech.tts.SynthesisRequest;
import android.speech.tts.TextToSpeech;
import android.speech.tts.TextToSpeechService;

/**
 * Test-only TTS engine: records every utterance the screen reader asks for and returns short silence.
 * Selected only by setting the default engine on a test phone.
 */
public class CaptureTts extends TextToSpeechService {
    private String[] lang = {"eng", "USA", ""};

    @Override
    public void onCreate() {
        super.onCreate();
        Hub.startServer();
        Hub.record("tts", "\"msg\":\"engine created\"");
    }

    @Override
    protected int onIsLanguageAvailable(String l, String c, String v) { return TextToSpeech.LANG_COUNTRY_AVAILABLE; }

    @Override
    protected String[] onGetLanguage() { return lang; }

    @Override
    protected int onLoadLanguage(String l, String c, String v) {
        lang = new String[]{l == null ? "" : l, c == null ? "" : c, v == null ? "" : v};
        return TextToSpeech.LANG_COUNTRY_AVAILABLE;
    }

    @Override
    protected void onStop() { }

    @Override
    protected void onSynthesizeText(SynthesisRequest req, SynthesisCallback cb) {
        CharSequence text = req.getCharSequenceText();
        Hub.record("speech", "\"text\":" + Hub.q(text) + ",\"lang\":" + Hub.q(req.getLanguage()) + ",\"rate\":" + req.getSpeechRate());
        int rate = 16000;
        if (cb.start(rate, AudioFormat.ENCODING_PCM_16BIT, 1) != TextToSpeech.SUCCESS) return;
        // About 40 ms of silence per character, capped at 2 s, so queued utterances keep a realistic order.
        int len = text == null ? 0 : text.length();
        int ms = Math.min(2000, Math.max(100, len * 40));
        byte[] silence = new byte[rate * 2 * ms / 1000];
        int max = cb.getMaxBufferSize();
        for (int off = 0; off < silence.length; off += max) {
            if (cb.audioAvailable(silence, off, Math.min(max, silence.length - off)) != TextToSpeech.SUCCESS) return;
        }
        cb.done();
    }
}
