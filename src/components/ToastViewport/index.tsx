import ToastItem from "@components/ToastItem";
import { ToastMessage } from "../../types";
import { type ReactElement } from "react";
import "./style.css";

interface IToastViewportProps {
    messages: ToastMessage[];
    onDismiss: (id: string) => void;
}

const ToastViewport = ({
    messages,
    onDismiss,
}: IToastViewportProps): ReactElement | null => {
    if (messages.length === 0) {
        return null;
    }

    return (
        <section className="toast-viewport" aria-label="Уведомления приложения">
            {messages.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
            ))}
        </section>
    );
};

export default ToastViewport;
