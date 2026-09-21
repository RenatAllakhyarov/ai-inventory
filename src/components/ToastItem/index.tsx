import { DEFAULT_TOAST_DURATION_MS } from "@utils/constants";
import { useEffect, type ReactElement } from "react";
import CloseIcon from "../CloseIcon";
import { type ToastMessage, type ToastType } from "../../types";
import "./style.css";

interface IToastItemProps {
    toast: ToastMessage;
    onDismiss: (id: string) => void;
}

const getToastRole = (type: ToastMessage["type"]): "alert" | "status" => {
    return type === "error" ? "alert" : "status";
};

const TOAST_LABELS: Record<ToastType, string> = {
    success: "Успешно",
    error: "Ошибка",
    warning: "Внимание",
    info: "Информация",
    loading: "В процессе",
};

const ToastItem = ({ toast, onDismiss }: IToastItemProps): ReactElement => {
    useEffect(() => {
        if (toast.type === "loading") {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            onDismiss(toast.id);
        }, toast.durationMs ?? DEFAULT_TOAST_DURATION_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [onDismiss, toast.durationMs, toast.id, toast.type]);

    return (
        <article
            className={`toast toast--${toast.type}`}
            role={getToastRole(toast.type)}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
            <div className="toast-content">
                {toast.type === "loading" && (
                    <span className="toast-loader" aria-hidden="true" />
                )}
                <div className="toast-copy">
                    <span className="toast-kicker">
                        {toast.title ?? TOAST_LABELS[toast.type]}
                    </span>
                    <p className="toast-message">{toast.message}</p>
                </div>
            </div>
            <button
                type="button"
                className="toast-close-button"
                onClick={() => {
                    onDismiss(toast.id);
                }}
                aria-label="Закрыть уведомление"
            >
                <CloseIcon />
            </button>
        </article>
    );
};

export default ToastItem;
