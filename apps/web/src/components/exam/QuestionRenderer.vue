<script setup lang="ts">
import { computed } from "vue";
import type { AnswerResponse, ParticipantQuestion } from "../../features/participant/types";

const props = defineProps<{
  readonly question: ParticipantQuestion;
  readonly response: AnswerResponse;
}>();
const emit = defineEmits<{ (event: "update", value: AnswerResponse): void }>();

const selectedOption = computed(() => "selectedOptionId" in props.response ? props.response.selectedOptionId : null);
const selectedOptions = computed(() => "selectedOptionIds" in props.response ? props.response.selectedOptionIds : []);
const statements = computed(() => new Map("statements" in props.response ? props.response.statements.map((item) => [item.statementId, item.value]) : []));

function selectSingle(value: string): void { emit("update", { selectedOptionId: value }); }
function toggleOption(value: string): void {
  const current = new Set(selectedOptions.value);
  if (current.has(value)) current.delete(value); else current.add(value);
  emit("update", { selectedOptionIds: [...current] });
}
function setStatement(statementId: string, value: boolean): void {
  const current = new Map(statements.value);
  current.set(statementId, value);
  emit("update", { statements: [...current].map(([id, answer]) => ({ statementId: id, value: answer })) });
}
function letter(position: number): string { return String.fromCharCode(64 + position); }
</script>

<template>
  <article class="question" :aria-labelledby="`question-${question.questionId}`">
    <div v-if="question.media.length" class="media-list" aria-label="Media soal"><figure v-for="media in question.media" :key="media.url"><img :src="media.url" :alt="media.isDecorative ? '' : media.altText ?? ''" loading="lazy" /><figcaption v-if="media.altText && !media.isDecorative">{{ media.altText }}</figcaption></figure></div>
    <div class="stimulus" v-html="question.stimulusHtml" />
    <template v-if="question.type === 'TRUE_FALSE'">
      <section class="true-false-intro" :aria-labelledby="`question-${question.questionId}`">
        <h2 :id="`question-${question.questionId}`" tabindex="-1">Tentukan nilai kebenaran ketiga pernyataan berikut:</h2>
        <ol class="statement-preview">
          <li v-for="statement in question.statements" :key="statement.id">
            <strong>({{ statement.position }})</strong>
            <span v-html="statement.statementHtml" />
          </li>
        </ol>
      </section>
      <fieldset class="true-false-answer-table">
        <legend class="sr-only">Pilih Benar atau Salah untuk setiap pernyataan</legend>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">No.</th>
                <th scope="col">Pernyataan</th>
                <th scope="col">Benar</th>
                <th scope="col">Salah</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="statement in question.statements" :key="statement.id">
                <th scope="row">{{ statement.position }}</th>
                <td v-html="statement.statementHtml" />
                <td class="truth-cell">
                  <label class="truth-option" :aria-label="`Pernyataan ${statement.position}: Benar`">
                    <input type="radio" :name="`statement-${question.questionId}-${statement.id}`" :checked="statements.get(statement.id) === true" @change="setStatement(statement.id, true)" />
                    <span class="sr-only">Benar</span>
                  </label>
                </td>
                <td class="truth-cell">
                  <label class="truth-option" :aria-label="`Pernyataan ${statement.position}: Salah`">
                    <input type="radio" :name="`statement-${question.questionId}-${statement.id}`" :checked="statements.get(statement.id) === false" @change="setStatement(statement.id, false)" />
                    <span class="sr-only">Salah</span>
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </fieldset>
    </template>
    <template v-else>
      <h2 :id="`question-${question.questionId}`" tabindex="-1">Pertanyaan</h2>
      <div v-if="question.promptHtml" class="prompt" v-html="question.promptHtml" />
      <p v-if="question.type === 'MULTIPLE_RESPONSE'" class="instruction">Pilih satu atau lebih jawaban. Nilai diberikan jika seluruh pilihan tepat.</p>
      <fieldset v-if="question.type === 'SINGLE_CHOICE'" class="options"><legend class="sr-only">Pilihan jawaban</legend><label v-for="option in question.options" :key="option.id" class="option-card" :class="{ selected: selectedOption === option.id }"><input type="radio" name="single-option" :checked="selectedOption === option.id" :value="option.id" @change="selectSingle(option.id)" /><span class="option-letter">{{ letter(option.position) }}</span><span v-html="option.contentHtml" /></label></fieldset>
      <fieldset v-else class="options"><legend class="sr-only">Pilihan jawaban, dapat memilih lebih dari satu</legend><label v-for="option in question.options" :key="option.id" class="option-card" :class="{ selected: selectedOptions.includes(option.id) }"><input type="checkbox" :checked="selectedOptions.includes(option.id)" :value="option.id" @change="toggleOption(option.id)" /><span class="option-letter">{{ letter(option.position) }}</span><span v-html="option.contentHtml" /></label></fieldset>
    </template>
  </article>
</template>

<style scoped>
.question { font-size: 1.125rem; line-height: 1.65; }.stimulus { padding: 16px; margin-bottom: 20px; border-radius: 10px; background: var(--surface-elevated); }.question h2 { margin: 20px 0 10px; font-size: 1.25rem; }.prompt { margin-bottom: 16px; }.instruction { padding: 10px 12px; color: var(--info); background: var(--info-soft); border-radius: 8px; font-size: 1rem; }.options { display: grid; gap: 10px; padding: 0; border: 0; }.option-card { display: grid; grid-template-columns: auto 28px 1fr; align-items: start; gap: 10px; min-height: 56px; padding: 12px; border: 1px solid var(--border-strong); border-radius: 10px; cursor: pointer; }.option-card.selected { border-color: var(--primary); background: var(--primary-soft); }.option-card input { width: 20px; height: 20px; margin: 2px 0; }.option-letter { font-weight: 700; }.true-false-intro { margin-bottom: 20px; }.statement-preview { display: grid; gap: 6px; padding: 0; margin: 0; list-style: none; }.statement-preview li { display: flex; gap: 8px; }.statement-preview strong { flex: 0 0 auto; }.true-false-answer-table { min-width: 0; padding: 0; margin: 0; border: 0; }.table-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }.true-false-answer-table table { width: 100%; min-width: 560px; border-spacing: 0; border-collapse: separate; background: var(--surface-elevated); }.true-false-answer-table th, .true-false-answer-table td { padding: 12px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }.true-false-answer-table thead th { color: var(--text); background: var(--primary-soft); font-weight: 700; }.true-false-answer-table tbody th { width: 54px; color: var(--subtle); text-align: center; font-variant-numeric: tabular-nums; }.true-false-answer-table th:nth-child(3), .true-false-answer-table th:nth-child(4), .truth-cell { width: 88px; text-align: center; }.true-false-answer-table th:last-child, .true-false-answer-table td:last-child { border-right: 0; }.true-false-answer-table tbody tr:last-child th, .true-false-answer-table tbody tr:last-child td { border-bottom: 0; }.truth-option { display: grid; place-items: center; width: 44px; min-height: 44px; margin: auto; cursor: pointer; }.truth-option input { width: 22px; height: 22px; margin: 0; accent-color: var(--primary); }.media-list { display: grid; gap: 12px; margin-bottom: 18px; }.media-list figure { margin: 0; }.media-list img { display: block; max-width: 100%; max-height: 420px; margin: auto; border-radius: 8px; object-fit: contain; }.media-list figcaption { color: var(--muted); font-size: .875rem; text-align: center; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
