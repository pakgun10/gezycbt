<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { HttpStaffApi } from "../features/staff/api";
import { ApiClientError } from "../lib/api";
import type { MediaAlignment, MediaAsset, MediaUsage, QuestionBankSummary, QuestionDraft, QuestionImportPreview, QuestionMedia, QuestionSummary, Subject } from "../features/staff/types";
import { messageFrom, safeHtmlPreview } from "../features/staff/helpers";
import { subjectOptionLabel } from "../features/staff/master-data-policies";
import ScopeSwitcher from "../components/ScopeSwitcher.vue";
import RichContentEditor from "../components/question/RichContentEditor.vue";
import SafeQuestionContent from "../components/question/SafeQuestionContent.vue";

const api = new HttpStaffApi();
const items = ref<readonly QuestionSummary[]>([]);
const banks = ref<readonly QuestionBankSummary[]>([]);
const subjects = ref<readonly Subject[]>([]);
const query = ref("");
const loading = ref(true);
const error = ref("");
const selected = ref<QuestionDraft | null>(null);
const saving = ref(false);
const bankSaving = ref(false);
const bankNotice = ref("");
const showBankForm = ref(false);
const bankEditingId = ref<string | null>(null);
const bankEditName = ref("");
const bankActionBusy = ref<string | null>(null);
const questionActionBusy = ref<string | null>(null);
const selectedQuestionIds = ref<readonly string[]>([]);
const questionPage = ref(1);
const questionPageCursors = ref<readonly (string | undefined)[]>([undefined]);
const nextQuestionCursor = ref<string | null>(null);
const bulkNotice = ref("");
const showImportForm = ref(false);
const bankForm = ref({ subjectId: "", name: "" });
const questionImportBankId = ref("");
const questionImportCsv = ref("");
const questionImportFileName = ref("");
const questionImportFormat = ref<"CSV" | "TXT">("CSV");
const questionImportPreview = ref<QuestionImportPreview | null>(null);
const questionImportBusy = ref(false);
const questionImportMessage = ref("");
const publishMessage = ref("");
const report = ref<{ isReady: boolean; issues: readonly { severity: string; message: string; fieldPath: string }[] } | null>(null);
const previewOpen = ref(false);
const previewViewport = ref<"phone" | "tablet" | "desktop">("desktop");
const mediaBusy = ref(false);
const mediaFeedback = ref<Record<string, string>>({});
const orphanMedia = ref<readonly MediaAsset[]>([]);
const orphanMediaBusy = ref(false);
const orphanMediaMessage = ref("");
type EditableOption = { id?: string; contentHtml: string; isCorrect: boolean };
type EditableStatement = { id?: string; statementHtml: string; correctValue: boolean };
type MediaUploadInput = {
  readonly file: File;
  readonly altText: string;
  readonly isDecorative: boolean;
  readonly displayWidthPercent: number;
  readonly alignment: MediaAlignment;
};
type QuestionForm = {
  questionBankId: string;
  type: QuestionDraft["type"];
  stimulusHtml: string;
  promptHtml: string;
  explanationHtml: string;
  options: EditableOption[];
  statements: EditableStatement[];
};
const form = ref<QuestionForm>({ questionBankId: "", type: "SINGLE_CHOICE", stimulusHtml: "", promptHtml: "", explanationHtml: "", options: [{ contentHtml: "", isCorrect: false }, { contentHtml: "", isCorrect: false }], statements: [{ statementHtml: "", correctValue: true }, { statementHtml: "", correctValue: false }, { statementHtml: "", correctValue: false }] });
const dirty = computed(() => Boolean(selected.value) && !saving.value);
const activeBanks = computed(() => banks.value.filter((bank) => bank.status === "ACTIVE"));
const questionActionsBusy = computed(() => questionActionBusy.value !== null);
const allQuestionsSelected = computed(
  () => items.value.length > 0 && items.value.every((item) => selectedQuestionIds.value.includes(item.questionId)),
);
const selectedQuestions = computed(() => items.value.filter((item) => selectedQuestionIds.value.includes(item.questionId)));
const selectedQuestionsCanBeDeleted = computed(
  () => selectedQuestions.value.length > 0 && selectedQuestions.value.every((item) => item.canPermanentlyDelete),
);

