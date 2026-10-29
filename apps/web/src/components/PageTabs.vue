<script setup lang="ts">
export interface PageTab {
  readonly id: string;
  readonly label: string;
}

const props = defineProps<{
  readonly tabs: readonly PageTab[];
  readonly modelValue: string;
  readonly label: string;
}>();
const emit = defineEmits<{ (event: "update:modelValue", id: string): void }>();

function select(id: string): void {
  if (id !== props.modelValue) emit("update:modelValue", id);
}
</script>

<template>
  <nav class="page-tabs" :aria-label="label">
    <button v-for="tab in tabs" :key="tab.id" type="button" :aria-pressed="tab.id === modelValue" :class="{ active: tab.id === modelValue }" @click="select(tab.id)">{{ tab.label }}</button>
  </nav>
</template>

<style scoped>
.page-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 16px 0 4px;
  border-bottom: 1px solid var(--border);
}
.page-tabs button {
  min-height: 40px;
  padding: 8px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--muted);
  background: transparent;
  font-weight: 700;
  cursor: pointer;
}
.page-tabs button.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
</style>
