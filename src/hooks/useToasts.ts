import { createUuid, type IdFactory } from "@utils/functions/idFactory";
import { type ToastMessage } from "../types";
import { useCallback, useState } from "react";

export type ToastInput = Omit<ToastMessage, "id">;

const createToastMessage = (
    idFactory: IdFactory,
    toast: ToastInput,
): ToastMessage => {

    return {
        ...toast,
        id: idFactory(),
    };
};

interface UseToastsOptions {
    idFactory?: IdFactory;
}

interface UseToastsResult {
    messages: ToastMessage[];
    dismissToast: (id: string) => void;
    showToast: (toast: ToastInput) => void;
}

export const useToasts = (
    { idFactory = createUuid }: UseToastsOptions = {},
): UseToastsResult => {
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

            return [
                ...currentMessages,
                createToastMessage(idFactory, toast),
            ].slice(-4);
        });
    }, [idFactory]);

    return {
        messages,
        dismissToast,
        showToast,
    };
};