async function loadQuestions(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const page = await api.questions(query.value, questionPageCursors.value[questionPage.value - 1]);
    items.value = page.items;
    nextQuestionCursor.value = page.nextCursor;
  } catch (cause) {
    error.value = messageFrom(cause, "Daftar soal belum tersedia.");
  } finally {
    loading.value = false;
  }
}
async function load(): Promise<void> {
  try {
    const [bankPage, subjectPage] = await Promise.all([api.questionBanks(), api.teacherSubjects()]);
    banks.value = bankPage.items;
    subjects.value = subjectPage.items;
  } catch (cause) {
    error.value = messageFrom(cause, "Bank soal belum tersedia.");
  }
  await loadQuestions();
}
async function searchQuestions(): Promise<void> {
  questionPage.value = 1;
  questionPageCursors.value = [undefined];
  selectedQuestionIds.value = [];
  bulkNotice.value = "";
  await loadQuestions();
}
async function goToPreviousQuestionPage(): Promise<void> {
  if (questionPage.value === 1 || loading.value) return;
  questionPage.value -= 1;
  selectedQuestionIds.value = [];
  await loadQuestions();
}
async function goToNextQuestionPage(): Promise<void> {
  if (!nextQuestionCursor.value || loading.value) return;
  questionPageCursors.value = [...questionPageCursors.value, nextQuestionCursor.value];
  questionPage.value += 1;
  selectedQuestionIds.value = [];
  await loadQuestions();
}
function toggleAllQuestions(event: Event): void {
  selectedQuestionIds.value = (event.target as HTMLInputElement).checked ? items.value.map((item) => item.questionId) : [];
}
async function createBank(): Promise<void> { bankSaving.value = true; error.value = ""; bankNotice.value = ""; try { const bank = await api.createQuestionBank({ subjectId: bankForm.value.subjectId, name: bankForm.value.name }); banks.value = [bank, ...banks.value]; bankNotice.value = `Bank soal “${bank.name}” berhasil disimpan.`; bankForm.value = { subjectId: bank.subjectId, name: "" }; showBankForm.value = false; } catch (cause) { error.value = messageFrom(cause, "Bank soal belum dapat dibuat."); } finally { bankSaving.value = false; } }
function beginBankEdit(bank: QuestionBankSummary): void { bankEditingId.value = bank.id; bankEditName.value = bank.name; bankNotice.value = ""; error.value = ""; }
function cancelBankEdit(): void { bankEditingId.value = null; bankEditName.value = ""; }
function replaceBank(updated: QuestionBankSummary): void { banks.value = banks.value.map((bank) => bank.id === updated.id ? updated : bank); }
async function saveBankEdit(bank: QuestionBankSummary): Promise<void> { const name = bankEditName.value.trim(); if (!name) { error.value = "Nama bank wajib diisi."; return; } bankActionBusy.value = bank.id; error.value = ""; try { const updated = await api.updateQuestionBank(bank.id, { name }, bank.updatedAt); replaceBank(updated); bankNotice.value = `Nama bank berhasil diubah menjadi “${updated.name}”.`; cancelBankEdit(); } catch (cause) { error.value = messageFrom(cause, "Nama bank belum dapat diubah. Muat ulang lalu coba lagi jika data sudah berubah."); } finally { bankActionBusy.value = null; } }
async function changeBankStatus(bank: QuestionBankSummary, status: "ACTIVE" | "ARCHIVED"): Promise<void> { const action = status === "ARCHIVED" ? "Arsipkan" : "Pulihkan"; if (!window.confirm(`${action} bank soal “${bank.name}”?`)) return; bankActionBusy.value = bank.id; error.value = ""; try { const updated = await api.updateQuestionBank(bank.id, { status }, bank.updatedAt); replaceBank(updated); bankNotice.value = status === "ARCHIVED" ? `Bank soal “${updated.name}” diarsipkan.` : `Bank soal “${updated.name}” dipulihkan.`; if (questionImportBankId.value === bank.id && status === "ARCHIVED") { questionImportBankId.value = ""; questionImportPreview.value = null; } } catch (cause) { error.value = messageFrom(cause, `Bank soal belum dapat diubah. Muat ulang lalu coba ${status === "ARCHIVED" ? "arsipkan" : "pulihkan"} lagi.`); } finally { bankActionBusy.value = null; } }
async function deleteQuestionBank(bank: QuestionBankSummary): Promise<void> { if (!window.confirm(`Hapus permanen bank soal kosong “${bank.name}”? Tindakan ini tidak dapat dibatalkan.`)) return; bankActionBusy.value = bank.id; error.value = ""; try { await api.deleteQuestionBank(bank.id, bank.updatedAt); banks.value = banks.value.filter((item) => item.id !== bank.id); bankNotice.value = `Bank soal “${bank.name}” dihapus permanen.`; } catch (cause) { error.value = messageFrom(cause, "Bank soal belum dapat dihapus."); } finally { bankActionBusy.value = null; } }
async function changeQuestionStatus(item: QuestionSummary, status: "ACTIVE" | "ARCHIVED"): Promise<void> { const action = status === "ARCHIVED" ? "Arsipkan" : "Pulihkan"; if (!window.confirm(`${action} butir soal ini?`)) return; questionActionBusy.value = item.questionId; error.value = ""; try { const updated = await api.updateQuestionLifecycle(item.questionId, status, item.questionUpdatedAt); items.value = items.value.map((candidate) => candidate.questionId === item.questionId ? { ...candidate, questionStatus: updated.status, questionUpdatedAt: updated.updatedAt } : candidate); if (selected.value?.questionId === item.questionId) selected.value = { ...selected.value, questionStatus: updated.status }; } catch (cause) { error.value = messageFrom(cause, `Butir soal belum dapat ${status === "ARCHIVED" ? "diarsipkan" : "dipulihkan"}.`); } finally { questionActionBusy.value = null; } }
async function changeSelectedQuestionStatuses(status: "ACTIVE" | "ARCHIVED"): Promise<void> {
  const questions = selectedQuestions.value;
  if (!questions.length || questionActionsBusy.value) return;
  const action = status === "ARCHIVED" ? "Arsipkan" : "Pulihkan";
  if (!window.confirm(`${action} ${questions.length} butir soal terpilih?`)) return;
  questionActionBusy.value = "bulk";
  error.value = "";
  bulkNotice.value = "";
  const results = await Promise.allSettled(questions.map((item) => api.updateQuestionLifecycle(item.questionId, status, item.questionUpdatedAt)));
  const successful = new Map<string, { status: "ACTIVE" | "ARCHIVED"; updatedAt: string }>();
  const failedIds: string[] = [];
  results.forEach((result, index) => {
    const item = questions[index];
    if (!item) return;
    if (result.status === "fulfilled") successful.set(item.questionId, result.value);
    else failedIds.push(item.questionId);
  });
  items.value = items.value.map((item) => {
    const updated = successful.get(item.questionId);
    return updated ? { ...item, questionStatus: updated.status, questionUpdatedAt: updated.updatedAt } : item;
  });
  selectedQuestionIds.value = failedIds;
  if (successful.size) bulkNotice.value = `${successful.size} butir soal berhasil ${status === "ARCHIVED" ? "diarsipkan" : "dipulihkan"}.`;
  if (failedIds.length) error.value = `${failedIds.length} butir soal belum dapat diproses. Muat ulang lalu coba lagi.`;
  questionActionBusy.value = null;
}
async function deleteSelectedQuestions(): Promise<void> {
  const questions = selectedQuestions.value;
  if (!selectedQuestionsCanBeDeleted.value || questionActionsBusy.value) return;
  if (!window.confirm(`Hapus permanen ${questions.length} butir soal draft terpilih? Tindakan ini tidak dapat dibatalkan.`)) return;
  questionActionBusy.value = "bulk";
  error.value = "";
  bulkNotice.value = "";
  const results = await Promise.allSettled(questions.map((item) => api.deleteQuestion(item.questionId, item.questionUpdatedAt)));
  const deletedIds = new Set<string>();
  const failedIds: string[] = [];
  results.forEach((result, index) => {
    const item = questions[index];
    if (!item) return;
    if (result.status === "fulfilled") deletedIds.add(item.questionId);
    else failedIds.push(item.questionId);
  });
  items.value = items.value.filter((item) => !deletedIds.has(item.questionId));
  selectedQuestionIds.value = failedIds;
  if (selected.value && deletedIds.has(selected.value.questionId)) close();
  if (deletedIds.size) bulkNotice.value = `${deletedIds.size} butir soal berhasil dihapus permanen.`;
  if (failedIds.length) error.value = `${failedIds.length} butir soal belum dapat dihapus. Muat ulang lalu coba lagi.`;
  questionActionBusy.value = null;
}
async function deleteQuestion(item: QuestionSummary): Promise<void> { if (!item.canPermanentlyDelete || !window.confirm("Hapus permanen butir soal draft ini? Seluruh isi dan relasi gambarnya akan dihapus.")) return; questionActionBusy.value = item.questionId; error.value = ""; try { await api.deleteQuestion(item.questionId, item.questionUpdatedAt); items.value = items.value.filter((candidate) => candidate.questionId !== item.questionId); if (selected.value?.questionId === item.questionId) close(); } catch (cause) { error.value = messageFrom(cause, "Butir soal belum dapat dihapus."); } finally { questionActionBusy.value = null; } }
async function readQuestionImportFile(event: Event): Promise<void> { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; const format = file.name.toLowerCase().endsWith(".txt") ? "TXT" : file.name.toLowerCase().endsWith(".csv") ? "CSV" : null; if (!format) { questionImportMessage.value = "Pilih file CSV atau TXT."; return; } if (file.size > 1024 * 1024) { questionImportMessage.value = `File ${format} maksimal 1 MiB.`; return; } questionImportCsv.value = await file.text(); questionImportFileName.value = file.name; questionImportFormat.value = format; questionImportPreview.value = null; questionImportMessage.value = `File ${format} siap dipratinjau.`; }
function resetQuestionImportPreview(): void { if (!questionImportPreview.value) return; questionImportPreview.value = null; questionImportMessage.value = "Bank tujuan berubah. Buat preview baru sebelum import."; }
function downloadQuestionImportTemplate(format: "CSV" | "TXT"): void { const headers = ["type", "stimulus", "prompt", "explanation", ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}`), ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}_correct`), ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}`), ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}_correct`)]; const delimiter = format === "TXT" ? "\t" : ","; const makeRow = (values: Record<string, string>) => headers.map((field) => values[field] ?? "").join(delimiter); const content = [headers.join(delimiter), makeRow({ type: "SINGLE_CHOICE", stimulus: "Bacalah stimulus ini.", prompt: "Pilih jawaban yang tepat.", option_1: "Pilihan A", option_1_correct: "BENAR", option_2: "Pilihan B", option_2_correct: "SALAH" }), makeRow({ type: "MULTIPLE_RESPONSE", stimulus: "Bacalah stimulus ini.", prompt: "Pilih semua jawaban yang tepat.", option_1: "Pilihan A", option_1_correct: "BENAR", option_2: "Pilihan B", option_2_correct: "SALAH", option_3: "Pilihan C", option_3_correct: "BENAR" }), makeRow({ type: "TRUE_FALSE", stimulus: "Bacalah stimulus ini.", statement_1: "Pernyataan pertama.", statement_1_correct: "BENAR", statement_2: "Pernyataan kedua.", statement_2_correct: "SALAH", statement_3: "Pernyataan ketiga.", statement_3_correct: "BENAR" })].join("\n"); const url = URL.createObjectURL(new Blob([content], { type: format === "TXT" ? "text/plain;charset=utf-8" : "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `template-import-soal.${format.toLowerCase()}`; anchor.click(); URL.revokeObjectURL(url); }
function downloadQuestionImportTextTemplate(): void {
  const fields = ["type", "stimulus", "prompt", "explanation", ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}`), ...Array.from({ length: 10 }, (_, index) => `option_${index + 1}_correct`), ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}`), ...Array.from({ length: 3 }, (_, index) => `statement_${index + 1}_correct`)];
  const block = (number: number, values: Record<string, string>): string => [`Soal${number}`, ...fields.map((field) => `${field}\t${values[field] ?? ""}`)].join("\n");
  const content = [
    block(1, { type: "SINGLE_CHOICE", stimulus: "Bacalah stimulus ini.", prompt: "Pilih jawaban yang tepat.", option_1: "Pilihan A", option_1_correct: "BENAR", option_2: "Pilihan B", option_2_correct: "SALAH" }),
    block(2, { type: "MULTIPLE_RESPONSE", stimulus: "Bacalah stimulus ini.", prompt: "Pilih semua jawaban yang tepat.", option_1: "Pilihan A", option_1_correct: "BENAR", option_2: "Pilihan B", option_2_correct: "SALAH", option_3: "Pilihan C", option_3_correct: "BENAR" }),
    block(3, { type: "TRUE_FALSE", stimulus: "Bacalah stimulus ini.", statement_1: "Pernyataan pertama.", statement_1_correct: "BENAR", statement_2: "Pernyataan kedua.", statement_2_correct: "SALAH", statement_3: "Pernyataan ketiga.", statement_3_correct: "BENAR" }),
    block(4, { type: "SINGLE_CHOICE", stimulus: 'Segitiga siku-siku mempunyai sisi <span data-content-node="inline-math" data-latex="a=6"></span> cm dan <span data-content-node="inline-math" data-latex="b=8"></span> cm.', prompt: "Panjang sisi miring segitiga tersebut adalah ...", explanation: 'Gunakan teorema Pythagoras.<div data-content-node="block-math" data-latex="c=\\sqrt{a^2+b^2}=\\sqrt{6^2+8^2}=10"></div>', option_1: '8 cm', option_2: '<span data-content-node="inline-math" data-latex="10"></span> cm', option_3: '12 cm', option_4: '14 cm', option_1_correct: "SALAH", option_2_correct: "BENAR", option_3_correct: "SALAH", option_4_correct: "SALAH" }),
  ].join("\n\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "template-import-soal.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}
async function previewQuestionImport(): Promise<void> { if (!questionImportBankId.value || !questionImportCsv.value) { questionImportMessage.value = "Pilih bank soal dan file CSV atau TXT terlebih dahulu."; return; } questionImportBusy.value = true; questionImportMessage.value = "Server sedang memvalidasi soal…"; try { questionImportPreview.value = await api.previewQuestionImport(questionImportBankId.value, questionImportCsv.value, questionImportFormat.value); questionImportMessage.value = questionImportPreview.value.errorCount ? "Preview selesai. Perbaiki baris error sebelum import." : "Preview valid. Soal akan dibuat sebagai draft."; } catch (cause) { questionImportMessage.value = messageFrom(cause, "Preview import belum dapat dibuat."); } finally { questionImportBusy.value = false; } }
async function commitQuestionImport(): Promise<void> { const preview = questionImportPreview.value; if (!preview || preview.errorCount || questionImportBusy.value) return; const bankName = banks.value.find((bank) => bank.id === questionImportBankId.value)?.name ?? "bank yang dipilih"; if (!window.confirm(`Import ${preview.validCount} soal sebagai draft ke bank ${bankName}?`)) return; questionImportBusy.value = true; questionImportMessage.value = "Server sedang membuat draft soal…"; try { const result = await api.commitQuestionImport(questionImportBankId.value, questionImportCsv.value, preview.sourceHash, questionImportFormat.value); questionImportMessage.value = `${result.createdCount} soal berhasil dibuat sebagai draft.`; questionImportPreview.value = null; questionImportCsv.value = ""; questionImportFileName.value = ""; await searchQuestions(); } catch (cause) { questionImportMessage.value = messageFrom(cause, "Import soal belum dapat diselesaikan."); } finally { questionImportBusy.value = false; } }
function bankSubjectLabel(subjectId: string): string { const subject = subjects.value.find((item) => item.id === subjectId); return subject ? subjectOptionLabel(subject) : `Mata pelajaran #${subjectId}`; }
async function loadOrphanMedia(): Promise<void> {
  try {
    orphanMedia.value = await api.listOrphanMedia();
  } catch (cause) {
    orphanMediaMessage.value = messageFrom(cause, "Daftar gambar tidak dapat dimuat.");
  }
}
async function deleteOrphanMedia(asset: MediaAsset): Promise<void> {
  if (!window.confirm(`Hapus gambar orphan “${asset.originalName}”?`)) return;
  orphanMediaBusy.value = true;
  orphanMediaMessage.value = "Menghapus gambar…";
  try {
    await api.deleteMedia(asset.id);
    orphanMedia.value = orphanMedia.value.filter((item) => item.id !== asset.id);
    orphanMediaMessage.value = "Gambar orphan dihapus.";
  } catch (cause) {
    orphanMediaMessage.value = messageFrom(cause, "Gambar belum dapat dihapus.");
  } finally {
    orphanMediaBusy.value = false;
  }
}
function open(item?: QuestionSummary): void {
  report.value = null;
  publishMessage.value = "";
  mediaFeedback.value = {};
  if (!item) {
    selected.value = { id: "new", questionId: "new", questionBank: { id: "", name: "Bank baru", subjectId: "" }, questionStatus: "ACTIVE", revisionNo: 1, type: "SINGLE_CHOICE", status: "DRAFT", stimulusHtml: "", promptHtml: "", explanationHtml: "", options: [], statements: [], media: [], updatedAt: "" };
    form.value = {
      questionBankId: "",
      type: "SINGLE_CHOICE",
      stimulusHtml: "",
      promptHtml: "",
      explanationHtml: "",
      options: [{ contentHtml: "", isCorrect: false }, { contentHtml: "", isCorrect: false }],
      statements: [{ statementHtml: "", correctValue: true }, { statementHtml: "", correctValue: false }, { statementHtml: "", correctValue: false }],
    };
    return;
  }
  void api.question(item.id).then((draft) => {
    selected.value = draft;
    hydrateForm(draft);
  }).catch((cause) => { error.value = messageFrom(cause); });
}
function hydrateForm(draft: QuestionDraft): void {
  form.value = {
    questionBankId: draft.questionBank.id,
    type: draft.type,
    stimulusHtml: draft.stimulusHtml,
    promptHtml: draft.promptHtml ?? "",
    explanationHtml: draft.explanationHtml ?? "",
    options: draft.options.map((option) => ({ ...(option.id ? { id: option.id } : {}), contentHtml: option.contentHtml, isCorrect: option.isCorrect })),
    statements: draft.statements.map((statement) => ({ ...(statement.id ? { id: statement.id } : {}), statementHtml: statement.statementHtml, correctValue: statement.correctValue })),
  };
}
function close(): void { selected.value = null; report.value = null; publishMessage.value = ""; mediaFeedback.value = {}; }
function addOption(): void { if (form.value.options.length < 10) form.value.options.push({ contentHtml: "", isCorrect: false }); }
function addStatement(): void { if (form.value.statements.length < 3) form.value.statements.push({ statementHtml: "", correctValue: false }); }
function questionPayload(): Record<string, unknown> {
  return {
    type: form.value.type,
    stimulusHtml: form.value.stimulusHtml,
    promptHtml: form.value.type === "TRUE_FALSE" ? null : form.value.promptHtml || null,
    explanationHtml: form.value.explanationHtml || null,
    options: form.value.type === "TRUE_FALSE" ? [] : form.value.options.map((item, index) => ({ ...(item.id ? { id: item.id } : {}), position: index + 1, contentHtml: item.contentHtml, isCorrect: item.isCorrect })),
    statements: form.value.type === "TRUE_FALSE" ? form.value.statements.map((item, index) => ({ ...(item.id ? { id: item.id } : {}), position: index + 1, statementHtml: item.statementHtml, correctValue: item.correctValue })) : [],
  };
}
async function ensureEditableDraft(): Promise<boolean> {
  const current = selected.value;
  if (!current) return false;
  const payload = questionPayload();
  try {
    selected.value = current.id === "new"
      ? await api.createQuestion({ questionBankId: form.value.questionBankId, ...payload })
      : current.status === "PUBLISHED"
        ? await api.updateQuestion(current.id, payload, current.updatedAt)
        : current;
    hydrateForm(selected.value);
    return true;
  } catch (cause) {
    error.value = messageFrom(cause, "Draft belum dapat disiapkan.");
    return false;
  }
}
async function save(): Promise<boolean> {
  if (!selected.value) return false;
  saving.value = true;
  error.value = "";
  publishMessage.value = "";
  try {
    if (!await ensureEditableDraft() || !selected.value) return false;
    const saved = await api.saveQuestion(
      selected.value.id,
      questionPayload(),
      selected.value.updatedAt,
    );
    selected.value = saved;
    hydrateForm(saved);
    report.value = null;
    publishMessage.value = `Soal tersimpan sebagai revision ${saved.revisionNo}.`;
    await searchQuestions();
    return true;
  } catch (cause) {
    if (cause instanceof ApiClientError && cause.code === "QUESTION_NOT_READY") {
      const revision = cause.details.revision as QuestionDraft | undefined;
      const readiness = cause.details.report as typeof report.value;
      if (revision) {
        selected.value = revision;
        hydrateForm(revision);
      }
      if (readiness) report.value = readiness;
    }
    error.value = messageFrom(cause, "Soal belum dapat disimpan.");
    return false;
  } finally {
    saving.value = false;
  }
}
function mediaFeedbackKey(usage: MediaUsage, targetId?: string): string {
  return `${usage}:${targetId ?? ""}`;
}
function setMediaFeedback(usage: MediaUsage, targetId: string | undefined, message: string): void {
  mediaFeedback.value = {
    ...mediaFeedback.value,
    [mediaFeedbackKey(usage, targetId)]: message,
  };
}
function mediaNoticeFor(usage: MediaUsage, targetId?: string): string {
  return mediaFeedback.value[mediaFeedbackKey(usage, targetId)] ?? "";
}
function mediaFor(usage: MediaUsage, targetId?: string): readonly QuestionMedia[] {
  return (selected.value?.media ?? []).filter((media) => {
    if (media.usage !== usage) return false;
    if (usage === "OPTION") return media.questionOptionId === targetId;
    if (usage === "STATEMENT") return media.trueFalseStatementId === targetId;
    return true;
  });
}
function mediaUnavailableReason(usage?: MediaUsage, targetId?: string, targetIndex?: number): string {
  const current = selected.value;
  if (!current) return "Editor soal belum siap.";
  if (current.status === "PUBLISHED") return "Revision yang sudah dipublish tidak dapat diubah.";
  if ((current.media?.length ?? 0) >= 3) return "Maksimal 3 gambar per soal.";
  if ((usage === "OPTION" || usage === "STATEMENT") && !targetId && targetIndex === undefined) return "Simpan draft setelah menambah field ini agar gambar dapat dipasang.";
  return "";
}
function mediaIsDisabled(usage?: MediaUsage, targetId?: string, targetIndex?: number): boolean {
  const current = selected.value;
  if (!current || current.status === "PUBLISHED") return true;
  return (usage === "OPTION" || usage === "STATEMENT") && !targetId && targetIndex === undefined;
}
function mediaLimitReached(): boolean {
  return (selected.value?.media?.length ?? 0) >= 3;
}
function appendMediaPlaceholder(usage: MediaUsage, targetId: string | undefined, placementKey: string): void {
  const placeholder = `<figure data-content-node="question-media" data-media-placement="${placementKey}"></figure>`;
  if (usage === "STIMULUS") form.value.stimulusHtml += placeholder;
  else if (usage === "PROMPT") form.value.promptHtml += placeholder;
  else if (usage === "EXPLANATION") form.value.explanationHtml += placeholder;
  else if (usage === "OPTION") {
    const option = form.value.options.find((item) => item.id === targetId);
    if (option) option.contentHtml += placeholder;
  } else if (usage === "STATEMENT") {
    const statement = form.value.statements.find((item) => item.id === targetId);
    if (statement) statement.statementHtml += placeholder;
  }
}
async function attachRichMedia(usage: MediaUsage, targetId: string | undefined, input: MediaUploadInput, targetIndex?: number): Promise<void> {
  let current = selected.value;
  let resolvedTargetId = targetId;
  const unavailable = mediaUnavailableReason(usage, targetId, targetIndex);
  if (!current || unavailable) {
    setMediaFeedback(usage, targetId, unavailable || "Editor soal belum siap.");
    return;
  }
  mediaBusy.value = true;
  setMediaFeedback(usage, targetId, "Mengunggah gambar…");
  try {
    if (current.id === "new" || current.status === "PUBLISHED" || ((usage === "OPTION" || usage === "STATEMENT") && !resolvedTargetId)) {
      const saved = await ensureEditableDraft();
      current = selected.value;
      if (!saved || !current || current.id === "new") {
        setMediaFeedback(usage, targetId, "Draft belum dapat disiapkan. Lengkapi data dasar lalu coba lagi.");
        return;
      }
      resolvedTargetId = usage === "OPTION"
        ? form.value.options[targetIndex ?? -1]?.id
        : usage === "STATEMENT"
          ? form.value.statements[targetIndex ?? -1]?.id
          : undefined;
      if ((usage === "OPTION" || usage === "STATEMENT") && !resolvedTargetId) {
        setMediaFeedback(usage, targetId, "Field ini belum memiliki ID. Coba pasang gambar sekali lagi.");
        return;
      }
    }
    const asset = await api.uploadMedia(input.file);
    const relation = await api.attachQuestionMedia(current.id, {
      mediaAssetId: asset.id,
      usage,
      ...(resolvedTargetId
        ? usage === "OPTION"
          ? { questionOptionId: resolvedTargetId }
          : usage === "STATEMENT"
            ? { trueFalseStatementId: resolvedTargetId }
            : {}
        : {}),
      altText: input.isDecorative ? null : input.altText,
      isDecorative: input.isDecorative,
      displayWidthPercent: input.displayWidthPercent,
      alignment: input.alignment,
      expectedUpdatedAt: current.updatedAt,
    });
    selected.value = await api.question(current.id);
    appendMediaPlaceholder(usage, resolvedTargetId, relation.placementKey ?? "");
    setMediaFeedback(usage, resolvedTargetId, "Gambar berhasil dipasang. Tekan Simpan untuk menerbitkan perubahan.");
  } catch (cause) {
    setMediaFeedback(usage, resolvedTargetId, messageFrom(cause, "Gambar belum dapat diunggah."));
  } finally {
    mediaBusy.value = false;
  }
}
async function removeMedia(media: QuestionMedia): Promise<void> {
  const targetId = media.usage === "OPTION" ? media.questionOptionId ?? undefined : media.usage === "STATEMENT" ? media.trueFalseStatementId ?? undefined : undefined;
  if (!selected.value || selected.value.id === "new" || !window.confirm("Hapus gambar dari field ini?")) return;
  mediaBusy.value = true;
  setMediaFeedback(media.usage, targetId, "Menghapus gambar…");
  try {
    await api.detachQuestionMedia(
      selected.value.id,
      media.placementKey ?? media.mediaAssetId,
      selected.value.updatedAt,
    );
    const placementKey = media.placementKey;
    if (placementKey) {
      form.value.stimulusHtml = removeMediaPlaceholder(
        form.value.stimulusHtml,
        placementKey,
      );
      form.value.promptHtml = removeMediaPlaceholder(
        form.value.promptHtml,
        placementKey,
      );
      form.value.explanationHtml = removeMediaPlaceholder(
        form.value.explanationHtml,
        placementKey,
      );
      form.value.options = form.value.options.map((option) => ({
        ...option,
        contentHtml: removeMediaPlaceholder(option.contentHtml, placementKey),
      }));
      form.value.statements = form.value.statements.map((statement) => ({
        ...statement,
        statementHtml: removeMediaPlaceholder(
          statement.statementHtml,
          placementKey,
        ),
      }));
    }
    const refreshed = await api.question(selected.value.id);
    selected.value = refreshed;
    setMediaFeedback(media.usage, targetId, "Gambar dilepas dari field ini.");
    await loadOrphanMedia();
  } catch (cause) {
    setMediaFeedback(media.usage, targetId, messageFrom(cause, "Gambar belum dapat dihapus."));
  } finally {
    mediaBusy.value = false;
  }
}
async function updateMediaDetails(
  media: QuestionMedia,
  input: Record<string, unknown>,
): Promise<void> {
  if (!selected.value || selected.value.id === "new") return;
  const targetId = media.usage === "OPTION" ? media.questionOptionId ?? undefined : media.usage === "STATEMENT" ? media.trueFalseStatementId ?? undefined : undefined;
  mediaBusy.value = true;
  setMediaFeedback(media.usage, targetId, "Menyimpan detail gambar…");
  try {
    await api.updateQuestionMedia(
      selected.value.id,
      media.placementKey ?? media.mediaAssetId,
      { ...input, expectedUpdatedAt: selected.value.updatedAt },
    );
    selected.value = await api.question(selected.value.id);
    setMediaFeedback(media.usage, targetId, "Detail gambar disimpan.");
  } catch (cause) {
    setMediaFeedback(media.usage, targetId, messageFrom(cause, "Detail gambar belum dapat disimpan."));
  } finally {
    mediaBusy.value = false;
  }
}
function previewOptionMedia(index: number): readonly QuestionMedia[] {
  const target = form.value.options[index]?.id;
  return (selected.value?.media ?? []).filter((media) => media.usage === "OPTION" && media.questionOptionId === target);
}
function previewStatementMedia(index: number): readonly QuestionMedia[] {
  const target = form.value.statements[index]?.id;
  return (selected.value?.media ?? []).filter((media) => media.usage === "STATEMENT" && media.trueFalseStatementId === target);
}
function removeMediaPlaceholder(html: string, placementKey: string): string {
  const documentValue = new DOMParser().parseFromString(html, "text/html");
  documentValue.querySelectorAll("[data-media-placement]").forEach((node) => {
    if (node.getAttribute("data-media-placement") === placementKey)
      node.remove();
  });
  return documentValue.body.innerHTML;
}
onMounted(() => { void load(); void loadOrphanMedia(); });
</script>

<template>
  <header class="page-heading between"><div><p class="eyebrow">Guru · Authoring</p><h1>Bank Soal</h1><p class="muted">Buat bank dan validasi tiga tipe soal dengan answer key hanya di area staff.</p></div><div class="stack"><button class="btn-secondary" type="button" @click="showBankForm = !showBankForm">Buat bank</button><button class="btn-secondary" type="button" @click="showImportForm = !showImportForm">Import soal</button><button class="btn-primary" type="button" @click="open()">Buat soal</button></div></header>
  <section v-if="showBankForm" class="card bank-form"><form class="form-grid" @submit.prevent="createBank"><label>Mata pelajaran<select v-model="bankForm.subjectId" required><option value="" disabled>Pilih mata pelajaran</option><option v-for="subject in subjects" :key="subject.id" :value="subject.id">{{ subjectOptionLabel(subject) }}</option></select><small v-if="subjects.length === 0" class="muted">Belum ada mata pelajaran yang ditugaskan. Minta admin mengatur scope guru.</small></label><label>Nama bank<input v-model="bankForm.name" maxlength="200" required /></label><button class="btn-primary" type="submit" :disabled="bankSaving || subjects.length === 0 || !bankForm.subjectId">{{ bankSaving ? "Menyimpan…" : "Simpan bank" }}</button></form></section>
  <div v-if="bankNotice" class="alert alert-info" role="status">{{ bankNotice }}</div>
  <section class="card bank-list-panel" aria-labelledby="bank-list-title"><div class="between"><div><h2 id="bank-list-title">Bank soal tersedia</h2><p class="muted">Bank yang dapat Anda lihat dan kelola sesuai peran serta scope.</p></div><span class="selection-count">{{ banks.length }} bank</span></div><div v-if="banks.length" class="bank-list"><article v-for="bank in banks" :key="bank.id" class="bank-item"><div class="between bank-item-heading"><strong>{{ bank.name }}</strong><span class="badge" :class="bank.status === 'ACTIVE' ? 'badge-success' : 'badge-warning'">{{ bank.status === 'ACTIVE' ? 'Aktif' : 'Arsip' }}</span></div><small>{{ bankSubjectLabel(bank.subjectId) }} · Bank #{{ bank.id }}</small><div v-if="bankEditingId === bank.id" class="bank-edit-form"><label :for="`bank-name-${bank.id}`">Nama bank<input :id="`bank-name-${bank.id}`" v-model="bankEditName" maxlength="200" @keyup.enter="saveBankEdit(bank)" /></label><div class="bank-actions"><button class="btn-primary" type="button" :disabled="bankActionBusy === bank.id" @click="saveBankEdit(bank)">{{ bankActionBusy === bank.id ? "Menyimpan…" : "Simpan nama" }}</button><button class="btn-quiet" type="button" :disabled="bankActionBusy === bank.id" @click="cancelBankEdit">Batal</button></div></div><div v-else class="bank-actions"><button class="btn-quiet" type="button" :disabled="bankActionBusy === bank.id" @click="beginBankEdit(bank)">Edit nama</button><button v-if="bank.status === 'ACTIVE'" class="btn-quiet danger-action" type="button" :disabled="bankActionBusy === bank.id" @click="changeBankStatus(bank, 'ARCHIVED')">Arsipkan</button><button v-else class="btn-quiet" type="button" :disabled="bankActionBusy === bank.id" @click="changeBankStatus(bank, 'ACTIVE')">Pulihkan</button><button class="btn-quiet danger-action" type="button" :disabled="bankActionBusy === bank.id" @click="deleteQuestionBank(bank)">Hapus</button></div></article></div><p v-else class="muted">Belum ada bank soal. Klik “Buat bank” untuk membuat yang pertama.</p></section>
  <section v-if="showImportForm" class="card import-panel" aria-labelledby="question-import-title">
    <div class="between"><div><h2 id="question-import-title">Import soal CSV atau TXT</h2><p class="muted">Soal valid dibuat sebagai draft. Server tidak menyimpan file setelah preview.</p></div><button class="btn-quiet" type="button" @click="showImportForm = false">Tutup</button></div>
    <div class="form-grid import-fields">
      <label>Bank tujuan<select v-model="questionImportBankId" :disabled="questionImportBusy" required @change="resetQuestionImportPreview"><option value="" disabled>Pilih bank soal</option><option v-for="bank in activeBanks" :key="bank.id" :value="bank.id">{{ bank.name }} · {{ bankSubjectLabel(bank.subjectId) }}</option></select></label>
      <label>File CSV atau TXT<input type="file" accept=".csv,.txt,text/csv,text/plain" :disabled="questionImportBusy" @change="readQuestionImportFile" /><small class="muted">Maksimal 300 soal atau 1 MiB. Kunci menerima BENAR/SALAH, TRUE/FALSE, atau 1/0.</small></label>
    </div>
    <details class="import-help"><summary>Petunjuk format CSV dan TXT</summary><ul><li>Template berisi satu contoh untuk setiap tipe; hapus contoh sebelum menggantinya dengan soal Anda.</li><li><strong>TXT memakai blok soal</strong>: awali setiap soal dengan <code>Soal1</code>, lalu tulis satu field per baris dalam bentuk <code>nama_field</code>, tab, lalu isi. Teks soal boleh memuat koma.</li><li><strong>SINGLE_CHOICE</strong> dan <strong>MULTIPLE_RESPONSE</strong> memakai <code>prompt</code>, kolom <code>option_*</code>, dan <code>option_*_correct</code>.</li><li><strong>TRUE_FALSE</strong> hanya memakai <code>stimulus</code>, tiga kolom <code>statement_*</code>, dan kunci masing-masing pernyataan.</li></ul></details>
    <div class="import-actions"><button class="btn-quiet" type="button" @click="downloadQuestionImportTemplate('CSV')">Unduh template CSV</button><button class="btn-quiet" type="button" @click="downloadQuestionImportTextTemplate">Unduh template TXT</button><button class="btn-secondary" type="button" :disabled="questionImportBusy || !questionImportCsv || !questionImportBankId" @click="previewQuestionImport">{{ questionImportBusy ? "Memproses…" : "Preview import" }}</button></div>
    <p v-if="questionImportFileName" class="muted small-copy">File: {{ questionImportFileName }} · {{ questionImportFormat }}</p><p v-if="questionImportMessage" class="alert alert-info" aria-live="polite">{{ questionImportMessage }}</p>
    <template v-if="questionImportPreview"><div class="import-summary"><span>Total {{ questionImportPreview.totalRows }}</span><span>Valid {{ questionImportPreview.validCount }}</span><span :class="{ 'text-danger': questionImportPreview.errorCount > 0 }">Error {{ questionImportPreview.errorCount }}</span></div><div class="table-scroll import-preview-table"><table><caption class="sr-only">Preview import soal</caption><thead><tr><th>Baris</th><th>Tipe</th><th>Ringkasan</th><th>Status</th><th>Detail</th></tr></thead><tbody><tr v-for="row in questionImportPreview.rows" :key="row.rowNumber"><td>{{ row.rowNumber }}</td><td>{{ row.type ?? "—" }}</td><td>{{ row.label ?? "—" }}</td><td><span class="badge" :class="row.status === 'VALID' ? 'badge-success' : 'badge-warning'">{{ row.status === 'VALID' ? 'Valid' : 'Error' }}</span></td><td><span v-if="row.errors.length === 0">—</span><span v-for="item in row.errors" :key="`${item.field}-${item.code}`" class="import-error">{{ item.field }}: {{ item.message }}</span></td></tr></tbody></table></div><div class="import-actions"><button class="btn-primary" type="button" :disabled="questionImportBusy || questionImportPreview.errorCount > 0" @click="commitQuestionImport">Import {{ questionImportPreview.validCount }} soal</button></div></template>
  </section>
  <ScopeSwitcher :dirty="dirty" />
  <div class="toolbar"><form class="search-form" @submit.prevent="searchQuestions"><label class="sr-only" for="question-search">Cari soal</label><input id="question-search" v-model="query" placeholder="Cari stimulus, bank, atau tipe" /><button class="btn-secondary" type="submit">Cari</button></form><span class="muted">Halaman {{ questionPage }} · {{ items.length }} item</span></div>
  <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
  <section class="card table-card"><div v-if="loading" class="table-state">Memuat bank soal…</div><div v-else-if="items.length === 0" class="table-state"><strong>Belum ada soal</strong><span class="muted">Buat draft pertama dari tombol di atas.</span></div><template v-else><div class="bulk-actions" aria-label="Aksi massal soal"><strong>{{ selectedQuestions.length }} dipilih</strong><button class="btn-quiet danger-action" type="button" :disabled="selectedQuestions.length === 0 || questionActionsBusy" @click="changeSelectedQuestionStatuses('ARCHIVED')">Arsipkan terpilih</button><button class="btn-quiet" type="button" :disabled="selectedQuestions.length === 0 || questionActionsBusy" @click="changeSelectedQuestionStatuses('ACTIVE')">Pulihkan terpilih</button><button v-if="selectedQuestionsCanBeDeleted" class="btn-quiet danger-action" type="button" :disabled="questionActionsBusy" @click="deleteSelectedQuestions">Hapus terpilih</button></div><p v-if="bulkNotice" class="alert alert-info" role="status">{{ bulkNotice }}</p><div class="table-scroll"><table><caption class="sr-only">Daftar soal</caption><thead><tr><th scope="col"><input type="checkbox" :checked="allQuestionsSelected" :disabled="questionActionsBusy" aria-label="Pilih semua soal pada halaman ini" @change="toggleAllQuestions" /></th><th>Preview</th><th>Tipe</th><th>Revision</th><th>Ketersediaan</th><th>Updated</th><th>Aksi</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td><input v-model="selectedQuestionIds" type="checkbox" :value="item.questionId" :disabled="questionActionsBusy" :aria-label="`Pilih soal ${safeHtmlPreview(item.label) || item.questionId}`" /></td><td><strong>{{ item.bankName }}</strong><small>{{ safeHtmlPreview(item.label) }}</small></td><td>{{ item.type }}</td><td><span class="badge" :class="item.status === 'PUBLISHED' ? 'badge-success' : 'badge-warning'">{{ item.status }}</span></td><td><span class="badge" :class="item.questionStatus === 'ACTIVE' ? 'badge-success' : 'badge-warning'">{{ item.questionStatus === 'ACTIVE' ? 'Aktif' : 'Arsip' }}</span></td><td>{{ item.updatedAt }}</td><td><div class="question-actions"><button class="btn-quiet" type="button" :disabled="questionActionsBusy" @click="open(item)">Buka editor</button><button v-if="item.questionStatus === 'ACTIVE'" class="btn-quiet danger-action" type="button" :disabled="questionActionsBusy" @click="changeQuestionStatus(item, 'ARCHIVED')">Arsipkan</button><button v-else class="btn-quiet" type="button" :disabled="questionActionsBusy" @click="changeQuestionStatus(item, 'ACTIVE')">Pulihkan</button><button v-if="item.canPermanentlyDelete" class="btn-quiet danger-action" type="button" :disabled="questionActionsBusy" @click="deleteQuestion(item)">Hapus</button></div></td></tr></tbody></table></div><nav class="pagination" aria-label="Halaman daftar soal"><button class="btn-quiet" type="button" :disabled="questionPage === 1 || loading" @click="goToPreviousQuestionPage">Sebelumnya</button><span>Halaman {{ questionPage }}</span><button class="btn-quiet" type="button" :disabled="!nextQuestionCursor || loading" @click="goToNextQuestionPage">Berikutnya</button></nav></template></section>
  <section class="card orphan-media-panel" aria-labelledby="orphan-media-title"><div class="between"><div><h2 id="orphan-media-title">Gambar tidak terpakai</h2><p class="muted">Asset yang belum dipasang pada draft dapat dihapus manual; housekeeping juga membersihkan asset lebih dari tujuh hari.</p></div><button class="btn-quiet" type="button" :disabled="orphanMediaBusy" @click="loadOrphanMedia">Muat ulang</button></div><p v-if="orphanMediaMessage" class="alert alert-info" role="status">{{ orphanMediaMessage }}</p><div v-if="orphanMedia.length" class="orphan-media-list"><article v-for="asset in orphanMedia" :key="asset.id" class="orphan-media-item"><img :src="asset.url" :alt="asset.originalName" loading="lazy" /><div><strong>{{ asset.originalName }}</strong><small class="muted">{{ asset.width }} × {{ asset.height }} · {{ Math.ceil(asset.byteSize / 1024) }} KiB</small><button class="btn-quiet danger-action" type="button" :disabled="orphanMediaBusy" @click="deleteOrphanMedia(asset)">Hapus asset</button></div></article></div><p v-else class="muted">Tidak ada asset orphan.</p></section>
  <div v-if="selected" class="overlay" role="dialog" aria-modal="true" aria-labelledby="question-editor-title"><section class="drawer"><div class="between"><div><p class="eyebrow">{{ selected.status }}</p><h2 id="question-editor-title">Editor soal</h2></div><div class="stack"><button class="btn-secondary" type="button" @click="previewOpen = true">Pratinjau</button><button class="btn-quiet" type="button" @click="close">Tutup</button></div></div><p v-if="publishMessage" class="alert alert-info" role="status">{{ publishMessage }}</p><form @submit.prevent="save"><div v-if="selected.id === 'new'" class="form-row"><label for="question-bank-id">Bank soal</label><select id="question-bank-id" v-model="form.questionBankId" required><option value="" disabled>Pilih bank soal</option><option v-for="bank in activeBanks" :key="bank.id" :value="bank.id">{{ bank.name }} · {{ bankSubjectLabel(bank.subjectId) }}</option></select><small v-if="activeBanks.length === 0" class="muted">Buat bank soal terlebih dahulu.</small></div><div class="form-row"><label for="question-type">Tipe soal</label><select id="question-type" v-model="form.type"><option value="SINGLE_CHOICE">Single choice · exact match</option><option value="MULTIPLE_RESPONSE">Multiple response · semua tepat</option><option value="TRUE_FALSE">True/False · tiga pernyataan</option></select></div><div class="form-row"><RichContentEditor v-model="form.stimulusHtml" label="Stimulus" placeholder="Tulis stimulus, diagram, atau konteks soal…" :media="mediaFor('STIMULUS')" :media-busy="mediaBusy" :media-limit-reached="mediaLimitReached()" :media-disabled="mediaIsDisabled('STIMULUS')" :media-disabled-reason="mediaUnavailableReason('STIMULUS')" :media-notice="mediaNoticeFor('STIMULUS')" @add-media="(input) => attachRichMedia('STIMULUS', undefined, input)" @remove-media="(media) => removeMedia(media)" @update-media="(media, input) => updateMediaDetails(media, input)" /></div><div v-if="form.type !== 'TRUE_FALSE'" class="form-row"><RichContentEditor v-model="form.promptHtml" label="Pertanyaan/soal" placeholder="Tulis pertanyaan…" :media="mediaFor('PROMPT')" :media-busy="mediaBusy" :media-limit-reached="mediaLimitReached()" :media-disabled="mediaIsDisabled('PROMPT')" :media-disabled-reason="mediaUnavailableReason('PROMPT')" :media-notice="mediaNoticeFor('PROMPT')" @add-media="(input) => attachRichMedia('PROMPT', undefined, input)" @remove-media="(media) => removeMedia(media)" @update-media="(media, input) => updateMediaDetails(media, input)" /></div><div v-if="form.type !== 'TRUE_FALSE'" class="child-editor"><div class="between"><h3>Opsi jawaban</h3><button class="btn-quiet" type="button" @click="addOption">Tambah opsi</button></div><div v-for="(option, index) in form.options" :key="index" class="child-row"><RichContentEditor v-model="option.contentHtml" :label="`Isi opsi ${index + 1}`" :media="mediaFor('OPTION', option.id)" :media-busy="mediaBusy" :media-limit-reached="mediaLimitReached()" :media-disabled="mediaIsDisabled('OPTION', option.id, index)" :media-disabled-reason="mediaUnavailableReason('OPTION', option.id, index)" :media-notice="mediaNoticeFor('OPTION', option.id)" @add-media="(input) => attachRichMedia('OPTION', option.id, input, index)" @remove-media="(media) => removeMedia(media)" @update-media="(media, input) => updateMediaDetails(media, input)" /><label><input v-model="option.isCorrect" type="checkbox" /> benar</label></div><p class="muted small-copy">Single choice harus tepat satu benar; multiple response minimal satu dan semua key harus tepat.</p></div><div v-else class="child-editor"><div class="between"><h3>Tiga pernyataan</h3><button class="btn-quiet" type="button" @click="addStatement">Tambah</button></div><div v-for="(statement, index) in form.statements" :key="index" class="child-row"><RichContentEditor v-model="statement.statementHtml" :label="`Pernyataan ${index + 1}`" :media="mediaFor('STATEMENT', statement.id)" :media-busy="mediaBusy" :media-limit-reached="mediaLimitReached()" :media-disabled="mediaIsDisabled('STATEMENT', statement.id, index)" :media-disabled-reason="mediaUnavailableReason('STATEMENT', statement.id, index)" :media-notice="mediaNoticeFor('STATEMENT', statement.id)" @add-media="(input) => attachRichMedia('STATEMENT', statement.id, input, index)" @remove-media="(media) => removeMedia(media)" @update-media="(media, input) => updateMediaDetails(media, input)" /><select v-model="statement.correctValue" :aria-label="`Jawaban pernyataan ${index + 1}`"><option :value="true">Benar</option><option :value="false">Salah</option></select></div></div><div class="form-row"><RichContentEditor v-model="form.explanationHtml" label="Pembahasan (opsional)" placeholder="Tulis pembahasan…" :media="mediaFor('EXPLANATION')" :media-busy="mediaBusy" :media-limit-reached="mediaLimitReached()" :media-disabled="mediaIsDisabled('EXPLANATION')" :media-disabled-reason="mediaUnavailableReason('EXPLANATION')" :media-notice="mediaNoticeFor('EXPLANATION')" @add-media="(input) => attachRichMedia('EXPLANATION', undefined, input)" @remove-media="(media) => removeMedia(media)" @update-media="(media, input) => updateMediaDetails(media, input)" /></div>
      <p class="muted small-copy media-total-hint">{{ selected.media?.length ?? 0 }}/3 gambar terpasang. Tambahkan gambar melalui tombol “🖼 Gambar” di masing-masing field; draft internal disiapkan otomatis bila diperlukan.</p>
      <div v-if="report" class="readiness" :class="report.isReady ? 'ready' : 'blocked'"><strong>{{ report.isReady ? 'Siap disimpan' : 'Belum dapat disimpan' }}</strong><ul><li v-for="issue in report.issues" :key="`${issue.fieldPath}-${issue.message}`">{{ issue.severity }} · {{ issue.message }} <button v-if="issue.fieldPath" class="link-button" type="button">Buka field</button></li></ul></div><div class="editor-actions"><button class="btn-primary" type="submit" :disabled="saving">{{ saving ? 'Menyimpan…' : 'Simpan' }}</button></div></form></section></div>
      <div v-if="previewOpen && selected" class="overlay preview-overlay" role="dialog" aria-modal="true" aria-labelledby="question-preview-title"><section class="preview-card" :class="`preview-${previewViewport}`"><div class="between"><h2 id="question-preview-title">Pratinjau soal</h2><button class="btn-quiet" type="button" @click="previewOpen = false">Tutup</button></div><div class="preview-viewport-switch" role="group" aria-label="Ukuran pratinjau"><button type="button" class="btn-quiet" :class="{ active: previewViewport === 'phone' }" @click="previewViewport = 'phone'">360 px</button><button type="button" class="btn-quiet" :class="{ active: previewViewport === 'tablet' }" @click="previewViewport = 'tablet'">768 px</button><button type="button" class="btn-quiet" :class="{ active: previewViewport === 'desktop' }" @click="previewViewport = 'desktop'">Desktop</button></div><SafeQuestionContent :html="form.stimulusHtml" :media="selected.media?.filter((media) => media.usage === 'STIMULUS')" /><SafeQuestionContent v-if="form.type !== 'TRUE_FALSE'" :html="form.promptHtml" :media="selected.media?.filter((media) => media.usage === 'PROMPT')" /><div v-if="form.type !== 'TRUE_FALSE'" class="preview-options"><div v-for="(option, index) in form.options" :key="index" class="preview-option"><strong>{{ String.fromCharCode(65 + index) }}.</strong><SafeQuestionContent :html="option.contentHtml" :media="previewOptionMedia(index)" /></div></div><div v-else class="preview-options"><div v-for="(statement, index) in form.statements" :key="index" class="preview-option"><strong>{{ index + 1 }}.</strong><SafeQuestionContent :html="statement.statementHtml" :media="previewStatementMedia(index)" /></div></div><SafeQuestionContent :html="form.explanationHtml" :media="selected.media?.filter((media) => media.usage === 'EXPLANATION')" /></section></div>
</template>

<style scoped>
.page-heading { align-items: flex-start; margin-bottom: 18px; }.page-heading h1 { margin: 0 0 6px; }.eyebrow { margin: 0 0 4px; color: var(--primary); font-weight: 700; }.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 16px 0; }.search-form { display: flex; gap: 8px; }.search-form input { min-height: 40px; min-width: min(360px, 55vw); }.table-card, .import-panel, .bank-list-panel, .orphan-media-panel { padding: 20px; }.bank-list-panel, .orphan-media-panel { margin-bottom: 18px; }.bank-list-panel h2, .orphan-media-panel h2 { margin: 0 0 6px; }.bank-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; margin-top: 14px; }.bank-item { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }.bank-item small, .orphan-media-item small { color: var(--subtle); }.bank-item-heading { align-items: center; gap: 8px; }.bank-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }.bank-edit-form { display: grid; gap: 8px; margin-top: 4px; }.bank-edit-form label { display: grid; gap: 6px; }.bank-edit-form input { min-height: 40px; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 10px; color: var(--text); background: var(--surface); }.danger-action { color: var(--danger); }.orphan-media-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 14px; }.orphan-media-item { display: grid; grid-template-columns: 72px 1fr; gap: 10px; align-items: center; padding: 10px; border: 1px solid var(--border); border-radius: 8px; }.orphan-media-item img { width: 72px; height: 72px; object-fit: contain; border-radius: 6px; background: var(--canvas); }.orphan-media-item div { display: grid; gap: 4px; min-width: 0; }.orphan-media-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.import-panel { margin-bottom: 18px; }.import-panel h2 { margin: 0 0 6px; }.import-fields { margin-top: 18px; }.import-fields label { display: grid; gap: 6px; }.import-fields select, .import-fields input { width: 100%; min-height: 40px; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 10px; color: var(--text); background: var(--surface); }.import-help { margin-top: 16px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); }.import-help summary { color: var(--text); cursor: pointer; font-weight: 700; }.import-help ul { margin: 10px 0 0; padding-left: 20px; }.import-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }.import-summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }.import-summary span { padding: 8px 10px; border-radius: 8px; background: var(--canvas); font-size: .86rem; }.import-preview-table { margin-top: 16px; }.import-error { display: block; margin-bottom: 4px; color: var(--danger); font-size: .85rem; }.text-danger { color: var(--danger); }.table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; } th { color: var(--muted); font-size: .8rem; } td small { display: block; color: var(--subtle); margin-top: 4px; }.table-state { display: grid; gap: 6px; justify-items: center; padding: 42px 12px; }.badge { display: inline-flex; padding: 4px 8px; border-radius: 99px; background: var(--primary-soft); color: var(--primary); font-size: .78rem; font-weight: 700; }.badge-success { color: var(--success); background: var(--success-soft); }.badge-warning { color: var(--warning); background: var(--warning-soft); }.overlay { position: fixed; inset: 0; z-index: 20; display: flex; justify-content: flex-end; background: rgb(2 6 23 / 45%); }.drawer { width: min(960px, 100%); height: 100%; overflow: auto; padding: 24px; background: var(--surface); box-shadow: var(--shadow); }.form-row textarea, .form-row select { width: 100%; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px 10px; color: var(--text); background: var(--surface); }.child-editor { margin: 16px 0; padding: 14px; border: 1px solid var(--border); border-radius: 10px; }.child-editor h3 { margin: 0; }.child-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; margin: 10px 0; }.child-row input:not([type='checkbox']), .child-row select { min-height: 40px; width: 100%; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px; background: var(--surface); color: var(--text); }.readiness { margin: 16px 0; padding: 12px; border-radius: 8px; }.readiness.ready { color: var(--success); background: var(--success-soft); }.readiness.blocked { color: var(--danger); background: var(--danger-soft); }.readiness ul { margin-bottom: 0; padding-left: 20px; }.link-button { border: 0; min-height: auto; padding: 0; color: inherit; background: transparent; text-decoration: underline; }.editor-actions { display: flex; flex-wrap: wrap; gap: 8px; }.small-copy { font-size: .84rem; }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.orphan-media-panel { margin-top: 18px; }
.question-actions, .bulk-actions, .pagination { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }.bulk-actions { margin-bottom: 14px; }.bulk-actions strong { margin-right: auto; }.pagination { justify-content: flex-end; margin-top: 16px; }.pagination span { color: var(--muted); font-size: .9rem; }
.media-total-hint { margin: 0 0 12px; }.checkbox-label { display: flex !important; grid-template-columns: auto 1fr; align-items: center; gap: 6px !important; }.preview-overlay { align-items: flex-start; justify-content: center; overflow: auto; padding: 28px 16px; }.preview-card { width: min(100%, 1000px); min-height: 80vh; padding: 22px; border-radius: 12px; background: var(--surface); box-shadow: var(--shadow); transition: width 160ms ease; }.preview-card.preview-phone { width: min(100%, 360px); }.preview-card.preview-tablet { width: min(100%, 768px); }.preview-viewport-switch { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 18px; }.preview-viewport-switch .active { color: var(--primary); border-color: var(--primary); background: var(--primary-soft); }.preview-options { display: grid; gap: 8px; margin: 14px 0; }.preview-option { display: grid; grid-template-columns: auto 1fr; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; }
@media (max-width: 600px) { .page-heading, .toolbar { display: grid; align-items: stretch; }.search-form input { min-width: 0; flex: 1; } .drawer { padding: 18px 14px; } }
</style>
