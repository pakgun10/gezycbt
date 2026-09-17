<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";

const props = defineProps<{ readonly subjects?: readonly { id: string; name: string }[]; readonly classes?: readonly { id: string; name: string }[]; readonly dirty?: boolean }>();
const emit = defineEmits<{ change: [subjectId: string, classId: string] }>();
const route = useRoute();
const router = useRouter();
const subjectId = computed(() => String(route.query.subjectId ?? ""));
const classId = computed(() => String(route.query.classId ?? ""));

async function update(key: "subjectId" | "classId", value: string): Promise<void> {
  if (props.dirty && !window.confirm("Perubahan yang belum disimpan akan tetap berada di editor. Ganti scope?")) return;
  const query = { ...route.query, [key]: value || undefined, cursor: undefined, page: undefined };
  await router.replace({ query });
  emit("change", key === "subjectId" ? value : subjectId.value, key === "classId" ? value : classId.value);
}
</script>

<template>
  <div class="scope-switcher" aria-label="Scope dan filter"><label>Mata pelajaran<select :value="subjectId" @change="update('subjectId', ($event.target as HTMLSelectElement).value)"><option value="">Semua yang diizinkan</option><option v-for="subject in subjects ?? []" :key="subject.id" :value="subject.id">{{ subject.name }}</option></select></label><label>Kelas<select :value="classId" @change="update('classId', ($event.target as HTMLSelectElement).value)"><option value="">Semua kelas</option><option v-for="item in classes ?? []" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></div>
</template>

<style scoped>
.scope-switcher { display: flex; flex-wrap: wrap; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }.scope-switcher label { display: grid; gap: 4px; color: var(--muted); font-size: .8rem; font-weight: 700; }.scope-switcher select { min-height: 36px; min-width: 160px; padding: 4px 28px 4px 8px; border: 1px solid var(--border-strong); border-radius: 7px; color: var(--text); background: var(--surface); font-weight: 400; }
@media (max-width: 600px) { .scope-switcher { display: grid; grid-template-columns: 1fr 1fr; }.scope-switcher select { min-width: 0; width: 100%; } }
</style>
