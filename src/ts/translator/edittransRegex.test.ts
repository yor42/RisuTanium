import { beforeEach, describe, expect, it, vi } from "vitest";
import type { character, customscript } from "../storage/database.svelte";

const database: { presetRegex: customscript[] } = { presetRegex: [] };

vi.mock("../storage/database.svelte", () => ({
    getDatabase: () => database,
}));

vi.mock("../process/modules", () => ({
    getModuleRegexScripts: () => [] as customscript[],
    moduleUpdate: () => {},
}));

const parserCalls: { data: string, chatID: number }[] = [];

vi.mock("../parser/parser.svelte", () => ({
    applyMarkdownToNode: () => {},
    risuChatParser: (data: string, arg: { chatID?: number } = {}) => {
        parserCalls.push({ data, chatID: arg.chatID ?? -1 });
        return data.replaceAll("{{char}}", "Risu");
    },
}));

import { applyEdittransRegex } from "./translator";
import { tryRegexEntry } from "../studio/edit/regexCheck";

const script = (v: Partial<customscript>): customscript => ({
    comment: "",
    in: "",
    out: "",
    type: "edittrans",
    ...v,
} as customscript);

const alwaysExistChar = { customscript: [] } as unknown as character;

const apply = (text: string, scripts: customscript[], chatID = -1) => {
    database.presetRegex = scripts;
    return applyEdittransRegex(text, "chatid", alwaysExistChar, chatID);
};

