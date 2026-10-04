<script setup lang="ts">
import { computed } from "vue";
import DOMPurify from "dompurify";
import katex from "katex";

export interface RenderableQuestionMedia {
  readonly placementKey?: string;
  readonly usage: string;
  readonly questionOptionId?: string | null;
  readonly trueFalseStatementId?: string | null;
  readonly sortOrder?: number;
  readonly url: string;
  readonly altText: string | null;
  readonly isDecorative: boolean;
  readonly displayWidthPercent?: number;
  readonly alignment?: "LEFT" | "CENTER" | "RIGHT";
}

const props = withDefaults(
  defineProps<{
    readonly html: string | null;
    readonly media?: readonly RenderableQuestionMedia[];
  }>(),
  { html: "", media: () => [] },
);

const renderedHtml = computed(() => renderContent(props.html ?? "", props.media));

function renderContent(
  source: string,
  media: readonly RenderableQuestionMedia[],
): string {
  const clean = DOMPurify.sanitize(source, {
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
    ALLOWED_ATTR: ["data-content-node", "data-latex", "data-media-placement"],
  });
  const documentValue = new DOMParser().parseFromString(clean, "text/html");
  const used = new Set<string>();

  documentValue.querySelectorAll("[data-latex]").forEach((node) => {
    const latex = node.getAttribute("data-latex") ?? "";
    const displayMode = node.getAttribute("data-content-node") === "block-math";
    try {
      const wrapper = documentValue.createElement(displayMode ? "div" : "span");
      wrapper.innerHTML = katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        trust: false,
        strict: "warn",
        output: "html",
      });
      node.replaceWith(wrapper);
    } catch {
      node.textContent = displayMode ? "[LaTeX tidak valid]" : "[LaTeX error]";
      node.removeAttribute("data-latex");
      node.removeAttribute("data-content-node");
    }
  });

  documentValue.querySelectorAll("[data-media-placement]").forEach((node) => {
    const key = node.getAttribute("data-media-placement") ?? "";
    const item = media.find((candidate) => candidate.placementKey === key);
    if (!item) {
      node.remove();
      return;
    }
    used.add(key);
    node.replaceWith(createMediaFigure(documentValue, item));
  });

  const unplaced = media.filter(
    (item) => !item.placementKey || !used.has(item.placementKey),
  );
  for (const item of unplaced)
    documentValue.body.append(createMediaFigure(documentValue, item));

  return DOMPurify.sanitize(documentValue.body.innerHTML, {
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
      "img",
      "figcaption",
    ],
    ALLOWED_ATTR: [
      "src",
      "alt",
      "loading",
      "data-media-width",
      "data-media-align",
      "class",
      "style",
    ],
    ALLOW_DATA_ATTR: false,
  });
}

function createMediaFigure(
  documentValue: Document,
  item: RenderableQuestionMedia,
): HTMLElement {
  const figure = documentValue.createElement("figure");
  figure.className = "question-media";
  figure.dataset.mediaWidth = String(item.displayWidthPercent ?? 100);
  figure.dataset.mediaAlign = item.alignment ?? "CENTER";
  figure.style.width = `${item.displayWidthPercent ?? 100}%`;
  figure.style.marginLeft = item.alignment === "RIGHT" ? "auto" : "0";
  figure.style.marginRight = item.alignment === "LEFT" ? "auto" : "0";
  const image = documentValue.createElement("img");
  image.src = item.url;
  image.alt = item.isDecorative ? "" : item.altText ?? "";
  image.loading = "lazy";
  figure.append(image);
  return figure;
}
</script>

<template>
  <div class="safe-question-content" v-html="renderedHtml" />
</template>
