import {
    type ReactElement,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import "./style.css";

import {
    checkMoySkladConnection,
    fetchWarehouseApi,
} from "@api/MoySkladApi";
import {
    OLLAMA_CHAT_MODEL,
} from "@api/OllamaApi";
import {
    ProductsStorageService,
    type WarehouseProduct,
} from "@services/ProductsStorageService";
import ToastViewport from "./Toast";
import { WarehouseAiContextService } from "@services/WarehouseAiContextService";
import { WarehouseIdbStorageService } from "@services/WarehouseIdbStorageService";
import {
    WarehouseProvider,
    type WarehouseSearchResult,
} from "@services/WarehouseProvider";
import { type ToastMessage } from "../../types";

interface WarehouseProductsResponse {
    rows?: WarehouseProduct[];
}

interface ChatTimelineMessage {
    id: string;
    role: "user" | "assistant" | "error";
    content: string;
    status?: "pending" | "complete";
}

let chatMessageCounter = 0;
let toastMessageCounter = 0;

const createChatMessage = (
    role: ChatTimelineMessage["role"],
    content: string,
    status: ChatTimelineMessage["status"] = "complete",
): ChatTimelineMessage => {
    chatMessageCounter += 1;

    return {
        id: `${Date.now()}-${chatMessageCounter}`,
        role,
        content,
        status,
    };
};

const createToastMessage = (
    toast: Omit<ToastMessage, "id">,
): ToastMessage => {
    toastMessageCounter += 1;

    return {
        ...toast,
        id: `toast-${Date.now()}-${toastMessageCounter}`,
    };
};

const getChatMessageLabel = (
    message: ChatTimelineMessage,
): string => {
    if (message.role === "user") {
        return "Ты";
    }

    if (message.role === "error") {
        return "Ошибка";
    }

    if (message.status === "pending") {
        return "Склад думает";
    }

    return "Ответ склада";
};

const getPrice = (product: WarehouseProduct): string => {
    const [firstSalePrice] = product.salePrices ?? [];

    if (typeof firstSalePrice?.value !== "number") {
        return "нет";
    }

    return `${firstSalePrice.value / 100}`;
};

const getStock = (product: WarehouseProduct): string => {
    if (typeof product.stock !== "number") {
        return "нет";
    }

    return String(product.stock);
};

const productsStorage = new ProductsStorageService();
const warehouseProvider = new WarehouseProvider();
const warehouseIdbStorageService =
    new WarehouseIdbStorageService();
const warehouseAiContextService =
    new WarehouseAiContextService();

const createEmptySearchResult = (): WarehouseSearchResult => ({
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
});

const App = (): ReactElement => {
    const [isConnected, setIsConnected] =
        useState<boolean | null>(null);

    const [products, setProducts] =
        useState<WarehouseProduct[]>([]);

    const [isCatalogLoading, setIsCatalogLoading] =
        useState<boolean>(true);

    const [searchResult, setSearchResult] =
        useState<WarehouseSearchResult>(
            createEmptySearchResult,
        );

    const [searchQuery, setSearchQuery] =
        useState<string>("");

    const [selectedCategory, setSelectedCategory] =
        useState<string>("");

    const [showInStockOnly, setShowInStockOnly] =
        useState<boolean>(false);

    const [question, setQuestion] =
        useState<string>("");

    const [chatMessages, setChatMessages] =
        useState<ChatTimelineMessage[]>([]);

    const [isAiLoading, setIsAiLoading] =
        useState<boolean>(false);

    const [toastMessages, setToastMessages] =
        useState<ToastMessage[]>([]);

    const chatFeedRef =
        useRef<HTMLDivElement | null>(null);

    const dismissToast = useCallback((
        id: string,
    ): void => {
        setToastMessages((currentMessages) =>
            currentMessages.filter((message) => message.id !== id),
        );
    }, []);

    const showToast = useCallback((
        toast: Omit<ToastMessage, "id">,
    ): void => {
        setToastMessages((currentMessages) => {
            const duplicateToast =
                currentMessages.some((message) =>
                    message.type === toast.type &&
                    message.title === toast.title &&
                    message.message === toast.message,
                );

            if (duplicateToast) {
                return currentMessages;
            }

            return [
                ...currentMessages,
                createToastMessage(toast),
            ].slice(-4);
        });
    }, []);

    const productsWithStock =
        products.filter((product) =>
            typeof product.stock === "number" &&
            product.stock > 0,
        );

    const outOfStockCount =
        products.filter((product) => product.stock === 0).length;

    const archivedCount =
        products.filter((product) => product.archived).length;

    const categoryCount =
        new Set(
            products
                .map((product) => product.pathName)
                .filter((category): category is string => Boolean(category)),
        ).size;

    const categoryOptions =
        Array.from(
            new Set(
                products
                    .map((product) => product.pathName)
                    .filter((category): category is string => Boolean(category)),
            ),
        ).sort((left, right) =>
            left.localeCompare(
                right,
                "ru",
                {
                    sensitivity: "base",
                },
            ),
        );

    const visibleProducts =
        searchResult.items;

    const connectionLabel =
        isConnected === null
            ? "Проверка"
            : isConnected
                ? "Подключено"
                : "Нет связи";

    const connectionTone =
        isConnected === null
            ? "pending"
            : isConnected
                ? "good"
                : "danger";

    const catalogLabel =
        isCatalogLoading
            ? "Загрузка"
            : products.length > 0
            ? `${products.length} товаров`
            : "Каталог пуст";

    const aiContextLabel =
        isCatalogLoading
            ? "Готовим локальный каталог"
            : products.length > 0
            ? "Локальный каталог готов"
            : "Нет данных для ответа";

    const hasChatMessages =
        chatMessages.length > 0;

    const getProducts = async (): Promise<WarehouseProduct[]> => {
        const data =
            await fetchWarehouseApi<WarehouseProductsResponse>(
                "/entity/product?limit=1000",
            );

        console.log(
            "ROWS:",
            data.rows?.length ?? 0,
        );

        return data.rows ?? [];
    };

    const askAi = async (): Promise<void> => {
        const trimmedQuestion = question.trim();

        if (
            !trimmedQuestion ||
            isAiLoading
        ) {
            return;
        }

        if (products.length === 0) {
            return;
        }

        const cachedProducts =
            productsStorage.getProductsFromStorage();
        const availableProducts =
            cachedProducts.length > 0
                ? cachedProducts
                : products;

        if (availableProducts.length === 0) {
            showToast({
                type: "error",
                title: "Каталог недоступен",
                message: "Нет локальных товаров для ответа склада.",
            });

            setChatMessages((currentMessages) => [
                ...currentMessages,
                createChatMessage(
                    "error",
                    "Каталог пуст",
                ),
            ]);

            return;
        }

        const userMessage =
            createChatMessage(
                "user",
                trimmedQuestion,
            );
        const pendingMessage =
            createChatMessage(
                "assistant",
                "Ищу товары в локальном контексте и готовлю ответ...",
                "pending",
            );

        try {
            setIsAiLoading(true);
            setQuestion("");
            setChatMessages((currentMessages) => [
                ...currentMessages,
                userMessage,
                pendingMessage,
            ]);

            warehouseAiContextService.updateProducts(
                availableProducts,
            );

            const answer =
                await warehouseAiContextService.ask(
                    trimmedQuestion,
                );

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
            console.error(
                "Ошибка Ollama:",
                error,
            );

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
            setIsAiLoading(false);
        }
    };

    const resetAiSession = (): void => {
        const hadChatHistory =
            chatMessages.length > 0;

        warehouseAiContextService.resetSession();
        setQuestion("");
        setChatMessages([]);

        if (hadChatHistory) {
            showToast({
                type: "info",
                title: "Новый диалог",
                message: "История чата очищена, контекст разговора сброшен.",
            });
        }
    };

    const handleKeyDown = (
        event: React.KeyboardEvent<HTMLInputElement>,
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
        const chatFeed =
            chatFeedRef.current;

        if (!chatFeed) {
            return;
        }

        chatFeed.scrollTop =
            chatFeed.scrollHeight;
    }, [chatMessages]);

    useEffect(() => {
        const searchProducts = async (): Promise<void> => {
            try {
                const result =
                    await warehouseProvider.searchProductsFromStorage(
                        {
                            query: searchQuery,
                            category: selectedCategory || undefined,
                            inStockOnly: showInStockOnly || undefined,
                            sortBy: searchQuery.trim()
                                ? "relevance"
                                : "name",
                            sortDirection: "asc",
                        },
                        products,
                    );

                setSearchResult(
                    result,
                );
            } catch (error) {
                console.warn(
                    "Warehouse search failed:",
                    error,
                );

                showToast({
                    type: "warning",
                    title: "Поиск работает через память",
                    message: "Локальный индекс недоступен, но каталог остается на экране.",
                });

                setSearchResult(
                    warehouseProvider.searchProducts(
                        products,
                        {
                            query: searchQuery,
                            category: selectedCategory || undefined,
                            inStockOnly: showInStockOnly || undefined,
                            sortBy: searchQuery.trim()
                                ? "relevance"
                                : "name",
                            sortDirection: "asc",
                        },
                    ),
                );
            }
        };

        void searchProducts();
    }, [
        products,
        searchQuery,
        selectedCategory,
        showInStockOnly,
        showToast,
    ]);

    useEffect(() => {
        const loadProducts = async (): Promise<void> => {
            try {
                const savedProducts =
                    productsStorage.getProductsFromStorage();

                if (savedProducts.length > 0) {
                    console.log(
                        "Берем каталог из localStorage",
                    );

                    setProducts(
                        savedProducts,
                    );

                    warehouseAiContextService.updateProducts(
                        savedProducts,
                    );

                    showToast({
                        type: "info",
                        title: "Каталог загружен",
                        message: `Взяли ${savedProducts.length} товаров из localStorage.`,
                    });

                    try {
                        await warehouseIdbStorageService.replaceProducts(
                            savedProducts,
                        );
                    } catch (error) {
                        console.warn(
                            "IndexedDB hydration fallback:",
                            error,
                        );

                        showToast({
                            type: "warning",
                            title: "IndexedDB недоступен",
                            message: "Каталог открыт из localStorage, индекс пересоберем позже.",
                        });
                    }

                    return;
                }

                try {
                    const idbProducts =
                        await warehouseIdbStorageService.getProducts();

                    if (idbProducts.length > 0) {
                        console.log(
                            "Берем каталог из IndexedDB",
                        );

                        productsStorage.saveProductsToStorage(
                            idbProducts,
                        );

                        setProducts(
                            idbProducts,
                        );

                        warehouseAiContextService.updateProducts(
                            idbProducts,
                        );

                        showToast({
                            type: "success",
                            title: "Каталог загружен",
                            message: `Взяли ${idbProducts.length} товаров из IndexedDB.`,
                        });

                        return;
                    }
                } catch (error) {
                    console.warn(
                        "IndexedDB load fallback:",
                        error,
                    );

                    showToast({
                        type: "warning",
                        title: "IndexedDB недоступен",
                        message: "Пробуем загрузить свежий каталог из МоегоСклада.",
                    });
                }

                console.log(
                    "localStorage пустой, загружаем МойСклад",
                );

                const data =
                    await getProducts();

                productsStorage.saveProductsToStorage(
                    data,
                );

                showToast({
                    type: "success",
                    title: "Каталог загружен",
                    message: `Получили ${data.length} товаров из МоегоСклада.`,
                });

                try {
                    await warehouseIdbStorageService.replaceProducts(
                        data,
                    );
                } catch (error) {
                        console.warn(
                            "IndexedDB sync fallback:",
                            error,
                        );

                        showToast({
                            type: "warning",
                            title: "Индекс не обновлен",
                            message: "Каталог загружен, но IndexedDB временно недоступен.",
                        });
                    }

                setProducts(
                    data,
                );

                warehouseAiContextService.updateProducts(
                    data,
                );
            } catch (error) {
                console.error(
                    "Ошибка загрузки товаров:",
                    error,
                );

                showToast({
                    type: "error",
                    title: "Каталог не загрузился",
                    message: error instanceof Error
                        ? error.message
                        : "Неизвестная ошибка загрузки склада.",
                    durationMs: 6500,
                });
            } finally {
                setIsCatalogLoading(false);
            }
        };

        void loadProducts();
    }, [showToast]);

    useEffect(() => {
        const checkConnection =
            async (): Promise<void> => {
                const result =
                    await checkMoySkladConnection();

                setIsConnected(
                    result,
                );

                console.log(
                    "MoySklad connection:",
                    result,
                );

                showToast({
                    type: result ? "success" : "error",
                    title: result ? "МойСклад подключен" : "Нет связи с МойСкладом",
                    message: result
                        ? "API склада доступен."
                        : "Показываем локальные данные, если они есть.",
                    durationMs: result ? 3200 : 6500,
                });
            };

        void checkConnection();
    }, [showToast]);

    useEffect(() => {
        if (products.length === 0) {
            return;
        }

        const syncProducts = async (): Promise<void> => {
            try {
                const freshProducts =
                    await getProducts();

                const oldProducts =
                    productsStorage.getProductsFromStorage();

                const changed =
                    productsStorage.compareProducts(
                        oldProducts,
                        freshProducts,
                    );

                if (changed) {
                    productsStorage.saveProductsToStorage(
                        freshProducts,
                    );

                    try {
                        await warehouseIdbStorageService.replaceProducts(
                            freshProducts,
                        );
                    } catch (error) {
                        console.warn(
                            "IndexedDB periodic sync fallback:",
                            error,
                        );

                        showToast({
                            type: "warning",
                            title: "Индекс не обновлен",
                            message: "Свежий каталог сохранен локально, но IndexedDB временно недоступен.",
                        });
                    }

                    setProducts(
                        freshProducts,
                    );

                    warehouseAiContextService.updateProducts(
                        freshProducts,
                    );

                    showToast({
                        type: "success",
                        title: "Каталог обновлен",
                        message: `Синхронизация нашла ${freshProducts.length} товаров.`,
                    });
                }
            } catch (error) {
                console.error(
                    "Ошибка синхронизации товаров:",
                    error,
                );

                showToast({
                    type: "error",
                    title: "Синхронизация не удалась",
                    message: error instanceof Error
                        ? error.message
                        : "Не удалось обновить складовой каталог.",
                    durationMs: 6500,
                });
            }
        };

        const intervalId = window.setInterval(
            () => {
                void syncProducts();
            },
            5 * 60 * 1000,
        );

        return () => {
            window.clearInterval(intervalId);
        };
    }, [
        products.length,
        showToast,
    ]);

    return (
        <main className="warehouse-shell">
            <section className="signal-rail" aria-label="Статус склада">
                <div className="brand-block">
                    <span className="brand-kicker">
                        AI Inventory
                    </span>

                    <h1>
                        Складской пульт
                    </h1>
                </div>

                <div className="signal-grid">
                    <div className={`signal-cell signal-cell--${connectionTone}`}>
                        <span className="signal-label">
                            МойСклад
                        </span>

                        <strong>
                            {connectionLabel}
                        </strong>
                    </div>

                    <div className="signal-cell">
                        <span className="signal-label">
                            Каталог
                        </span>

                        <strong>
                            {catalogLabel}
                        </strong>
                    </div>

                    <div className={`signal-cell ${products.length > 0 ? "signal-cell--good" : "signal-cell--pending"}`}>
                        <span className="signal-label">
                            AI контекст
                        </span>

                        <strong>
                            {aiContextLabel}
                        </strong>
                    </div>

                    <div className="signal-cell">
                        <span className="signal-label">
                            Синхронизация
                        </span>

                        <strong>
                            5 минут
                        </strong>
                    </div>
                </div>
            </section>

            <section className="workspace-grid">
                <div className="inventory-workspace">
                    <header className="section-header">
                        <div>
                            <span className="section-eyebrow">
                                Каталог товаров
                            </span>

                            <h2>
                                Остатки и карточки
                            </h2>
                        </div>

                        <span className="section-count">
                            {searchResult.total}
                            /
                            {products.length}
                            {" "}
                            позиций
                        </span>
                    </header>

                    <div className="summary-grid" aria-label="Сводка склада">
                        <div className="summary-item">
                            <span>
                                Всего
                            </span>

                            <strong>
                                {products.length}
                            </strong>
                        </div>

                        <div className="summary-item">
                            <span>
                                С остатком
                            </span>

                            <strong>
                                {productsWithStock.length}
                            </strong>
                        </div>

                        <div className="summary-item summary-item--warn">
                            <span>
                                Нулевой остаток
                            </span>

                            <strong>
                                {outOfStockCount}
                            </strong>
                        </div>

                        <div className="summary-item">
                            <span>
                                Категории
                            </span>

                            <strong>
                                {categoryCount}
                            </strong>
                        </div>

                        <div className="summary-item">
                            <span>
                                Архив
                            </span>

                            <strong>
                                {archivedCount}
                            </strong>
                        </div>
                    </div>

                    <div className="filter-bar" aria-label="Параметры поиска товаров">
                        <label className="filter-field filter-field--wide">
                            <span>
                                Поиск
                            </span>

                            <input
                                type="search"
                                value={searchQuery}
                                onChange={(event) => {
                                    setSearchQuery(
                                        event.target.value,
                                    );
                                }}
                                placeholder="Название, артикул, код или штрихкод"
                            />
                        </label>

                        <label className="filter-field">
                            <span>
                                Категория
                            </span>

                            <select
                                value={selectedCategory}
                                onChange={(event) => {
                                    setSelectedCategory(
                                        event.target.value,
                                    );
                                }}
                            >
                                <option value="">
                                    Все категории
                                </option>

                                {
                                    categoryOptions.map((category) => (
                                        <option
                                            key={category}
                                            value={category}
                                        >
                                            {category}
                                        </option>
                                    ))
                                }
                            </select>
                        </label>

                        <label className="stock-toggle">
                            <input
                                type="checkbox"
                                checked={showInStockOnly}
                                onChange={(event) => {
                                    setShowInStockOnly(
                                        event.target.checked,
                                    );
                                }}
                            />

                            <span>
                                Только с остатком
                            </span>
                        </label>
                    </div>

                    <div className="product-table" aria-label="Товары склада">
                        <div className="product-row product-row--head">
                            <span>
                                Товар
                            </span>

                            <span>
                                Остаток
                            </span>

                            <span>
                                Цена
                            </span>

                            <span>
                                Категория
                            </span>
                        </div>

                        {
                            isCatalogLoading &&
                            <div className="empty-state empty-state--loading">
                                <strong>
                                    Загружаем каталог
                                </strong>

                                <span>
                                    Проверяем локальные источники и МойСклад.
                                </span>
                            </div>
                        }

                        {
                            !isCatalogLoading &&
                            products.length === 0 &&
                            <div className="empty-state">
                                <strong>
                                    Каталог пока не загружен
                                </strong>

                                <span>
                                    Когда появятся данные из МоегоСклада или localStorage,
                                    здесь будет рабочий список товаров.
                                </span>
                            </div>
                        }

                        {
                            products.length > 0 &&
                            visibleProducts.length === 0 &&
                            <div className="empty-state">
                                <strong>
                                    По фильтрам ничего не найдено
                                </strong>

                                <span>
                                    Попробуй очистить поиск, выбрать другую категорию
                                    или показать товары без остатка.
                                </span>
                            </div>
                        }

                        {
                            visibleProducts.map((product) => (
                                <article
                                    className="product-row"
                                    key={product.id}
                                >
                                    <strong>
                                        {product.name ?? "Без названия"}
                                    </strong>

                                    <span>
                                        {getStock(product)}
                                    </span>

                                    <span>
                                        {getPrice(product)}
                                    </span>

                                    <span>
                                        {product.pathName ?? "нет"}
                                    </span>
                                </article>
                            ))
                        }
                    </div>
                </div>

                <aside className="chat-console" aria-label="Чат со складом">
                    <header className="section-header section-header--chat">
                        <div>
                            <span className="section-eyebrow">
                                Локальный AI
                            </span>

                            <h2>
                                Чат со складом
                            </h2>
                        </div>

                        <span className="model-chip">
                            {OLLAMA_CHAT_MODEL}
                        </span>
                    </header>

                    <div className="context-strip">
                        <span>
                            Источник ответов
                        </span>

                        <strong>
                            {
                                products.length > 0
                                    ? `${products.length} товаров из локального каталога`
                                    : "каталог недоступен"
                            }
                        </strong>
                    </div>

                    <div
                        className="chat-feed"
                        ref={chatFeedRef}
                    >
                        {
                            !hasChatMessages &&
                            <div className="chat-empty">
                                <strong>
                                    Спроси по остаткам, ценам или категориям
                                </strong>

                                <span>
                                    Ответ будет построен только на данных текущего каталога.
                                </span>
                            </div>
                        }

                        {
                            chatMessages.map((message) => (
                                <div
                                    className={[
                                        "chat-message",
                                        `chat-message--${message.role}`,
                                        message.status === "pending"
                                            ? "chat-message--pending"
                                            : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    key={message.id}
                                >
                                    <span>
                                        {getChatMessageLabel(message)}
                                    </span>

                                    <p>
                                        {message.content}
                                    </p>
                                </div>
                            ))
                        }
                    </div>

                    <div className="chat-controls">
                        <input
                            type="text"
                            value={question}
                            onChange={(event) => {
                                setQuestion(
                                    event.target.value,
                                );
                            }}
                            onKeyDown={handleKeyDown}
                            placeholder="Например: что закончилось?"
                            disabled={isAiLoading}
                        />

                        <div className="button-row">
                            <button
                                className="primary-action"
                                type="button"
                                onClick={() => void askAi()}
                                disabled={
                                    products.length === 0 ||
                                    isAiLoading ||
                                    !question.trim()
                                }
                            >
                                {
                                    isAiLoading
                                        ? "Отвечаю..."
                                        : "Спросить склад"
                                }
                            </button>

                            <button
                                className="secondary-action"
                                type="button"
                                onClick={resetAiSession}
                                disabled={isAiLoading}
                            >
                                Новый диалог
                            </button>
                        </div>
                    </div>
                </aside>
            </section>

            <ToastViewport
                messages={toastMessages}
                onDismiss={dismissToast}
            />
        </main>
    );
};

export default App;
