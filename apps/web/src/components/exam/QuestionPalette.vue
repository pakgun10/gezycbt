<script setup lang="ts">
import type { RuntimeQuestionManifest } from "../../features/participant/types";

defineProps<{
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly current: number;
  readonly answered: ReadonlySet<string>;
  readonly marked: ReadonlySet<string>;
}>();
const emit = defineEmits<{ (event: "select", index: number): void }>();
</script>

<template>
  <nav class="palette" aria-label="Daftar soal">
    <div class="palette-grid">
      <button v-for="(item, index) in manifest" :key="item.sessionQuestionId" type="button" :class="{ current: index === current, answered: answered.has(item.sessionQuestionId), marked: marked.has(item.sessionQuestionId) }" :aria-current="index === current ? 'step' : undefined" :aria-label="`Soal ${index + 1}${answered.has(item.sessionQuestionId) ? ', sudah dijawab' : ', belum dijawab'}${marked.has(item.sessionQuestionId) ? ', ditandai' : ''}`" @click="emit('select', index)">{{ index + 1 }}</button>
    </div>
    <div class="legend"><span><i class="answered-dot" />Sudah dijawab</span><span><i class="marked-dot" />Ditandai</span></div>
  </nav>
</template>

<style scoped>
.palette { padding: 16px; }.palette-grid { display: grid; grid-template-columns: repeat(5, minmax(40px, 1fr)); gap: 8px; max-height: 360px; overflow: auto; }.palette-grid button { position: relative; min-width: 40px; min-height: 40px; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); }.palette-grid button.answered { color: white; background: #2563eb; border-color: #1d4ed8; }.palette-grid button.current { outline: 3px solid var(--primary); outline-offset: 2px; }.palette-grid button.marked::after { position: absolute; top: 3px; right: 4px; width: 6px; height: 6px; content: ""; border-radius: 50%; background: #b45309; }.legend { display: grid; gap: 6px; margin-top: 16px; color: var(--muted); font-size: .8rem; }.legend span { display: inline-flex; align-items: center; gap: 6px; }.legend i { width: 9px; height: 9px; display: inline-block; border-radius: 50%; }.answered-dot { background: #2563eb; }.marked-dot { background: #b45309; }
</style>
