/**
 * `applyParameters` reports a model without separate parameters in the active UI language, read
 * when the error is thrown, with the model id and mode inserted verbatim. The language module is
 * switched per test and restored to English afterwards.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    db: {
        seperateParametersEnabled: true,
        seperateParametersByModel: true,
        seperateParameters: { overrides: {} as Record<string, unknown> },
    },
}));

vi.mock("src/ts/storage/database.svelte", () => ({
    getDatabase: () => mocks.db,
}));

import { changeLanguage } from "src/lang";
import { languageEnglish } from "src/lang/en";
import { languageKorean } from "src/lang/ko";
import { fillLang } from "src/lang/fill";
import { applyParameters } from "../shared";

// `$&` and `{modelMode}` in the id must reach the message literally.
const modelId = "weird$&{modelMode}id";

function run() {
    return applyParameters({}, ["temperature"], {}, "model", { modelId });
}

afterEach(() => changeLanguage("en"));

describe("applyParameters: missing separate parameters error", () => {
    it("compatibility guard: English throws the exact English text with the id and mode", () => {
        expect(run).toThrow(new Error(
            `No seperate parameters found for model ${modelId} in model mode model. Please set parameters for this model`
        ));
    });

    it("regression reproducer: Korean throws the Korean text containing the model id and mode verbatim", () => {
        changeLanguage("ko");
        expect(languageKorean.errors.separateParamsMissing).not.toBe(languageEnglish.errors.separateParamsMissing);
        expect(run).toThrow(new Error(
            fillLang(languageKorean.errors.separateParamsMissing, { modelId, modelMode: "model" })
        ));
        let message = "";
        try { run(); } catch (e) { message = (e as Error).message; }
        expect(message).toContain(modelId);
        expect(message).toContain("model");
    });
});
