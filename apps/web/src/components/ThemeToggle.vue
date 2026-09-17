<script setup lang="ts">
import { onMounted, ref } from "vue";
import { applyTheme, readThemePreference, type ThemePreference } from "../lib/theme";

const preference = ref<ThemePreference>("system");
onMounted(() => {
  preference.value = readThemePreference();
});

function update(value: ThemePreference): void {
  preference.value = value;
  applyTheme(value);
}
</script>

<template>
  <label class="theme-toggle">
    <span class="sr-only">Tema tampilan</span>
    <select :value="preference" aria-label="Tema tampilan" @change="update(($event.target as HTMLSelectElement).value as ThemePreference)">
      <option value="system">Ikuti sistem</option>
      <option value="light">Terang</option>
      <option value="dark">Gelap</option>
    </select>
  </label>
</template>

<style scoped>
.theme-toggle select { min-height: 40px; padding: 4px 8px; border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text); background: var(--surface); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
