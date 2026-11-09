<script lang="ts">
    interface Props {
        // The character the name belongs to. Not read yet: a marker for this character (a writing badge, an
        // unseen dot) is added inside this component, so the three list rows never change to carry it.
        chaId: string;
        name: string;
    }

    let { name }: Props = $props();
</script>
<!-- Inline, with no flex, truncation or min width, so a long name wraps exactly as the bare text did. Every listed name renders here. --><span data-part="character-name-row">{name}<!-- badge slot --></span>
