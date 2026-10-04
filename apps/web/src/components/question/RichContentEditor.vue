<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { Node, mergeAttributes } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { Mathematics } from "@tiptap/extension-mathematics";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Underline from "@tiptap/extension-underline";
import DOMPurify from "dompurify";

const props = withDefaults(
  defineProps<{
    readonly modelValue: string;
    readonly label?: string;
    readonly placeholder?: string;
    readonly disabled?: boolean;
  }>(),
  { label: "Konten", placeholder: "Tulis konten soal…", disabled: false },
);
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
const mathDialog = ref<"inline" | "block" | null>(null);
const latex = ref("");
const latexError = ref("");

const QuestionMediaPlaceholder = Node.create({
  name: "questionMediaPlaceholder",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      placementKey: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-media-placement"),
        renderHTML: (attributes: { placementKey?: string | null }) =>
          attributes.placementKey
            ? { "data-media-placement": attributes.placementKey }
            : {},
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure[data-content-node="question-media"]',
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(
        { "data-content-node": "question-media" },
        HTMLAttributes,
      ),
    ];
  },
});

const editor = useEditor({
  content: toEditorHtml(props.modelValue),
  editable: !props.disabled,
  extensions: [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Underline,
    Subscript,
    Superscript,
    QuestionMediaPlaceholder,
    Mathematics.configure({
      katexOptions: { throwOnError: false, trust: false, strict: "warn" },
    }),
  ],
  editorProps: {
    attributes: {
      class: "rich-editor-surface",
      role: "textbox",
      "aria-multiline": "true",
      "data-placeholder": props.placeholder,
    },
  },
  onUpdate({ editor: current }) {
    emit("update:modelValue", toCanonicalHtml(current.getHTML()));
  },
});

watch(
  () => props.modelValue,
  (value) => {
    if (!editor.value) return;
    const next = toEditorHtml(value);
    if (next !== editor.value.getHTML())
      editor.value.commands.setContent(next, { emitUpdate: false });
  },
);
watch(
  () => props.disabled,
  (disabled) => editor.value?.setEditable(!disabled),
);
onBeforeUnmount(() => editor.value?.destroy());

function toggleMark(mark: "bold" | "italic" | "underline" | "strike"): void {
  editor.value?.chain().focus().toggleMark(mark).run();
}
function toggleList(kind: "bulletList" | "orderedList"): void {
  const chain = editor.value?.chain().focus();
  if (!chain) return;
  if (kind === "bulletList") chain.toggleBulletList().run();
  else chain.toggleOrderedList().run();
}
function undo(): void {
  editor.value?.chain().focus().undo().run();
}
function redo(): void {
  editor.value?.chain().focus().redo().run();
}
function openMath(kind: "inline" | "block"): void {
  mathDialog.value = kind;
  latex.value = "";
  latexError.value = "";
}
function insertMath(): void {
  const value = latex.value.trim();
  if (!value || value.length > 2_000) {
    latexError.value = "LaTeX wajib diisi dan maksimal 2.000 karakter.";
    return;
  }
  const chain = editor.value?.chain().focus();
  if (!chain) return;
  if (mathDialog.value === "inline") chain.insertInlineMath({ latex: value }).run();
  else chain.insertBlockMath({ latex: value }).run();
  mathDialog.value = null;
}

function toCanonicalHtml(value: string): string {
  const sanitized = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h2",
      "h3",
      "strong",
      "em",
      "u",
      "s",
      "code",
      "sub",
      "sup",
      "span",
      "div",
      "figure",
    ],
    ALLOWED_ATTR: [
      "data-type",
      "data-latex",
      "data-content-node",
      "data-media-placement",
    ],
  });
  const documentValue = new DOMParser().parseFromString(sanitized, "text/html");
  documentValue.querySelectorAll('[data-type="inline-math"]').forEach((node) => {
    node.removeAttribute("data-type");
    node.setAttribute("data-content-node", "inline-math");
    node.textContent = "";
  });
  documentValue.querySelectorAll('[data-type="block-math"]').forEach((node) => {
    node.removeAttribute("data-type");
    node.setAttribute("data-content-node", "block-math");
    node.textContent = "";
  });
  documentValue.querySelectorAll("[data-latex]").forEach((node) => {
    node.setAttribute("data-latex", node.getAttribute("data-latex") ?? "");
  });
  return documentValue.body.innerHTML;
}

