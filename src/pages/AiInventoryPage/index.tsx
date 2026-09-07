import SignalRail from "@components/SignalRail";
import ChatConsole from "@components/ChatConsole";
import ProductTable from "@components/ProductTable";
import WarehouseFilters from "@components/WarehouseFilters";
import InventorySummary from "@components/InventorySummary";
import { WarehouseIdbStorageService } from "@services/WarehouseIdbStorageService";
import { WarehouseAiContextService } from "@services/WarehouseAiContextService";
import { checkMoySkladConnection, fetchWarehouseApi } from "@api/MoySkladApi";
import { OLLAMA_CHAT_MODEL } from "@api/OllamaApi";
import {
    ProductsStorageService,
    type WarehouseProduct,
} from "@services/ProductsStorageService";
import {
    WarehouseProvider,
    type WarehouseSearchResult,
} from "@services/WarehouseProvider";
import {
    type ChatTimelineMessage,
    type ConnectionTone,
    type MoySkladStockResponse,
    type ToastMessage,
    type WarehouseProductsResponse,
} from "../../types";
import {
    type KeyboardEvent,
    type ReactElement,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import "./style.css";
import ToastViewport from "@components/ToastViewport";

let chatMessageCounter = 0;
let toastMessageCounter = 0;
const productsStorage = new ProductsStorageService();
const warehouseProvider = new WarehouseProvider();
const warehouseIdbStorageService = new WarehouseIdbStorageService();
const warehouseAiContextService = new WarehouseAiContextService();

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

const createToastMessage = (toast: Omit<ToastMessage, "id">): ToastMessage => {
    toastMessageCounter += 1;

    return {
        ...toast,
        id: `toast-${Date.now()}-${toastMessageCounter}`,
    };
};

const createEmptySearchResult = (): WarehouseSearchResult => ({
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
});

const getCategoryOptions = (products: WarehouseProduct[]): string[] => {
    const categories = products
        .map((product) => product.pathName)
        .filter((category): category is string => Boolean(category));

    return Array.from(new Set(categories)).sort((left, right) =>
        left.localeCompare(right, "ru", {
            sensitivity: "base",
        }),
    );
};

const getProductIdFromHref = (href?: string): string | undefined => {
    if (!href) {
        return undefined;
    }

    const cleanHref = href.split("?")[0].replace(/\/$/, "");

    const parts = cleanHref.split("/");

    return parts.at(-1);
};

const AiInventoryPage = (): ReactElement => {
    const [isConnected, setIsConnected] = useState<boolean | null>(null);

    const [products, setProducts] = useState<WarehouseProduct[]>([]);

    const [isCatalogLoading, setIsCatalogLoading] = useState<boolean>(true);

    const [searchResult, setSearchResult] = useState<WarehouseSearchResult>(
        createEmptySearchResult,
    );

    const [searchQuery, setSearchQuery] = useState<string>("");

    const [selectedCategory, setSelectedCategory] = useState<string>("");

    const [showInStockOnly, setShowInStockOnly] = useState<boolean>(false);

    const [question, setQuestion] = useState<string>("");

    const [chatMessages, setChatMessages] = useState<ChatTimelineMessage[]>([]);

    const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

    const [toastMessages, setToastMessages] = useState<ToastMessage[]>([]);

    const chatFeedRef = useRef<HTMLDivElement | null>(null);

    const dismissToast = useCallback((id: string): void => {
        setToastMessages((currentMessages) =>
            currentMessages.filter((message) => message.id !== id),
        );
    }, []);

    const showToast = useCallback((toast: Omit<ToastMessage, "id">): void => {
        setToastMessages((currentMessages) => {
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

    const productsWithStock = products.filter(
        (product) => typeof product.stock === "number" && product.stock > 0,
    );

    const outOfStockCount = products.filter(
        (product) => product.stock === 0,
    ).length;

    const archivedCount = products.filter((product) => product.archived).length;

    const categoryOptions = getCategoryOptions(products);

    const categoryCount = categoryOptions.length;

    const visibleProducts = searchResult.items;

    const connectionLabel =
        isConnected === null
            ? "Проверка"
            : isConnected
              ? "Подключено"
              : "Нет связи";

    const connectionTone: ConnectionTone =
        isConnected === null ? "pending" : isConnected ? "good" : "danger";

    const catalogLabel = isCatalogLoading
        ? "Загрузка"
        : products.length > 0
          ? `${products.length} товаров`
          : "Каталог пуст";

    const aiContextLabel = isCatalogLoading
        ? "Готовим локальный каталог"
        : products.length > 0
          ? "Локальный каталог готов"
          : "Нет данных для ответа";

    const getProducts = async (): Promise<WarehouseProduct[]> => {
        const [productsData, stockData] = await Promise.all([
            fetchWarehouseApi<WarehouseProductsResponse<WarehouseProduct>>(
                "/entity/product?limit=1000",
            ),

            fetchWarehouseApi<MoySkladStockResponse>(
                "/report/stock/all?limit=1000",
            ),
        ]);

        const productRows = productsData.rows ?? [];

        const stockRows = stockData.rows ?? [];

        const stockByProductId = new Map<string, number>();

        for (const stockRow of stockRows) {
            const productId = getProductIdFromHref(
                stockRow.assortment?.meta?.href,
            );

            if (!productId) {
                continue;
            }

            const stock =
                typeof stockRow.quantity === "number" ? stockRow.quantity : 0;

            stockByProductId.set(productId, stock);
        }

        const productsWithStock = productRows.map((product) => ({
            ...product,
            stock: stockByProductId.get(product.id) ?? 0,
        }));

        return productsWithStock;
    };

    const askAi = async (): Promise<void> => {
        const trimmedQuestion = question.trim();

        if (!trimmedQuestion || isAiLoading) {
            return;
        }

        if (products.length === 0) {
            return;
        }

        const cachedProducts = productsStorage.getProductsFromStorage();

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
                createChatMessage("error", "Каталог пуст"),
            ]);

            return;
        }

        const userMessage = createChatMessage("user", trimmedQuestion);

        const pendingMessage = createChatMessage(
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

            warehouseAiContextService.updateProducts(availableProducts);

            const answer = await warehouseAiContextService.ask(trimmedQuestion);

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
            setIsAiLoading(false);
        }
    };

    const resetAiSession = (): void => {
        const hadChatHistory = chatMessages.length > 0;

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
        const chatFeed = chatFeedRef.current;

        if (!chatFeed) {
            return;
        }

        chatFeed.scrollTop = chatFeed.scrollHeight;
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
                            sortBy: searchQuery.trim() ? "relevance" : "name",
                            sortDirection: "asc",
                        },
                        products,
                    );

                setSearchResult(result);
            } catch (error) {
                console.warn("Warehouse search failed:", error);

                showToast({
                    type: "warning",
                    title: "Поиск работает через память",
                    message:
                        "Локальный индекс недоступен, но каталог остается на экране.",
                });

                setSearchResult(
                    warehouseProvider.searchProducts(products, {
                        query: searchQuery,
                        category: selectedCategory || undefined,
                        inStockOnly: showInStockOnly || undefined,
                        sortBy: searchQuery.trim() ? "relevance" : "name",
                        sortDirection: "asc",
                    }),
                );
            }
        };

        void searchProducts();
    }, [products, searchQuery, selectedCategory, showInStockOnly, showToast]);

    useEffect(() => {
        const loadProducts = async (): Promise<void> => {
            try {
                const savedProducts = productsStorage.getProductsFromStorage();

                if (savedProducts.length > 0) {
                    console.log("Берем каталог из localStorage");

                    setProducts(savedProducts);

                    warehouseAiContextService.updateProducts(savedProducts);

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
                        console.warn("IndexedDB hydration fallback:", error);

                        showToast({
                            type: "warning",
                            title: "IndexedDB недоступен",
                            message:
                                "Каталог открыт из localStorage, индекс пересоберем позже.",
                        });
                    }

                    return;
                }

                try {
                    const idbProducts =
                        await warehouseIdbStorageService.getProducts();

                    if (idbProducts.length > 0) {
                        console.log("Берем каталог из IndexedDB");

                        productsStorage.saveProductsToStorage(idbProducts);

                        setProducts(idbProducts);

                        warehouseAiContextService.updateProducts(idbProducts);

                        showToast({
                            type: "success",
                            title: "Каталог загружен",
                            message: `Взяли ${idbProducts.length} товаров из IndexedDB.`,
                        });

                        return;
                    }
                } catch (error) {
                    console.warn("IndexedDB load fallback:", error);

                    showToast({
                        type: "warning",
                        title: "IndexedDB недоступен",
                        message:
                            "Пробуем загрузить свежий каталог из МоегоСклада.",
                    });
                }

                console.log("Локальный каталог пустой, загружаем МойСклад");

                const data = await getProducts();

                productsStorage.saveProductsToStorage(data);

                showToast({
                    type: "success",
                    title: "Каталог загружен",
                    message: `Получили ${data.length} товаров из МоегоСклада.`,
                });

                try {
                    await warehouseIdbStorageService.replaceProducts(data);
                } catch (error) {
                    console.warn("IndexedDB sync fallback:", error);

                    showToast({
                        type: "warning",
                        title: "Индекс не обновлен",
                        message:
                            "Каталог загружен, но IndexedDB временно недоступен.",
                    });
                }

                setProducts(data);

                warehouseAiContextService.updateProducts(data);
            } catch (error) {
                console.error("Ошибка загрузки товаров:", error);

                showToast({
                    type: "error",
                    title: "Каталог не загрузился",
                    message:
                        error instanceof Error
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
        const checkConnection = async (): Promise<void> => {
            const result = await checkMoySkladConnection();

            setIsConnected(result);

            console.log("MoySklad connection:", result);

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
                const freshProducts = await getProducts();

                const oldProducts = productsStorage.getProductsFromStorage();

                const changed = productsStorage.compareProducts(
                    oldProducts,
                    freshProducts,
                );

                if (changed) {
                    productsStorage.saveProductsToStorage(freshProducts);

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
                            message:
                                "Свежий каталог сохранен локально, но IndexedDB временно недоступен.",
                        });
                    }

                    setProducts(freshProducts);

                    warehouseAiContextService.updateProducts(freshProducts);

                    showToast({
                        type: "success",
                        title: "Каталог обновлен",
                        message: `Синхронизация нашла ${freshProducts.length} товаров.`,
                    });
                }
            } catch (error) {
                console.error("Ошибка синхронизации товаров:", error);

                showToast({
                    type: "error",
                    title: "Синхронизация не удалась",
                    message:
                        error instanceof Error
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
    }, [products.length, showToast]);

    return (
        <main className="warehouse-shell">
            <SignalRail
                connectionLabel={connectionLabel}
                connectionTone={connectionTone}
                catalogLabel={catalogLabel}
                aiContextLabel={aiContextLabel}
                hasProducts={products.length > 0}
            />
            <section className="workspace-grid">
                <div className="inventory-workspace">
                    <header className="section-header">
                        <div>
                            <span className="section-eyebrow">
                                Каталог товаров
                            </span>
                            <h2>Остатки и карточки</h2>
                        </div>
                        <span className="section-count">
                            {searchResult.total}/{products.length} позиций
                        </span>
                    </header>
                    <InventorySummary
                        totalCount={products.length}
                        inStockCount={productsWithStock.length}
                        outOfStockCount={outOfStockCount}
                        categoryCount={categoryCount}
                        archivedCount={archivedCount}
                    />
                    <WarehouseFilters
                        searchQuery={searchQuery}
                        selectedCategory={selectedCategory}
                        showInStockOnly={showInStockOnly}
                        categoryOptions={categoryOptions}
                        onSearchQueryChange={setSearchQuery}
                        onSelectedCategoryChange={setSelectedCategory}
                        onShowInStockOnlyChange={setShowInStockOnly}
                    />
                    <ProductTable
                        isCatalogLoading={isCatalogLoading}
                        allProductsCount={products.length}
                        products={visibleProducts}
                    />
                </div>
                <ChatConsole
                    modelName={OLLAMA_CHAT_MODEL}
                    productsCount={products.length}
                    question={question}
                    chatMessages={chatMessages}
                    isAiLoading={isAiLoading}
                    chatFeedRef={chatFeedRef}
                    onQuestionChange={setQuestion}
                    onQuestionKeyDown={handleQuestionKeyDown}
                    onAsk={askAi}
                    onReset={resetAiSession}
                />
            </section>
            <ToastViewport messages={toastMessages} onDismiss={dismissToast} />
        </main>
    );
};

export default AiInventoryPage;
