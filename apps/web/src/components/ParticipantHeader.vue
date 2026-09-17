<script setup lang="ts">
import ThemeToggle from "./ThemeToggle.vue";

defineProps<{
  readonly title?: string | undefined;
  readonly compact?: boolean;
}>();
</script>

<template>
  <header class="participant-header">
    <a class="brand" href="/participant/schedules" aria-label="GezyCBT, beranda peserta">GezyCBT</a>
    <span v-if="title" class="title">{{ title }}</span>
    <div class="header-actions">
      <ThemeToggle />
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.participant-header { min-height: 56px; display: flex; align-items: center; gap: 16px; padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
.brand { color: var(--text); font-size: 1.125rem; font-weight: 700; text-decoration: none; }
.title { overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
</style>
