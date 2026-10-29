<script setup lang="ts">
import { computed, ref } from "vue";
import type { RuntimeQuestionManifest } from "../../features/participant/types";

const props = defineProps<{
  readonly manifest: readonly RuntimeQuestionManifest[];
  readonly current: number;
  readonly answered: ReadonlySet<string>;
  readonly marked: ReadonlySet<string>;
}>();
const emit = defineEmits<{ (event: "select", index: number): void }>();
type PaletteFilter = "all" | "unanswered" | "marked";
const filter = ref<PaletteFilter>("all");
const counts = computed(() => ({
  all: props.manifest.length,
  unanswered: props.manifest.filter((item) => !props.answered.has(item.sessionQuestionId)).length,
  marked: props.manifest.filter((item) => props.marked.has(item.sessionQuestionId)).length,
}));
const visible = computed(() =>
  props.manifest
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      filter.value === "all"
        ? true
        : filter.value === "unanswered"
          ? !props.answered.has(item.sessionQuestionId)
          : props.marked.has(item.sessionQuestionId),
    ),
);
</script>

<template>
  <nav class="palette" aria-label="Daftar soal">
    <div class="palette-filter" role="group" aria-label="Saring daftar soal">
      <button type="button" :class="{ active: filter === 'all' }" :aria-pressed="filter === 'all'" @click="filter = 'all'">Semua ({{ counts.all }})</button>
      <button type="button" :class="{ active: filter === 'unanswered' }" :aria-pressed="filter === 'unanswered'" @click="filter = 'unanswered'">Belum dijawab ({{ counts.unanswered }})</button>
      <button type="button" :class="{ active: filter === 'marked' }" :aria-pressed="filter === 'marked'" @click="filter = 'marked'">Ditandai ({{ counts.marked }})</button>
    </div>
    <p v-if="visible.length === 0" class="muted palette-empty">Tidak ada soal pada saringan ini.</p>
    <div v-else class="palette-grid">
      <button v-for="({ item, index }) in visible" :key="item.sessionQuestionId" type="button" :class="{ current: index === current, answered: answered.has(item.sessionQuestionId), marked: marked.has(item.sessionQuestionId) }" :aria-current="index === current ? 'step' : undefined" :aria-label="`Soal ${index + 1}${answered.has(item.sessionQuestionId) ? ', sudah dijawab' : ', belum dijawab'}${marked.has(item.sessionQuestionId) ? ', ditandai' : ''}`" @click="emit('select', index)">{{ index + 1 }}</button>
    </div>
    <div class="legend"><span><i class="answered-dot" />Sudah dijawab</span><span><i class="marked-dot" />Ditandai</span></div>
  </nav>
</template>

<style scoped>
.palette { padding: 16px; }.palette-filter { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }.palette-filter button { min-height: 36px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 99px; color: var(--muted); background: var(--surface); font-size: .85rem; font-weight: 700; }.palette-filter button.active { color: var(--primary); border-color: var(--primary); }.palette-empty { margin: 12px 0; }.palette-grid { display: grid; grid-template-columns: repeat(5, minmax(40px, 1fr)); gap: 8px; max-height: 360px; overflow: auto; }.palette-grid button { position: relative; min-width: 40px; min-height: 40px; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); }.palette-grid button.answered { color: white; background: #2563eb; border-color: #1d4ed8; }.palette-grid button.current { outline: 3px solid var(--primary); outline-offset: 2px; }.palette-grid button.marked::after { position: absolute; top: 3px; right: 4px; width: 6px; height: 6px; content: ""; border-radius: 50%; background: #b45309; }.legend { display: grid; gap: 6px; margin-top: 16px; color: var(--muted); font-size: .8rem; }.legend span { display: inline-flex; align-items: center; gap: 6px; }.legend i { width: 9px; height: 9px; display: inline-block; border-radius: 50%; }.answered-dot { background: #2563eb; }.marked-dot { background: #b45309; }
</style>
