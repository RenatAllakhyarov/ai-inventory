export type ToastType =
    "success" |
    "error" |
    "warning" |
    "info" |
    "loading";

export interface ToastMessage {
    id: string;
    type: ToastType;
    message: string;
    title?: string;
    durationMs?: number;
}
