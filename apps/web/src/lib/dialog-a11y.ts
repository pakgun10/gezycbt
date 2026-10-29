import { nextTick, onBeforeUnmount, type Ref, watch } from "vue";

/**
 * Perilaku dialog yang selama ini hilang di semua drawer/modal aplikasi:
 * Escape menutup dialog, Tab berputar di dalam dialog, dan fokus kembali
 * ke elemen pemicu saat dialog ditutup.
 *
 * Dipakai per dialog (bukan global) supaya dua dialog yang terbuka
 * bersamaan — mis. drawer editor soal + pratinjau — tidak saling berebut
 * fokus: pemanggil yang menentukan dialog mana yang aktif saat itu.
 */

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ].filter((element) => !element.hasAttribute("disabled"));
}

export function useEscapeClose(
  active: Ref<boolean>,
  onClose: () => void,
): void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };
  const stop = watch(
    active,
    (value) => {
      if (value) document.addEventListener("keydown", handler);
      else document.removeEventListener("keydown", handler);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    document.removeEventListener("keydown", handler);
    stop();
  });
}

export function useFocusTrap(
  active: Ref<boolean>,
  container: Ref<HTMLElement | null>,
): void {
  let previous: Element | null = null;

  const handler = (event: KeyboardEvent): void => {
    if (event.key !== "Tab" || !container.value) return;
    const elements = focusableElements(container.value);
    if (elements.length === 0) {
      event.preventDefault();
      return;
    }
    const first = elements[0] as HTMLElement;
    const last = elements[elements.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const stop = watch(active, async (value) => {
    if (value) {
      previous = document.activeElement;
      await nextTick();
      const elements = container.value
        ? focusableElements(container.value)
        : [];
      if (elements.length > 0) (elements[0] as HTMLElement).focus();
      else container.value?.focus();
      document.addEventListener("keydown", handler);
    } else {
      document.removeEventListener("keydown", handler);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
      previous = null;
    }
  });
  onBeforeUnmount(() => {
    document.removeEventListener("keydown", handler);
    stop();
  });
}
