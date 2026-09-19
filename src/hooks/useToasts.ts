import { type ToastMessage } from "../types";
import { useCallback, useState } from "react";

export type ToastInput = Omit<ToastMessage, "id">;

let toastMessageCounter = 0;

const createToastMessage = (toast: ToastInput): ToastMessage => {
    toastMessageCounter += 1;

    return {
        ...toast,
        id: `toast-${Date.now()}-${toastMessageCounter}`,
    };
};

interface UseToastsResult {
    messages: ToastMessage[];
    dismissToast: (id: string) => void;
    showToast: (toast: ToastInput) => void;
}

export const useToasts = (): UseToastsResult => {
    const [messages, setMessages] = useState<ToastMessage[]>([]);

    const dismissToast = useCallback((id: string): void => {
        setMessages((currentMessages) =>
            currentMessages.filter((message) => message.id !== id),
        );
    }, []);

    const showToast = useCallback((toast: ToastInput): void => {
        setMessages((currentMessages) => {
            const duplicateToast = currentMessages.some(
                (message) =>
                    message.type === toast.type &&
                    message.title === toast.title &&
                    message.message === toast.message,
            );

            if (duplicateToast) {
                return currentMessages;
            }

            return [...currentMessages, createToastMessage(toast)].slice(-4);
        });
    }, []);

    return {
        messages,
        dismissToast,
        showToast,
    };
};
