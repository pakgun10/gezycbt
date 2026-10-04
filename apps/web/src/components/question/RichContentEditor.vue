<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { Mathematics } from "@tiptap/extension-mathematics";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Underline from "@tiptap/extension-underline";
import DOMPurify from "dompurify";
import type { MediaAlignment, QuestionMedia } from "../../features/staff/types";

type MediaUploadInput = {
  readonly file: File;
  readonly altText: string;
  readonly isDecorative: boolean;
  readonly displayWidthPercent: number;
  readonly alignment: MediaAlignment;
};

const props = withDefaults(
  defineProps<{
    readonly modelValue: string;
    readonly label?: string;
    readonly placeholder?: string;
    readonly disabled?: boolean;
    readonly media?: readonly QuestionMedia[];
    readonly mediaBusy?: boolean;
    readonly mediaDisabled?: boolean;
    readonly mediaLimitReached?: boolean;
    readonly mediaDisabledReason?: string;
    readonly mediaNotice?: string;
  }>(),
  {
    label: "Konten",
    placeholder: "Tulis konten soal…",
    disabled: false,
    media: () => [],
    mediaBusy: false,
    mediaDisabled: false,
    mediaLimitReached: false,
    mediaDisabledReason: "",
    mediaNotice: "",
  },
);
const emit = defineEmits<{
  (event: "update:modelValue", value: string): void;
  (event: "add-media", input: MediaUploadInput): void;
  (event: "remove-media", media: QuestionMedia): void;
  (
    event: "update-media",
    media: QuestionMedia,
    input: Record<string, unknown>,
  ): void;
}>();
const mathDialog = ref<"inline" | "block" | null>(null);
const latex = ref("");
const latexError = ref("");
const mediaDialog = ref(false);
const mediaFile = ref<File | null>(null);
const mediaAlt = ref("");
const mediaDecorative = ref(false);
const mediaWidth = ref(100);
const mediaAlignment = ref<MediaAlignment>("CENTER");
const mediaError = ref("");
const selectedMediaPlacementKey = ref<string | null>(null);
const selectedMediaItem = computed(() =>
  props.media.find(
    (item) => item.placementKey === selectedMediaPlacementKey.value,
  ),
);

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
      src: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.querySelector("img")?.getAttribute("src") ?? "",
        renderHTML: () => ({}),
      },
      alt: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.querySelector("img")?.getAttribute("alt") ?? "",
        renderHTML: () => ({}),
      },
      displayWidthPercent: {
        default: 100,
        parseHTML: (element: HTMLElement) =>
          normalizedMediaWidth(element.getAttribute("data-media-width")),
        renderHTML: () => ({}),
      },
      alignment: {
        default: "CENTER",
        parseHTML: (element: HTMLElement) =>
          normalizedMediaAlignment(element.getAttribute("data-media-align")),
        renderHTML: () => ({}),
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
  renderHTML({ node, HTMLAttributes }) {
    const width = normalizedMediaWidth(node.attrs.displayWidthPercent);
    const alignment = normalizedMediaAlignment(node.attrs.alignment);
    return [
      "figure",
      mergeAttributes(
        {
          "data-content-node": "question-media",
          "data-media-width": String(width),
          "data-media-align": alignment,
          style: mediaFigureStyle(width, alignment),
          title: "Klik gambar untuk mengatur gambar",
        },
        HTMLAttributes,
      ),
      [
        "img",
        {
          src: String(node.attrs.src ?? ""),
          alt: String(node.attrs.alt ?? ""),
          draggable: "false",
        },
      ],
    ];
  },
});

const editor = useEditor({
  content: toEditorHtml(props.modelValue, props.media),
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
      "aria-label": props.label,
      "data-placeholder": props.placeholder,
    },
    handleClickOn(view, _position, node, nodePosition) {
      if (node.type.name !== "questionMediaPlaceholder") return false;
      view.dispatch(
        view.state.tr.setSelection(
          NodeSelection.create(view.state.doc, nodePosition),
        ),
      );
      return true;
    },
  },
  onUpdate({ editor: current }) {
    emit("update:modelValue", toCanonicalHtml(current.getHTML()));
  },
  onSelectionUpdate({ editor: current }) {
    const selection = current.state.selection;
    selectedMediaPlacementKey.value =
      selection instanceof NodeSelection &&
      selection.node.type.name === "questionMediaPlaceholder"
        ? String(selection.node.attrs.placementKey ?? "") || null
        : null;
  },
});

