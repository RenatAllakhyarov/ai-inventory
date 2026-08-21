import { type ReactElement, useEffect, useRef, useState } from "react";

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
import { WarehouseAiContextService } from "@services/WarehouseAiContextService";
import { WarehouseProvider } from "@services/WarehouseProvider";

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
const warehouseAiContextService =
    new WarehouseAiContextService();

const App = (): ReactElement => {
    const [isConnected, setIsConnected] =
        useState<boolean | null>(null);

    const [products, setProducts] =
        useState<WarehouseProduct[]>([]);

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

    const chatFeedRef =
        useRef<HTMLDivElement | null>(null);

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

    const searchResult =
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
        products.length > 0
            ? `${products.length} товаров`
            : "Каталог пуст";

    const aiContextLabel =
        products.length > 0
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

        if (cachedProducts.length === 0) {
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
                cachedProducts,
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
        } finally {
            setIsAiLoading(false);
        }
    };

    const resetAiSession = (): void => {
        warehouseAiContextService.resetSession();
        setQuestion("");
        setChatMessages([]);
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

                    return;
                }

                console.log(
                    "localStorage пустой, загружаем МойСклад",
                );

                const data =
                    await getProducts();

                productsStorage.saveProductsToStorage(
                    data,
                );

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
            }
        };

        void loadProducts();
    }, []);

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
            };

        void checkConnection();
    }, []);

    useEffect(() => {
        if (products.length === 0) {
            return;
        }

        const syncProducts = async (): Promise<void> => {
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

                setProducts(
                    freshProducts,
                );

                warehouseAiContextService.updateProducts(
                    freshProducts,
                );
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
    }, [products.length]);

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
        </main>
    );
};

export default App;
