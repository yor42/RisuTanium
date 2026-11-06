# Settings: Persona

This page belongs to [[Settings]]. To open it, go to **Settings → Persona**.

A persona is the identity that you use in chat. It has a name, a portrait, and a description.

## Persona list

The list shows the avatar of each persona in a grid. Click an avatar to switch to that persona. Drag an avatar to change the order.

When you drag, the app saves the new order. The app then finds the selected persona again by its stable id. If a persona has no id, the app gives it one the first time you drag it.
<!-- src/lib/Setting/Pages/PersonaSettings.svelte:21-56,72-85 -->

Click **+** to open a menu. In the menu, you can create a new persona or import one.
<!-- src/lib/Setting/Pages/PersonaSettings.svelte:87-102 -->

## Selected persona

These controls change the persona that you selected in the list.

| Control | Default | What it does |
|---|---|---|
| Portrait (click to change) | empty | Opens the image picker for the icon of this persona. |
| Name | "User" | Holds free text. Chat shows this text as your name. |
| Note | empty | Holds free text. When **Persona Note** is on, this field appears. To turn it on, go to **Settings → Advanced Settings → Persona Note**. |
| Description | empty | Holds a free-text description of the persona. |
| Large Portrait | off | A checkbox. When you turn it on, the app shows the portrait of this persona at a larger size wherever it shows persona portraits. |

<!-- src/lib/Setting/Pages/PersonaSettings.svelte:120-158; Note gate: src/lib/Setting/Pages/PersonaSettings.svelte:136, src/ts/storage/database.svelte.ts (personaNote field) -->

## Export, import, and remove

| Control | What it does |
|---|---|
| Export | Downloads the selected persona as a file. |
| Import | Reads a persona from a file that you exported with **Export**. The app adds it as a new persona. |
| Remove | Shows a prompt first. After you accept, it deletes the selected persona and switches to the first persona that remains. |

You cannot remove your last persona. **Remove** is disabled while only one persona exists.

<!-- src/lib/Setting/Pages/PersonaSettings.svelte:142-157 -->
