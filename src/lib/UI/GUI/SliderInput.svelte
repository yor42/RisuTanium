<!-- <input
    class="text-textcolor bg-transparent input-text"
    class:mb-4={marginBottom}
    type="range"
    min={min}
    max={max}
    step={step}
    bind:value
    onchange
> -->

<div class="w-full flex" class:mb-4={marginBottom}>
  {#if ids.srOnly}
    <span id={ids.nameId} class="sr-only">{label}</span>
  {/if}
  {#if disableable}

    <div class="relative h-8 border-darkborderc border rounded-full cursor-pointer rounded-r-none border-r-0 flex justify-center items-center pl-2">
      <CheckInput check={value !== -1000 && value !== undefined} margin={false} {label} onChange={(c) => {
        onchange?.()
        if(c) {
          value = lastOn !== undefined && lastOn >= min && lastOn <= max ? lastOn : min;
        } else {
          userOff = true;
          value = -1000;
        }
      }}></CheckInput>
    </div>
  {/if}
  <div 
    role="slider"
    tabindex={dormant ? -1 : 0}
    aria-labelledby={ids.nameId}
    aria-describedby={ids.describedIds}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={sliderValue}
    aria-valuetext={displayText}
    class="relative w-full h-8 border-darkborderc border rounded-full cursor-pointer"
    class:rounded-l-none={disableable}
    class:opacity-60={dormant}
    class:cursor-default={dormant}
    aria-disabled={dormant ? 'true' : undefined}
    style:background={
      `linear-gradient(to right, var(--risu-theme-darkbutton) 0%, var(--risu-theme-darkbutton) ${sliderPercent}%, var(--risu-theme-darkbg) ${sliderPercent}%, var(--risu-theme-darkbg) 100%)`
    }
    onpointerdown={(event) => {
      if (dormant) return;
      mouseDown = true;
      changeValue(event);
    }}

    onpointermove={(event) => {
      if (mouseDown && !dormant) {
        changeValue(event);
      }
    }}


    onpointerup={() => {
      mouseDown = false;
    }}

    onpointerleave={() => {
      mouseDown = false;
    }}
    onkeydown={handleKeydown}
    bind:this={slider}
  >
    <!-- <div 
      class="absolute top-0 left-0 h-8 rounded-full bg-borderc transition-width duration-200"
      style="width: {(value - min) / (max - min) * 100}%;"
    >
    </div> -->
    <span 
      class="absolute top-0 left-4 h-8 rounded-full items-center justify-center flex text-textcolor text-sm"
    >
      {displayText}
    </span>
  </div>
</div>


<script lang="ts">
  import { language } from "src/lang";
  import CheckInput from "./CheckInput.svelte";
  import { fieldNameIds } from "./fieldNameIds";
  import { DBState } from "src/ts/stores.svelte";

    let slider: HTMLDivElement = $state()
    let mouseDown = $state(false)
  interface Props {
    min?: number;
    max?: number;
    value: number;
    marginBottom?: boolean;
    step?: number;
    fixed?: number;
    multiple?: number;
    disableable?: boolean;
    customText?: string|undefined;
    onchange?: Function;
    /** Id of an existing visible label element that names the slider. */
    labelId?: string;
    /** Field label text: the checkbox name of a disableable slider, and the slider's own screen-reader-only name when no labelId is given. */
    label?: string;
    /** Extra description ids, listed after the naming element. */
    describedBy?: string;
    /** Names what the value belongs to when one instance can show another subject's value (a different parameter group or model). */
    memoryKey?: string | number;
  }

  let {
    min = undefined,
    max = undefined,
    value = $bindable(),
    marginBottom = false,
    step = 1,
    fixed = 0,
    multiple = 1,
    disableable = false,
    customText = undefined,
    onchange,
    labelId = undefined,
    label = '',
    describedBy = undefined,
    memoryKey = undefined
  }: Props = $props();

  const uid = $props.id();

  // TalkBack speaks only the description in the slider's own stop, so the naming element is also the first description.
  let ids = $derived(fieldNameIds(uid, labelId, label, describedBy));

  let isDisabledValue = $derived(value === -1000 || value === undefined);
  let sliderValue = $derived(isDisabledValue ? min : value);
  let sliderPercent = $derived((sliderValue - min) / (max - min) * 100);
  // An off disableable slider is inert: the checkbox is the only way back on.
  let dormant = $derived(disableable && isDisabledValue);
  let userOff = false;
  let lastOn: number | undefined = undefined;
  // The value to restore is the last one seen while on. A switch of the active preset (or of the caller's `memoryKey`) drops it, and so
  // does an off value that did not come from this toggle (undo, redo), so a reused instance never restores another preset's number.
  // An off-to-off switch changes neither the value nor the on/off state, so only the key can reveal it.
  let subjectKey = $derived(`${DBState.db?.botPresetsId ?? ''}|${memoryKey ?? ''}`);
  $effect(() => {
    subjectKey;
    lastOn = undefined;
    userOff = false;
  });
  $effect(() => {
    if (!isDisabledValue) {
      lastOn = value;
      userOff = false;
    } else if (userOff) {
      userOff = false;
    } else {
      lastOn = undefined;
    }
  });
  let displayText = $derived(customText === undefined ? (isDisabledValue ? (disableable ? language.optOff : language.disabled) : (value * multiple).toFixed(fixed)) : customText);

    function changeValue(event: PointerEvent) {
        const rect = slider.getBoundingClientRect();
        const x = event.clientX - rect.left;
        console.log(x, rect.width);
        let newValue = ((x / rect.width) * (max - min)) + min;
        newValue = Math.round(newValue / step) * step;
        value = Math.min(Math.max(newValue, min), max);
    }

    function handleKeydown(event: KeyboardEvent) {
        if (dormant) return;
        let newValue = isDisabledValue ? min : value;

        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                newValue -= step;
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                newValue += step;
                break;
            case 'Home':
                newValue = min;
                break;
            case 'End':
                newValue = max;
                break;
            default:
                return;
        }

        event.preventDefault();
        value = Math.min(Math.max(newValue, min), max);
    }
</script>