function toEditorHtml(value: string): string {
  const documentValue = new DOMParser().parseFromString(value || "<p></p>", "text/html");
  documentValue.querySelectorAll('[data-content-node="inline-math"]').forEach((node) => {
    node.removeAttribute("data-content-node");
    node.setAttribute("data-type", "inline-math");
  });
  documentValue.querySelectorAll('[data-content-node="block-math"]').forEach((node) => {
    node.removeAttribute("data-content-node");
    node.setAttribute("data-type", "block-math");
  });
  return documentValue.body.innerHTML || "<p></p>";
}
</script>

<template>
  <div class="rich-editor" :class="{ disabled }">
    <div class="rich-editor-toolbar" role="toolbar" :aria-label="`${label} formatting`">
      <button type="button" class="btn-quiet" :disabled="disabled" title="Urungkan" @click="undo">↶</button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Ulangi" @click="redo">↷</button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Tebal" @click="toggleMark('bold')"><strong>B</strong></button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Miring" @click="toggleMark('italic')"><em>I</em></button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Garis bawah" @click="toggleMark('underline')"><u>U</u></button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Superscript" @click="editor?.chain().focus().toggleSuperscript().run()">x²</button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Subscript" @click="editor?.chain().focus().toggleSubscript().run()">x₂</button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Daftar" @click="toggleList('bulletList')">• List</button>
      <button type="button" class="btn-quiet" :disabled="disabled" title="Daftar bernomor" @click="toggleList('orderedList')">1. List</button>
      <button type="button" class="btn-quiet" :disabled="disabled" @click="openMath('inline')">ƒx LaTeX</button>
      <button type="button" class="btn-quiet" :disabled="disabled" @click="openMath('block')">∑ LaTeX blok</button>
    </div>
    <label class="sr-only">{{ label }}</label>
    <EditorContent v-if="editor" :editor="editor" />
    <div v-if="mathDialog" class="math-dialog" role="dialog" aria-modal="true" aria-label="Sisipkan LaTeX">
      <label>LaTeX {{ mathDialog === 'inline' ? 'inline' : 'blok' }}<textarea v-model="latex" rows="3" maxlength="2000" placeholder="Contoh: x^2 + y^2 = z^2" @keyup.ctrl.enter="insertMath" /></label>
      <p v-if="latexError" class="form-error">{{ latexError }}</p>
      <div class="stack"><button type="button" class="btn-primary" @click="insertMath">Sisipkan</button><button type="button" class="btn-quiet" @click="mathDialog = null">Batal</button></div>
    </div>
  </div>
</template>

<style scoped>
.rich-editor { display: grid; gap: 6px; }.rich-editor-toolbar { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; border: 1px solid var(--border); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--canvas); }.rich-editor-toolbar button { min-height: 32px; }.rich-editor :deep(.rich-editor-surface) { min-height: 96px; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 0 0 8px 8px; outline: none; color: var(--text); background: var(--surface); }.rich-editor :deep(.rich-editor-surface p:first-child) { margin-top: 0; }.rich-editor :deep(.rich-editor-surface p:last-child) { margin-bottom: 0; }.rich-editor :deep(.rich-editor-surface:empty::before) { content: attr(data-placeholder); color: var(--subtle); pointer-events: none; }.math-dialog { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-elevated); }.math-dialog label { display: grid; gap: 6px; font-weight: 600; }.math-dialog textarea { width: 100%; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px; color: var(--text); background: var(--surface); }.disabled { opacity: .75; }
.rich-editor :deep(figure[data-content-node="question-media"]) { display: grid; place-items: center; min-height: 48px; margin: 10px 0; border: 1px dashed var(--primary); border-radius: 8px; color: var(--primary); background: var(--primary-soft); }
.rich-editor :deep(figure[data-content-node="question-media"]::before) { content: "Gambar terpasang — atur detail pada panel gambar"; font-size: .82rem; }
</style>
