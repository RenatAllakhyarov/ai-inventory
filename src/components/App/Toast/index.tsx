import { useEffect, type ReactElement } from "react";

import "./style.css";

import { type ToastMessage } from "../../../types";

interface ToastViewportProps {
    messages: ToastMessage[];
    onDismiss: (id: string) => void;
}

interface ToastItemProps {
    toast: ToastMessage;
    onDismiss: (id: string) => void;
}

const DEFAULT_TOAST_DURATION_MS = 4200;

const getToastRole = (
    type: ToastMessage["type"],
): "alert" | "status" => {
    return type === "error"
        ? "alert"
        : "status";
};

const getToastLabel = (
    type: ToastMessage["type"],
): string => {
    if (type === "success") {
        return "Успешно";
    }

    if (type === "error") {
        return "Ошибка";
    }

    if (type === "warning") {
        return "Внимание";
    }

    if (type === "loading") {
        return "В процессе";
    }

    return "Информация";
};

const ToastItem = ({
    toast,
    onDismiss,
}: ToastItemProps): ReactElement => {
    useEffect(() => {
        if (toast.type === "loading") {
            return;
        }

        const timeoutId =
            window.setTimeout(
                () => {
                    onDismiss(toast.id);
                },
                toast.durationMs ?? DEFAULT_TOAST_DURATION_MS,
            );

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [
        onDismiss,
        toast.durationMs,
        toast.id,
        toast.type,
    ]);

    return (
        <article
            className={`toast toast--${toast.type}`}
            role={getToastRole(toast.type)}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
        >
            <div className="toast-content">
                {
                    toast.type === "loading" &&
                    <span className="toast-loader" aria-hidden="true" />
                }

                <div className="toast-copy">
                    <span className="toast-kicker">
                        {toast.title ?? getToastLabel(toast.type)}
                    </span>

                    <p className="toast-message">
                        {toast.message}
                    </p>
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
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                </svg>
            </button>
        </article>
    );
};

const ToastViewport = ({
    messages,
    onDismiss,
}: ToastViewportProps): ReactElement | null => {
    if (messages.length === 0) {
        return null;
    }

    return (
        <section
            className="toast-viewport"
            aria-label="Уведомления приложения"
        >
            {
                messages.map((toast) => (
                    <ToastItem
                        key={toast.id}
                        toast={toast}
                        onDismiss={onDismiss}
                    />
                ))
            }
        </section>
    );
};

export default ToastViewport;
