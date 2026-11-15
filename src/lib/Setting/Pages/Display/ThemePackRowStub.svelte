<script lang="ts">
    // Test stand-in for ThemePackRow: the first control is a radio (the None radio of the real row) and a button sits after it,
    // so tests of the shell pages and the loader need neither the install flow nor the theme pack runtime.
</script>

<fieldset>
    <input type="radio" name="theme-pack-stub" data-part="theme-pack-stub-none" aria-label="None" />
</fieldset>
<button type="button" data-part="theme-pack-install">Install</button>
