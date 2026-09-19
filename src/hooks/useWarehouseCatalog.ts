import { configuredWarehouseSourceClient } from "@services/ConfiguredWarehouseSourceClient";
import {
    ProductsStorageService,
    type WarehouseProduct,
} from "@services/ProductsStorageService";
import { WarehouseIdbStorageService } from "@services/WarehouseIdbStorageService";
import {
    WarehouseProvider,
    type WarehouseSearchParams,
    type WarehouseSearchResult,
} from "@services/WarehouseProvider";
import { type ToastInput } from "@hooks/useToasts";
import { useEffect, useRef, useState } from "react";

const productsStorage = new ProductsStorageService();
const warehouseProvider = new WarehouseProvider();
const warehouseIdbStorageService = new WarehouseIdbStorageService();

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

const getSearchParams = (
    searchQuery: string,
    selectedCategory: string,
    showInStockOnly: boolean,
): WarehouseSearchParams => ({
    query: searchQuery,
    category: selectedCategory || undefined,
    inStockOnly: showInStockOnly || undefined,
    sortBy: searchQuery.trim() ? "relevance" : "name",
    sortDirection: "asc",
});

interface UseWarehouseCatalogOptions {
    showToast: (toast: ToastInput) => void;
}

interface UseWarehouseCatalogResult {
    sourceName: string;
    isConnected: boolean | null;
    products: WarehouseProduct[];
    isCatalogLoading: boolean;
    searchResult: WarehouseSearchResult;
    searchQuery: string;
    selectedCategory: string;
    showInStockOnly: boolean;
    categoryOptions: string[];
    productsWithStock: WarehouseProduct[];
    outOfStockCount: number;
    archivedCount: number;
    setSearchQuery: (value: string) => void;
    setSelectedCategory: (value: string) => void;
    setShowInStockOnly: (value: boolean) => void;
}

