import { ref } from "vue";

/**
 * Satu-satunya jalur konfirmasi dan pemberitahuan di aplikasi.
 *
 * Menggantikan window.confirm/window.alert: dialog bawaan browser tidak
 * bisa distyling, tidak bisa menampilkan detail, dan tidak bisa diakses
 * lewat keyboard secara konsisten. Komponen ConfirmHost merender
 * permintaan ini sebagai dialog aplikasi (Escape, focus trap, dan
 * pengembalian fokus), dan toast sebagai pemberitahuan non-modal.
 *
 * Modul ini sengaja bebas DOM agar logikanya bisa diuji tanpa browser.
 */

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Tombol konfirmasi memakai gaya destruktif dan fokus awal jatuh ke Batal. */
  readonly danger?: boolean;
}

export interface ConfirmRequest
  extends Required<Pick<ConfirmOptions, "title" | "message">> {
  readonly id: number;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly danger: boolean;
  readonly resolve: (value: boolean) => void;
}

export type ToastTone = "success" | "info" | "error";

export interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

export const confirmRequest = ref<ConfirmRequest | null>(null);
export const toasts = ref<readonly ToastItem[]>([]);

let confirmSeq = 0;
let toastSeq = 0;

export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  // Jangan pernah menumpuk dua dialog: permintaan lama dibatalkan dulu.
  confirmRequest.value?.resolve(false);
  return new Promise<boolean>((resolve) => {
    confirmRequest.value = {
      id: ++confirmSeq,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? "Ya, lanjutkan",
      cancelLabel: options.cancelLabel ?? "Batal",
      danger: options.danger ?? false,
      resolve,
    };
  });
}

export function resolveConfirm(value: boolean): void {
  const request = confirmRequest.value;
  confirmRequest.value = null;
  request?.resolve(value);
}

export function showToast(
  message: string,
  tone: ToastTone = "success",
): number {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, message, tone }];
  return id;
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}
