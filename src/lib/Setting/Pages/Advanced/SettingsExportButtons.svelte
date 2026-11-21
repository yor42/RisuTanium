<script lang="ts">
    import { language } from "src/lang";
    import { copyPlainText } from "src/ts/chatCopy";
    import { downloadNotice } from "src/ts/exportNotice";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import { DBState } from 'src/ts/stores.svelte';
    import { alertMd, alertNormal } from "src/ts/alert";
    import { downloadFile, getRequestLog } from "src/ts/globalApi.svelte";
    import { getDatabase } from "src/ts/storage/database.svelte";
    import { isNodeServer, isTauri } from "src/ts/platform";
    import { isUsageKey, withoutUsageKeys } from "src/ts/usage/usageLedger";
    import { stripShareSecrets } from "src/ts/shareStrip";

</script>

<Button
    className="mt-4"
    onclick={async () => {
        alertMd(getRequestLog())
    }}
>
    {language.ShowLog}
</Button>

<Button
    className="mt-4"
    onclick={async () => {
        let mdTable = `| ${language.type} | ${language.value} |\n| --- | --- |\n`
        const s = DBState.db.statics
        for (const key in s) {
            if (isUsageKey(key)) {
                continue
            }
            mdTable += `| ${key} | ${s[key]} |\n`
        }
        mdTable += `\n\n<small>${language.staticsDisclaimer}</small>`
        alertMd(mdTable)
    }}
>
{language.settingsPage.showStatistics}
</Button>

<Button
    className="mt-4"
    onclick={async () => {
        const db = safeStructuredClone(getDatabase({
            snapshot: true
        }))

        const keyToRemove = [
            'characters', 'loreBook', 'plugins', 'account', 'personas', 'username', 'userIcon', 'userNote',
            'modules', 'enabledModules', 'botPresets', 'characterOrder', 'webUiUrl', 'characterOrder',
            'hordeConfig', 'novelai', 'koboldURL', 'ooba', 'ainconfig', 'personaPrompt', 'promptTemplate',
            'deeplOptions', 'google', 'customPromptTemplateToggle', 'globalChatVariables', 'comfyConfig',
            'comfyUiUrl', 'translatorPrompt', 'translatorPresets', 'translatorPresetId', 'customModels', 'mcpURLs', 'authRefreshes',
            'upstreamKvBlocks', 'usagePriceOverrides', 'connections'
        ]
        for(const key in db) {
            if(
                keyToRemove.includes(key) ||
                key.toLowerCase().includes('key') || key.toLowerCase().includes('proxy')
                || key.toLowerCase().includes('hypa')
            ) {
                delete db[key]
            }
        }

        stripShareSecrets(db, 'database')

        if (db.statics) {
            db.statics = withoutUsageKeys(db.statics)
        }

        //@ts-expect-error meta is not defined in Database type, added for settings export report
        db.meta = {
            isTauri: isTauri,
            isNodeServer: isNodeServer,
            protocol: location.protocol
        }

        const json = JSON.stringify(db, null, 2)
        const saved = await downloadFile('risutanium-settings-report.json', new TextEncoder().encode(json))
        if(!saved){
            return
        }
        copyPlainText(json, (outcome) => {
            alertNormal(outcome.ok
                ? downloadNotice(language.settingsExported, language.settingsReportDownloadStarted)
                : downloadNotice(language.successExport))
        })


    }}
>
{language.settingsPage.exportSettingsBugReport}
</Button>
