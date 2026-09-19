import {
    ProductsStorageService,
    type WarehouseProduct,
} from "@services/ProductsStorageService";
import { WarehouseAiContextService } from "@services/WarehouseAiContextService";
import { type ToastInput } from "@hooks/useToasts";
import { createUuid, type IdFactory } from "@utils/functions/idFactory";
import { type ChatTimelineMessage } from "../types";
import {
    type KeyboardEvent,
    type RefObject,
    useEffect,
    useRef,
    useState,
} from "react";

const productsStorage = new ProductsStorageService();
const warehouseAiContextService = new WarehouseAiContextService();

const createChatMessage = (
    idFactory: IdFactory,
    role: ChatTimelineMessage["role"],
    content: string,
    status: ChatTimelineMessage["status"] = "complete",
): ChatTimelineMessage => {
    return {
        id: idFactory(),
        role,
        content,
        status,
    };
};

interface UseWarehouseChatOptions {
    products: WarehouseProduct[];
    showToast: (toast: ToastInput) => void;
    idFactory?: IdFactory;
}

interface UseWarehouseChatResult {
    question: string;
    chatMessages: ChatTimelineMessage[];
    isAiLoading: boolean;
    chatFeedRef: RefObject<HTMLDivElement | null>;
    setQuestion: (value: string) => void;
    askAi: () => Promise<void>;
    resetAiSession: () => void;
    handleQuestionKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export const useWarehouseChat = ({
    products,
    showToast,
    idFactory = createUuid,
}: UseWarehouseChatOptions): UseWarehouseChatResult => {
    const [question, setQuestion] = useState<string>("");
    const [chatMessages, setChatMessages] = useState<ChatTimelineMessage[]>([]);
    const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
    const chatFeedRef = useRef<HTMLDivElement | null>(null);
    const activeRequest = useRef<{
        id: number;
        controller: AbortController;
    } | null>(null);
    const requestId = useRef(0);

    const askAi = async (): Promise<void> => {
        const trimmedQuestion = question.trim();

        if (!trimmedQuestion || isAiLoading || activeRequest.current) {
            return;
        }

        if (products.length === 0) {
            return;
        }

        const { products: cachedProducts } =
            productsStorage.getProductsFromStorage();
        const availableProducts =
            cachedProducts.length > 0 ? cachedProducts : products;

        if (availableProducts.length === 0) {
            showToast({
                type: "error",
                title: "Каталог недоступен",
                message: "Нет локальных товаров для ответа склада.",
            });

            setChatMessages((currentMessages) => [
                ...currentMessages,
                createChatMessage(idFactory, "error", "Каталог пуст"),
            ]);

            return;
        }

        const userMessage = createChatMessage(
            idFactory,
            "user",
            trimmedQuestion,
        );
        const pendingMessage = createChatMessage(
            idFactory,
            "assistant",
            "Ищу товары в локальном контексте и готовлю ответ...",
            "pending",
        );
        const controller = new AbortController();
        const currentRequestId = ++requestId.current;
        activeRequest.current = {
            id: currentRequestId,
            controller,
        };
        const isCurrent = (): boolean =>
            activeRequest.current?.id === currentRequestId
            && !controller.signal.aborted;

        try {
            setIsAiLoading(true);
            setQuestion("");

            setChatMessages((currentMessages) => [
                ...currentMessages,
                userMessage,
                pendingMessage,
            ]);

            warehouseAiContextService.updateProducts(availableProducts);

            const answer = await warehouseAiContextService.ask(
                trimmedQuestion,
                controller.signal,
            );

            if (!isCurrent()) return;

            setChatMessages((currentMessages) =>
                currentMessages.map((message) =>
                    message.id === pendingMessage.id
                        ? {
                              ...message,
                              content: answer,
                              status: "complete",
                          }
                        : message,
                ),
            );

            showToast({
                type: "success",
                title: "Ответ готов",
                message: "Складской AI добавил ответ в историю чата.",
            });
        } catch (error) {
            if (!isCurrent()) return;
            console.error("Ошибка Ollama:", error);

            const errorMessage =
                error instanceof Error
                    ? error.message
                    : "Неизвестная ошибка Ollama";

            setChatMessages((currentMessages) =>
                currentMessages.map((message) =>
                    message.id === pendingMessage.id
                        ? {
                              ...message,
                              role: "error",
                              content: errorMessage,
                              status: "complete",
                          }
                        : message,
                ),
            );

            showToast({
                type: "error",
                title: "Ollama не ответила",
                message: errorMessage,
                durationMs: 6500,
            });
        } finally {
            if (isCurrent()) {
                activeRequest.current = null;
                setIsAiLoading(false);
            }
        }
    };

    const resetAiSession = (): void => {
        const hadChatHistory = chatMessages.length > 0;

        requestId.current++;
        activeRequest.current?.controller.abort();
        activeRequest.current = null;
        warehouseAiContextService.resetSession();
        setQuestion("");
        setChatMessages([]);
        setIsAiLoading(false);

        if (hadChatHistory) {
            showToast({
                type: "info",
                title: "Новый диалог",
                message: "История чата очищена, контекст разговора сброшен.",
            });
        }
    };

    const handleQuestionKeyDown = (
        event: KeyboardEvent<HTMLInputElement>,
    ): void => {
        if (
            event.key === "Enter" &&
            !isAiLoading &&
            products.length > 0 &&
            question.trim()
        ) {
            void askAi();
        }
    };

    useEffect(() => {
        const activeRequestRef = activeRequest;
        const requestIdRef = requestId;

        return (): void => {
            requestIdRef.current++;
            activeRequestRef.current?.controller.abort();
            activeRequestRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (products.length === 0) {
            return;
        }

        warehouseAiContextService.updateProducts(products);
    }, [products]);

    useEffect(() => {
        const chatFeed = chatFeedRef.current;

        if (!chatFeed) {
            return;
        }

        chatFeed.scrollTop = chatFeed.scrollHeight;
    }, [chatMessages]);

    return {
        question,
        chatMessages,
        isAiLoading,
        chatFeedRef,
        setQuestion,
        askAi,
        resetAiSession,
        handleQuestionKeyDown,
    };
};