beforeEach(() => {
    database.presetRegex = [];
    parserCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("applyEdittransRegex", () => {
    it("applies preset scripts of the edittrans type only", () => {
        expect(apply("hello world", [
            script({ in: "world", out: "there" }),
            script({ in: "hello", out: "bye", type: "editdisplay" }),
        ])).toBe("hello there");
    });

    it("skips a script with an invalid regex and keeps the remaining ones", () => {
        expect(apply("hello world", [
            script({ in: "(unclosed", out: "x" }),
            script({ in: "world", out: "there" }),
        ])).toBe("hello there");
    });

    it("skips a script with an empty in", () => {
        expect(apply("hello", [
            script({ in: "", out: "INJECTED" }),
        ])).toBe("hello");
    });

    it("drops unsupported and repeated flags instead of throwing", () => {
        expect(apply("Hello hello", [
            script({ in: "hello", out: "hi", ableFlag: true, flag: "ggi z" }),
        ])).toBe("hi hi");
    });

    it("falls back to the u flag when only unsupported flag characters are left", () => {
        expect(apply("aaa", [
            script({ in: "a", out: "b", ableFlag: true, flag: "z<cbs>" }),
        ])).toBe("baa");
    });

    it("regression reproducer: a flag text with only tags left is global, like an off flag box", () => {
        expect(apply("aaa", [
            script({ in: "a", out: "b", ableFlag: true, flag: "<cbs>" }),
        ])).toBe("bbb");
        expect(apply("aaa", [
            script({ in: "a", out: "b", ableFlag: false, flag: "i" }),
        ])).toBe("bbb");
    });

    it("parses curly braced syntaxes in IN with the cbs flag", () => {
        expect(apply("Risu said hi", [
            script({ in: "{{char}}", out: "Seia", ableFlag: true, flag: "g<cbs>" }),
        ])).toBe("Seia said hi");
    });

    it("does not parse curly braced syntaxes in IN without the cbs flag", () => {
        expect(apply("Risu said hi", [
            script({ in: "{{char}}", out: "Seia", ableFlag: true, flag: "g" }),
        ])).toBe("Risu said hi");
        expect(parserCalls).toEqual([]);
    });

    it("forwards the chatID to the parser so message scoped syntaxes resolve", () => {
        apply("Risu said hi", [
            script({ in: "{{char}}", out: "Seia", ableFlag: true, flag: "g<cbs>" }),
        ], 7);
        expect(parserCalls).toEqual([{ data: "{{char}}", chatID: 7 }]);
    });

    it("sorts scripts by the order flag, higher first", () => {
        expect(apply("a", [
            script({ in: "b", out: "c", ableFlag: true, flag: "g<order 1>" }),
            script({ in: "a", out: "b", ableFlag: true, flag: "g<order 2>" }),
        ])).toBe("c");
    });

    it("keeps the declaration order when no order flag is set", () => {
        expect(apply("a", [
            script({ in: "b", out: "c" }),
            script({ in: "a", out: "b" }),
        ])).toBe("b");
    });

    it("moves the match to the top with the move_top flag", () => {
        expect(apply("body\n<note>keep</note>", [
            script({ in: "<note>.*?</note>", out: "$&", ableFlag: true, flag: "g<move_top>" }),
        ])).toBe("<note>keep</note>\nbody\n");
    });

    it("moves the match to the bottom with the move_bottom flag", () => {
        expect(apply("<note>keep</note>\nbody", [
            script({ in: "<note>(.*?)</note>", out: "[$1]", ableFlag: true, flag: "g<move_bottom>" }),
        ])).toBe("\nbody\n[keep]");
    });

    it("leaves the text alone when a move script does not match", () => {
        expect(apply("body", [
            script({ in: "<note>.*?</note>", out: "$&", ableFlag: true, flag: "g<move_top>" }),
        ])).toBe("body");
    });

    describe("move flags with several matches", () => {
        const move = (text: string, flag: string, inRe = "a\\d", out = "$&") => apply(text, [
            script({ in: inRe, out, ableFlag: true, flag }),
        ]);

        it("regression reproducer: g<move_top> moves every match, the last match on top", () => {
            expect(move("a1 b a2 c a3", "g<move_top>")).toBe("a3\na2\na1\n b  c ");
        });

        it("regression reproducer: g<move_bottom> moves every match, in source order", () => {
            expect(move("a1 b a2 c a3", "g<move_bottom>")).toBe(" b  c \na1\na2\na3");
        });

        it("regression reproducer: a tag-only flag text is global for a move", () => {
            expect(move("a1 b a2", "<move_top>")).toBe("a2\na1\n b ");
            expect(move("a1 b a2", "<order 1, move_bottom>")).toBe(" b \na1\na2");
        });

        it("guard: a flag text without g moves only the first match", () => {
            expect(move("a1 b a2", "i<move_top>")).toBe("a1\n b a2");
            expect(move("a1 b a2", "i<move_bottom>")).toBe(" b a2\na1");
        });

        it("regression reproducer: $<name> resolves a participating group, empty when it did not participate or does not exist", () => {
            expect(move("a", "g<move_bottom>", "(?<n>a)|(?<m>b)", "[$<n>|$<m>|$<z>]")).toBe("\n[a||]");
            expect(move("b", "g<move_bottom>", "(?<n>a)|(?<m>b)", "[$<n>|$<m>]")).toBe("\n[|b]");
        });

        it("regression reproducer: $<name> of a participating empty group is empty", () => {
            expect(move("a", "g<move_bottom>", "(?<n>)a", "[$<n>]")).toBe("\n[]");
        });

        it("guard: $<name> stays literal when the regex has no named groups", () => {
            expect(move("a", "g<move_bottom>", "(a)", "[$<n>|$1]")).toBe("\n[$<n>|a]");
        });

        it("regression reproducer: a pattern matching at every position terminates and moves every match", () => {
            const text = "y".repeat(100000);
            const start = performance.now();
            const result = move(text, "g<move_bottom>", "x*", "$&");
            expect(performance.now() - start).toBeLessThan(2000);
            expect(result.length).toBe(text.length + 100001);
            const top = move(text, "g<move_top>", "x*", "$&");
            expect(top.length).toBe(text.length + 100001);
        });
    });

    it("ignores custom flags that are not supported here", () => {
        expect(apply("hello world", [
            script({ in: "world", out: "there", ableFlag: true, flag: "g<repeat_back><no_end_nl>" }),
        ])).toBe("hello there");
    });

    it("returns the text untouched for an empty charArg", () => {
        database.presetRegex = [script({ in: "hello", out: "bye" })];
        expect(applyEdittransRegex("hello", "", alwaysExistChar)).toBe("hello");
    });
});

describe("applyEdittransRegex flag pipeline", () => {
    const on = (text: string, v: Partial<customscript>) => apply(text, [
        script({ in: "a", out: "b", ableFlag: true, ...v }),
    ]);

    it("guard: an empty or absent flag text with the flag box on is global", () => {
        expect(on("aaa", { flag: "" })).toBe("bbb");
        expect(on("aaa", {})).toBe("bbb");
    });

    it("guard: a sticky flag replaces only at the start of the text", () => {
        expect(on("baa", { flag: "y" })).toBe("baa");
        expect(on("aa", { flag: "<,>y" })).toBe("ba");
    });

    it("guard: repeated flag characters are de-duplicated", () => {
        expect(on("aaa", { flag: "gg" })).toBe("bbb");
    });

    it("guard: the v flag is passed to the engine", () => {
        expect(on("aÄb", { in: "[\\p{L}--[a-z]]", out: "X", flag: "v" })).toBe("aXb");
    });

    it("guard: the cbs action parses the find text", () => {
        expect(on("Risu Risu", { in: "{{char}}", out: "X", flag: "<cbs>" })).toBe("X X");
        expect(on("Risu Risu", { in: "{{char}}", out: "X", flag: "<order 2, cbs>" })).toBe("X X");
    });

    it("guard: an order action sorts higher first, no order keeps the declaration order", () => {
        const a = script({ in: "a", out: "b" });
        const b = script({ in: "b", out: "c", ableFlag: true, flag: "<order 2>" });
        expect(apply("abab", [a, b])).toBe("bcbc");
        expect(apply("abab", [a, { ...b, flag: "" }])).toBe("cccc");
        expect(apply("abab", [a, { ...b, flag: "u<order 2>" }])).toBe("bcbb");
    });

    it("guard: a move action with the u flag moves the first match to the bottom", () => {
        expect(on("abab", { out: "X$&", flag: "<move_bottom>u" })).toBe("bab\nXa");
    });

    it("guard: the flag text is kept while the flag box is on, ignored while off", () => {
        expect(on("aA", { flag: "gi<cbs>" })).toBe("bb");
        expect(on("aA", { ableFlag: false, flag: "i" })).toBe("bA");
    });

    it("guard: a flag text with no regex flag left falls back to u", () => {
        expect(on("aaa", { flag: "z<cbs>" })).toBe("baa");
    });

    it("regression reproducer: an entry with a non text flag is skipped and the others still apply", () => {
        expect(apply("aaa", [
            script({ in: "a", out: "b" }),
            script({ in: "a", out: "Z", ableFlag: true, flag: 5 as unknown as string }),
        ])).toBe("bbb");
    });

    it("guard: a mixed list of entries of every type", () => {
        const list: customscript[] = [
            script({ in: "a", out: "b", type: "editinput", ableFlag: true, flag: "g<order 1>" }),
            script({ in: "b", out: "c", ableFlag: true, flag: "<order 2>" }),
            script({ in: "x", out: "y", type: "editoutput" }),
            script({ in: "d", out: "[$&]", ableFlag: true, flag: "g<move_top>" }),
            script({ in: "a", out: "Z", type: "disabled" }),
            script({ in: "(", out: "W" }),
            script({ in: "a", out: "A", ableFlag: true, flag: "g<order 5>" }),
            script({ in: "p", out: "q", ableFlag: true, flag: "i" }),
        ];
        expect(apply("abdxpPab", list)).toBe("[d]\nAcxqPAc");
    });
});

describe("Studio Try it follows the translation step", () => {
    const tryIt = (v: Partial<customscript>, sample: string) => {
        const r = tryRegexEntry(script(v) as never, sample);
        if (r.outcome !== "ran") throw new Error("expected outcome ran, got " + r.outcome);
        return r;
    };

    it("rewrites $n only: no line feed after a closing >, {{data}} stays literal", () => {
        const v = { in: "a", out: "<b>{{data}}</b>" };
        const r = tryIt(v, "xay");
        expect(r.engine).toBe("translation");
        expect(r.directive).toBe(false);
        expect(r.text).toBe(apply("xay", [script(v)]));
        expect(r.text).toBe("x<b>{{data}}</b>y");
    });

    it("reads $n as a line feed", () => {
        const v = { in: "a", out: "b$nc" };
        expect(tryIt(v, "a").text).toBe(apply("a", [script(v)]));
    });

    it("treats the inject action and an @@emo out as plain replacements", () => {
        const inject = { in: "a", out: "Z", ableFlag: true, flag: "<inject>" };
        expect(tryIt(inject, "aa").text).toBe(apply("aa", [script(inject)]));
        const emo = { in: "a", out: "@@emo x" };
        expect(tryIt(emo, "aa").text).toBe(apply("aa", [script(emo)]));
        expect(tryIt(emo, "aa").directive).toBe(false);
    });

    it("does not test first: a sticky pattern replaces at the start", () => {
        const v = { in: "a", out: "b", ableFlag: true, flag: "<,>y" };
        expect(tryIt(v, "aa").text).toBe(apply("aa", [script(v)]));
        expect(tryIt(v, "aa").text).toBe("ba");
    });

    it("shows a move action as a directive without text", () => {
        const r = tryIt({ in: "a", out: "X", ableFlag: true, flag: "<move_top>u" }, "xay");
        expect(r.directive).toBe(true);
        expect(r.text).toBeNull();
        expect(r.count).toBe(1);
    });

    it("does not run a cbs entry", () => {
        expect(tryRegexEntry(script({ in: "{{char}}", ableFlag: true, flag: "<cbs>" }) as never, "Risu").outcome).toBe("cbsFind");
    });
});