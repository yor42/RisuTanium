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
          // The remembered number is restored only for the subject it was taken from; anything else gets the range minimum.
          const kept = memory;
          memory = undefined;
          value = kept !== undefined && kept.token === memoryKey && kept.value >= min && kept.value <= max ? kept.value : min;
        } else {
          memory = memoryKey === undefined || isDisabledValue ? undefined : { value, token: memoryKey };
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

    let slider: HTMLDivElement = $state()
    let mouseDown = $state(false)
  type SubjectToken = string | number | object;

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
    /** Names the subject the value belongs to (compared by identity). Without it the toggle restores the range minimum. */
    memoryKey?: SubjectToken;
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
  // The number the toggle turned off, with the subject token it belonged to. Only the toggle-off action writes it, and the toggle-on action
  // restores it only when the caller's current token is identical, so every other path can only lose the memory (a fall back to the range
  // minimum), never restore another subject's number. Without a token nothing is remembered.
  let memory: { value: number, token: SubjectToken } | undefined = undefined;
  $effect(() => {
    if (!isDisabledValue) memory = undefined;
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
