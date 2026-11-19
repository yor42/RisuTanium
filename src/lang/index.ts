import merge from "lodash/merge";
import { languageChinese } from "./cn";
import { languageGerman } from "./de";
import { languageEnglish } from "./en";
import { languageKorean } from "./ko";
import { languageVietnamese } from "./vi";
import { languageChineseTraditional } from "./zh-Hant";
import { languageSpanish } from "./es";
import { languageJapanese } from "./ja";
import { setAppLanguage } from "../ts/appIntl.svelte";

export let language:typeof languageEnglish = languageEnglish


export function changeLanguage(lang:string){
    if(lang === 'cn'){
        language = merge(safeStructuredClone(languageEnglish), languageChinese)
    }
    else if(lang === 'de'){
        language = merge(safeStructuredClone(languageEnglish), languageGerman)
    }
    else if(lang === 'ko'){
        language = merge(safeStructuredClone(languageEnglish), languageKorean)
    }
    else if(lang === 'vi'){
        language = merge(safeStructuredClone(languageEnglish), languageVietnamese)
    }
    else if(lang === 'zh-Hant'){
        language = merge(safeStructuredClone(languageEnglish), languageChineseTraditional)
    }
    else if(lang === 'es'){
        language = merge(safeStructuredClone(languageEnglish), languageSpanish)
    }
    else if(lang === 'ja'){
        language = merge(safeStructuredClone(languageEnglish), languageJapanese)
    }
    else{
        language = languageEnglish
    }
    const tag = setAppLanguage(lang)
    if(typeof document !== 'undefined'){
        document.documentElement.lang = tag
    }
}