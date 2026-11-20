<script lang="ts">
  import { DBState } from 'src/ts/stores.svelte'
  import Check from "src/lib/UI/GUI/CheckInput.svelte"
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import { language } from 'src/lang'
  import ModelList from 'src/lib/UI/ModelList.svelte'

  type SlotKey = 'memory' | 'emotion' | 'translate' | 'otherAx'

  // A profile may have no slot object. Reading never creates it; only a user's choice does.
  function slotOf(key: SlotKey): string {
    return DBState.db.seperateModels?.[key] ?? ''
  }

  function setSlot(key: SlotKey, value: string) {
    if (!DBState.db.seperateModels) {
      DBState.db.seperateModels = { memory: '', emotion: '', translate: '', otherAx: '' }
    }
    DBState.db.seperateModels[key] = value
  }
</script>

<div class="flex items-center mt-4">
  <Check bind:check={DBState.db.doNotChangeSeperateModels} name={language.doNotChangeSeperateModels}></Check>
</div>
<Accordion name={language.axModelsDef} styled>
  <span class="text-textcolor mt-4"> {language.settingsPage.memory} </span>
  <ModelList bind:value={() => slotOf('memory'), (v) => setSlot('memory', v)} blankable />

  <span class="text-textcolor mt-4"> {language.settingsPage.translations} </span>
  <ModelList bind:value={() => slotOf('translate'), (v) => setSlot('translate', v)} blankable />

  <span class="text-textcolor mt-4"> {language.settingsPage.emotion} </span>

  <ModelList bind:value={() => slotOf('emotion'), (v) => setSlot('emotion', v)} blankable />

  <span class="text-textcolor mt-4"> {language.settingsPage.otherAx} </span>

  <ModelList bind:value={() => slotOf('otherAx'), (v) => setSlot('otherAx', v)} blankable />
</Accordion>