export const useWarehouseCatalog = ({
    showToast,
}: UseWarehouseCatalogOptions): UseWarehouseCatalogResult => {
    const sourceName = configuredWarehouseSourceClient.sourceName;
    const [isConnected, setIsConnected] = useState<boolean | null>(null);
    const [products, setProducts] = useState<WarehouseProduct[]>([]);
    const [isCatalogLoading, setIsCatalogLoading] = useState<boolean>(true);
    const [searchResult, setSearchResult] = useState<WarehouseSearchResult>(
        createEmptySearchResult,
    );
    const [searchQuery, setSearchQuery] = useState<string>("");
    const [selectedCategory, setSelectedCategory] = useState<string>("");
    const [showInStockOnly, setShowInStockOnly] = useState<boolean>(false);
    const searchRequestId = useRef(0);

    const productsWithStock = products.filter(
        (product) => typeof product.stock === "number" && product.stock > 0,
    );
    const outOfStockCount = products.filter(
        (product) => product.stock === 0,
    ).length;
    const archivedCount = products.filter((product) => product.archived).length;
    const categoryOptions = getCategoryOptions(products);

    useEffect(() => {
        const requestId = ++searchRequestId.current;
        let isActive = true;
        const isCurrent = (): boolean =>
            isActive && requestId === searchRequestId.current;

        const searchProducts = async (): Promise<void> => {
            const searchParams = getSearchParams(
                searchQuery,
                selectedCategory,
                showInStockOnly,
            );

            try {
                const result =
                    await warehouseProvider.searchProductsFromStorage(
                        searchParams,
                        products,
                    );

                if (!isCurrent()) return;
                setSearchResult(result);
            } catch (error) {
                if (!isCurrent()) return;
                console.warn("Warehouse search failed:", error);

                showToast({
                    type: "warning",
                    title: "Поиск работает через память",
                    message:
                        "Локальный индекс недоступен, но каталог остается на экране.",
                });

                setSearchResult(
                    warehouseProvider.searchProducts(products, searchParams),
                );
            }
        };

        void searchProducts();

        return (): void => {
            isActive = false;
        };
    }, [products, searchQuery, selectedCategory, showInStockOnly, showToast]);

    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;
        const isCurrent = (): boolean => isActive && !controller.signal.aborted;

        const loadProducts = async (): Promise<void> => {
            try {
                const savedProductsResult =
                    productsStorage.getProductsFromStorage();
                const { products: savedProducts, isInvalid } =
                    savedProductsResult;

                if (isInvalid) {
                    showToast({
                        type: "warning",
                        title: "Локальный каталог сброшен",
                        message:
                            "Сохраненные товары повреждены, загружаем доступный каталог.",
                    });
                }

                if (savedProducts.length > 0) {
                    console.log("Берем каталог из localStorage");

                    setProducts(savedProducts);

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
                        if (!isCurrent()) return;
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

                    if (!isCurrent()) return;

                    if (idbProducts.length > 0) {
                        console.log("Берем каталог из IndexedDB");

                        productsStorage.saveProductsToStorage(idbProducts);
                        setProducts(idbProducts);

                        showToast({
                            type: "success",
                            title: "Каталог загружен",
                            message: `Взяли ${idbProducts.length} товаров из IndexedDB.`,
                        });

                        return;
                    }
                } catch (error) {
                    if (!isCurrent()) return;
                    console.warn("IndexedDB load fallback:", error);

                    showToast({
                        type: "warning",
                        title: "IndexedDB недоступен",
                        message:
                            `Пробуем загрузить свежий каталог из источника ${sourceName}.`,
                    });
                }

                console.log(`Локальный каталог пустой, загружаем ${sourceName}`);

                const data =
                    await configuredWarehouseSourceClient.fetchCatalog(
                        controller.signal,
                    );

                if (!isCurrent()) return;

                productsStorage.saveProductsToStorage(data);

                showToast({
                    type: "success",
                    title: "Каталог загружен",
                    message: `Получили ${data.length} товаров из источника ${sourceName}.`,
                });

                try {
                    await warehouseIdbStorageService.replaceProducts(data);
                } catch (error) {
                    if (!isCurrent()) return;
                    console.warn("IndexedDB sync fallback:", error);

                    showToast({
                        type: "warning",
                        title: "Индекс не обновлен",
                        message:
                            "Каталог загружен, но IndexedDB временно недоступен.",
                    });
                }

                setProducts(data);
            } catch (error) {
                if (!isCurrent()) return;
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
                if (isCurrent()) {
                    setIsCatalogLoading(false);
                }
            }
        };

        void loadProducts();

        return (): void => {
            isActive = false;
            controller.abort();
        };
    }, [showToast, sourceName]);

    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;
        const isCurrent = (): boolean => isActive && !controller.signal.aborted;

        const checkConnection = async (): Promise<void> => {
            try {
                const result =
                    await configuredWarehouseSourceClient.checkConnection(
                        controller.signal,
                    );

                if (!isCurrent()) return;

                setIsConnected(result);

                console.log(`${sourceName} connection:`, result);

                showToast({
                    type: result ? "success" : "error",
                    title: result
                        ? `${sourceName} подключен`
                        : `Нет связи с ${sourceName}`,
                    message: result
                        ? "API склада доступен."
                        : "Показываем локальные данные, если они есть.",
                    durationMs: result ? 3200 : 6500,
                });
            } catch (error) {
                if (isCurrent()) {
                    console.warn("Warehouse connection check failed:", error);
                }
            }
        };

        void checkConnection();

        return (): void => {
            isActive = false;
            controller.abort();
        };
    }, [showToast, sourceName]);

    useEffect(() => {
        if (products.length === 0) {
            return;
        }

        let isActive = true;
        let isSyncing = false;
        let timeoutId: number | undefined;
        let activeSyncController: AbortController | null = null;

        const scheduleNextSync = (): void => {
            if (!isActive) {
                return;
            }

            timeoutId = window.setTimeout(
                () => {
                    void syncProducts();
                },
                5 * 60 * 1000,
            );
        };

        const syncProducts = async (): Promise<void> => {
            if (!isActive || isSyncing) {
                return;
            }

            isSyncing = true;
            const controller = new AbortController();
            activeSyncController = controller;
            const isCurrent = (): boolean =>
                isActive
                && !controller.signal.aborted;

            try {
                const freshProducts =
                    await configuredWarehouseSourceClient.fetchCatalog(
                        controller.signal,
                    );

                if (!isCurrent()) return;
                const { products: oldProducts } =
                    productsStorage.getProductsFromStorage();
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
                        if (!isCurrent()) return;
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

                    if (!isCurrent()) return;
                    setProducts(freshProducts);

                    showToast({
                        type: "success",
                        title: "Каталог обновлен",
                        message: `Синхронизация нашла ${freshProducts.length} товаров.`,
                    });
                }
            } catch (error) {
                if (!isCurrent()) return;
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
            } finally {
                if (activeSyncController === controller) {
                    activeSyncController = null;
                }

                isSyncing = false;
                scheduleNextSync();
            }
        };

        scheduleNextSync();

        return (): void => {
            isActive = false;
            activeSyncController?.abort();

            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [products.length, showToast]);

    return {
        sourceName,
        isConnected,
        products,
        isCatalogLoading,
        searchResult,
        searchQuery,
        selectedCategory,
        showInStockOnly,
        categoryOptions,
        productsWithStock,
        outOfStockCount,
        archivedCount,
        setSearchQuery,
        setSelectedCategory,
        setShowInStockOnly,
    };
};
