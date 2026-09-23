export type ToastType = "success" | "error" | "warning" | "info" | "loading";

export interface ToastMessage {
    id: string;
    type: ToastType;
    message: string;
    title?: string;
    durationMs?: number;
}

export type ChatMessageRole = "user" | "assistant" | "error";

export type ChatMessageStatus = "pending" | "complete";

export interface ChatTimelineMessage {
    id: string;
    role: ChatMessageRole;
    content: string;
    status?: ChatMessageStatus;
}

export type ConnectionTone = "pending" | "good" | "danger";