watch(
  [() => props.modelValue, () => props.media],
  ([value, media]) => {
    if (!editor.value) return;
    const next = toEditorHtml(value, media);
    const selectedPlacementKey = selectedMediaPlacementKey.value;
    if (
      toCanonicalHtml(next) !== toCanonicalHtml(editor.value.getHTML()) ||
      !mediaPresentationMatches(editor.value.state.doc, media)
    ) {
      editor.value.commands.setContent(next, { emitUpdate: false });
      const position = selectedPlacementKey
        ? mediaNodePosition(editor.value.state.doc, selectedPlacementKey)
        : null;
      if (position !== null) editor.value.commands.setNodeSelection(position);
    }
    if (
      selectedPlacementKey &&
      !media.some(
        (item) => item.placementKey === selectedPlacementKey,
      )
    )
      selectedMediaPlacementKey.value = null;
  },
  { deep: true },
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

function toggleMediaDialog(): void {
  if (props.mediaDisabled || props.mediaBusy || props.disabled) return;
  mediaDialog.value = !mediaDialog.value;
  mediaError.value = "";
}

function readMediaFile(event: Event): void {
  mediaFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  mediaError.value = "";
}

function submitMedia(): void {
  if (!mediaFile.value) {
    mediaError.value = "Pilih file gambar terlebih dahulu.";
    return;
  }
  const altText = mediaAlt.value.trim();
  if (!mediaDecorative.value && !altText) {
    mediaError.value = "Alt text wajib diisi untuk gambar informatif.";
    return;
  }
  emit("add-media", {
    file: mediaFile.value,
    altText,
    isDecorative: mediaDecorative.value,
    displayWidthPercent: mediaWidth.value,
    alignment: mediaAlignment.value,
  });
  mediaFile.value = null;
  mediaAlt.value = "";
  mediaDecorative.value = false;
  mediaWidth.value = 100;
  mediaAlignment.value = "CENTER";
  mediaError.value = "";
  mediaDialog.value = false;
}

function updateMedia(
  media: QuestionMedia,
  input: Record<string, unknown>,
): void {
  emit("update-media", media, input);
}

function updateMediaAlt(media: QuestionMedia, event: Event): void {
  updateMedia(media, { altText: (event.target as HTMLInputElement).value });
}

function updateMediaWidth(media: QuestionMedia, event: Event): void {
  updateMedia(media, {
    displayWidthPercent: Number((event.target as HTMLInputElement).value),
  });
}

function updateMediaAlignment(media: QuestionMedia, event: Event): void {
  updateMedia(media, {
    alignment: (event.target as HTMLSelectElement).value,
  });
}

function updateMediaDecorative(media: QuestionMedia, event: Event): void {
  const isDecorative = (event.target as HTMLInputElement).checked;
  updateMedia(media, {
    isDecorative,
    altText: isDecorative ? null : media.altText ?? "",
  });
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

function toEditorHtml(
  value: string,
  media: readonly QuestionMedia[],
): string {
  const documentValue = new DOMParser().parseFromString(value || "<p></p>", "text/html");
  documentValue.querySelectorAll('[data-content-node="inline-math"]').forEach((node) => {
    node.removeAttribute("data-content-node");
    node.setAttribute("data-type", "inline-math");
  });
  documentValue.querySelectorAll('[data-content-node="block-math"]').forEach((node) => {
    node.removeAttribute("data-content-node");
    node.setAttribute("data-type", "block-math");
  });
  documentValue
    .querySelectorAll<HTMLElement>('[data-content-node="question-media"]')
    .forEach((node) => {
      const placementKey = node.getAttribute("data-media-placement") ?? "";
      const item = media.find(
        (candidate) => candidate.placementKey === placementKey,
      );
      if (!item) return;
      const width = normalizedMediaWidth(item.displayWidthPercent);
      const alignment = normalizedMediaAlignment(item.alignment);
      node.setAttribute("data-media-width", String(width));
      node.setAttribute("data-media-align", alignment);
      const image = documentValue.createElement("img");
      image.src = item.url;
      image.alt = item.isDecorative ? "" : item.altText ?? "";
      node.replaceChildren(image);
    });
  return documentValue.body.innerHTML || "<p></p>";
}

function normalizedMediaWidth(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 10 && parsed <= 100
    ? Math.round(parsed)
    : 100;
}

function normalizedMediaAlignment(value: unknown): MediaAlignment {
  return value === "LEFT" || value === "RIGHT" ? value : "CENTER";
}

function mediaFigureStyle(
  width: number,
  alignment: MediaAlignment,
): string {
  const marginLeft = alignment === "RIGHT" ? "auto" : "0";
  const marginRight = alignment === "LEFT" ? "auto" : "0";
  return `width:${width}%;margin-left:${marginLeft};margin-right:${marginRight}`;
}

function mediaPresentationMatches(
  documentValue: ProseMirrorNode,
  media: readonly QuestionMedia[],
): boolean {
  let matches = true;
  documentValue.descendants((node) => {
    if (node.type.name !== "questionMediaPlaceholder") return matches;
    const placementKey = String(node.attrs.placementKey ?? "");
    const item = media.find(
      (candidate) => candidate.placementKey === placementKey,
    );
    if (
      item &&
      (String(node.attrs.src ?? "") !== item.url ||
        String(node.attrs.alt ?? "") !==
          (item.isDecorative ? "" : item.altText ?? "") ||
        normalizedMediaWidth(node.attrs.displayWidthPercent) !==
          normalizedMediaWidth(item.displayWidthPercent) ||
        normalizedMediaAlignment(node.attrs.alignment) !==
          normalizedMediaAlignment(item.alignment))
    )
      matches = false;
    return matches;
  });
  return matches;
}

function mediaNodePosition(
  documentValue: ProseMirrorNode,
  placementKey: string,
): number | null {
  let result: number | null = null;
  documentValue.descendants((node, position) => {
    if (
      node.type.name === "questionMediaPlaceholder" &&
      node.attrs.placementKey === placementKey
    ) {
      result = position;
      return false;
    }
    return result === null;
  });
  return result;
}
</script>

<template>
  <div class="rich-editor" :class="{ disabled }">
    <div class="rich-editor-label">{{ label }}</div>
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
      <button
        type="button"
        class="btn-quiet media-trigger"
        :disabled="disabled || mediaDisabled || mediaLimitReached || mediaBusy"
        title="Tambahkan gambar ke field ini"
        @click="toggleMediaDialog"
      >
        🖼 Gambar
      </button>
    </div>
    <EditorContent v-if="editor" :editor="editor" />
    <div v-if="mathDialog" class="math-dialog" role="dialog" aria-modal="true" aria-label="Sisipkan LaTeX">
      <label>LaTeX {{ mathDialog === 'inline' ? 'inline' : 'blok' }}<textarea v-model="latex" rows="3" maxlength="2000" placeholder="Contoh: x^2 + y^2 = z^2" @keyup.ctrl.enter="insertMath" /></label>
      <p v-if="latexError" class="form-error">{{ latexError }}</p>
      <div class="stack"><button type="button" class="btn-primary" @click="insertMath">Sisipkan</button><button type="button" class="btn-quiet" @click="mathDialog = null">Batal</button></div>
    </div>
    <p v-if="mediaDisabledReason" class="media-help" role="status">{{ mediaDisabledReason }}</p>
    <div v-if="mediaDialog" class="media-dialog" role="group" :aria-label="`Tambahkan gambar ke ${label}`">
      <div class="media-dialog-heading">
        <strong>Tambahkan gambar ke {{ label }}</strong>
        <button type="button" class="btn-quiet" :disabled="mediaBusy" @click="mediaDialog = false">Tutup</button>
      </div>
      <label>File gambar<input type="file" accept="image/jpeg,image/png,image/webp" :disabled="mediaBusy" @change="readMediaFile" /></label>
      <div class="media-dialog-grid">
        <label>Alt text<input v-model="mediaAlt" maxlength="500" :disabled="mediaBusy || mediaDecorative" placeholder="Deskripsi gambar" /></label>
        <label>Lebar (%)<input v-model.number="mediaWidth" type="number" min="10" max="100" step="1" :disabled="mediaBusy" /></label>
        <label>Alignment<select v-model="mediaAlignment" :disabled="mediaBusy"><option value="LEFT">Kiri</option><option value="CENTER">Tengah</option><option value="RIGHT">Kanan</option></select></label>
        <label class="checkbox-label"><input v-model="mediaDecorative" type="checkbox" :disabled="mediaBusy" /> Gambar dekoratif</label>
      </div>
      <p v-if="mediaError" class="form-error" role="alert">{{ mediaError }}</p>
      <button type="button" class="btn-secondary" :disabled="mediaBusy || mediaDisabled || mediaLimitReached" @click="submitMedia">{{ mediaBusy ? "Mengunggah…" : "Unggah & pasang" }}</button>
    </div>
    <div v-if="selectedMediaItem" class="rich-media-list">
      <article :key="selectedMediaItem.placementKey ?? selectedMediaItem.mediaAssetId" class="rich-media-item">
        <img :src="selectedMediaItem.url" :alt="selectedMediaItem.isDecorative ? '' : selectedMediaItem.altText ?? ''" />
        <div class="rich-media-details">
          <strong>Gambar terpasang</strong>
          <label>Alt text<input :value="selectedMediaItem.altText ?? ''" :disabled="mediaBusy || mediaDisabled || selectedMediaItem.isDecorative" maxlength="500" @change="updateMediaAlt(selectedMediaItem, $event)" /></label>
          <div class="media-dialog-grid">
            <label>Lebar (%)<input :value="selectedMediaItem.displayWidthPercent ?? 100" type="number" min="10" max="100" step="1" :disabled="mediaBusy || mediaDisabled" @change="updateMediaWidth(selectedMediaItem, $event)" /></label>
            <label>Alignment<select :value="selectedMediaItem.alignment ?? 'CENTER'" :disabled="mediaBusy || mediaDisabled" @change="updateMediaAlignment(selectedMediaItem, $event)"><option value="LEFT">Kiri</option><option value="CENTER">Tengah</option><option value="RIGHT">Kanan</option></select></label>
          </div>
          <label class="checkbox-label"><input :checked="selectedMediaItem.isDecorative" type="checkbox" :disabled="mediaBusy || mediaDisabled" @change="updateMediaDecorative(selectedMediaItem, $event)" /> Gambar dekoratif</label>
          <button type="button" class="btn-quiet danger-action" :disabled="mediaBusy || mediaDisabled" @click="emit('remove-media', selectedMediaItem)">Hapus gambar</button>
        </div>
      </article>
    </div>
    <p v-if="mediaNotice" class="media-help" role="status">{{ mediaNotice }}</p>
  </div>
</template>

<style scoped>
.rich-editor { display: grid; gap: 6px; }.rich-editor-label { color: var(--text); font-weight: 700; }.rich-editor-toolbar { display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; border: 1px solid var(--border); border-bottom: 0; border-radius: 8px 8px 0 0; background: var(--canvas); }.rich-editor-toolbar button { min-height: 32px; }.rich-editor :deep(.rich-editor-surface) { min-height: 96px; overflow: auto; resize: vertical; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 0 0 8px 8px; outline: none; color: var(--text); background: var(--surface); }.rich-editor :deep(.rich-editor-surface p:first-child) { margin-top: 0; }.rich-editor :deep(.rich-editor-surface p:last-child) { margin-bottom: 0; }.rich-editor :deep(.rich-editor-surface:empty::before) { content: attr(data-placeholder); color: var(--subtle); pointer-events: none; }.math-dialog, .media-dialog { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-elevated); }.math-dialog label, .media-dialog label, .rich-media-details label { display: grid; gap: 6px; font-weight: 600; }.math-dialog textarea { width: 100%; min-height: 72px; resize: vertical; overflow: auto; border: 1px solid var(--border-strong); border-radius: 8px; padding: 8px; color: var(--text); background: var(--surface); }.media-trigger { color: var(--primary); }.media-dialog-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }.media-dialog-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.media-dialog input:not([type="checkbox"]), .media-dialog select, .rich-media-details input:not([type="checkbox"]), .rich-media-details select { min-height: 36px; box-sizing: border-box; border: 1px solid var(--border-strong); border-radius: 6px; padding: 6px 8px; color: var(--text); background: var(--surface); }.checkbox-label { display: flex !important; align-items: center; gap: 6px !important; }.rich-media-list { display: grid; gap: 8px; }.rich-media-item { display: grid; grid-template-columns: minmax(96px, 140px) 1fr; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-elevated); }.rich-media-item > img { width: 100%; max-height: 120px; object-fit: contain; border-radius: 6px; background: var(--canvas); }.rich-media-details { display: grid; gap: 7px; align-content: start; }.media-help { margin: 0; color: var(--muted); font-size: .82rem; }.disabled { opacity: .75; }
.rich-editor :deep(figure[data-content-node="question-media"]) { display: block; box-sizing: border-box; max-width: 100%; min-height: 48px; margin-top: 10px; margin-bottom: 10px; padding: 6px; border: 1px solid transparent; border-radius: 8px; cursor: pointer; background: var(--canvas); }
.rich-editor :deep(figure[data-content-node="question-media"] img) { display: block; width: 100%; height: auto; max-height: 420px; margin: 0; border-radius: 6px; object-fit: contain; }
.rich-editor :deep(figure[data-content-node="question-media"].ProseMirror-selectednode) { border-color: var(--primary); outline: 2px solid var(--primary-soft); }
@media (max-width: 600px) { .rich-media-item { grid-template-columns: 1fr; }.media-dialog-grid { grid-template-columns: 1fr; } }
</style>
