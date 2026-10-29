<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  readonly value: number;
  readonly max: number;
  readonly label: string;
}>();
const percent = computed(() => (props.max > 0 ? Math.round((props.value / props.max) * 100) : 0));
</script>

<template>
  <div class="progress-bar-wrap">
    <div class="progress-bar-meta">
      <span>{{ label }}</span>
      <span>{{ value }} dari {{ max }} ({{ percent }}%)</span>
    </div>
    <div class="progress-bar-track" role="progressbar" :aria-valuemin="0" :aria-valuemax="max" :aria-valuenow="value" :aria-label="label">
      <div class="progress-bar-fill" :style="{ width: `${percent}%` }" />
    </div>
  </div>
</template>

<style scoped>
.progress-bar-wrap {
  display: grid;
  gap: 6px;
}
.progress-bar-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 0.875rem;
}
.progress-bar-track {
  height: 10px;
  overflow: hidden;
  border-radius: 99px;
  background: var(--canvas);
}
.progress-bar-fill {
  height: 100%;
  border-radius: 99px;
  background: var(--primary);
  transition: width 0.2s ease;
}
</style>
