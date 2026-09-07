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

export interface WarehouseProductsResponse<TProduct> {
    rows?: TProduct[];
}

export interface MoySkladStockRow {
    stock?: number;
    reserve?: number;
    inTransit?: number;
    quantity?: number;

    assortment?: {
        meta?: {
            href?: string;
        };
        name?: string;
    };
}

export interface MoySkladStockResponse {
    rows?: MoySkladStockRow[];
}

export type ConnectionTone = "pending" | "good" | "danger";
