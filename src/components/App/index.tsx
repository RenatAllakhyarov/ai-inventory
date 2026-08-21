import { type ReactElement, useEffect, useState } from "react";

import "./style.css";

import {
    checkMoySkladConnection,
    fetchWarehouseApi,
} from "@api/MoySkladApi";
import {
    ProductsStorageService,
    type WarehouseProduct,
} from "@services/ProductsStorageService";
import { WarehouseAiContextService } from "@services/WarehouseAiContextService";

interface WarehouseProductsResponse {
    rows?: WarehouseProduct[];
}

const productsStorage = new ProductsStorageService();
const warehouseAiContextService =
    new WarehouseAiContextService();

const App = (): ReactElement => {
    const [isConnected, setIsConnected] =
        useState<boolean | null>(null);

    const [products, setProducts] =
        useState<WarehouseProduct[]>([]);

    const [question, setQuestion] =
        useState<string>("");

    const [aiAnswer, setAiAnswer] =
        useState<string>("");

    const [isAiLoading, setIsAiLoading] =
        useState<boolean>(false);

    const [aiError, setAiError] =
        useState<string>("");

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
        if (!question.trim()) {
            setAiError(
                "Введите вопрос",
            );

            return;
        }

        const cachedProducts =
            productsStorage.getProductsFromStorage();

        if (cachedProducts.length === 0) {
            setAiError(
                "Каталог пуст",
            );

            return;
        }

        try {
            setIsAiLoading(true);
            setAiError("");
            setAiAnswer("");

            warehouseAiContextService.updateProducts(
                cachedProducts,
            );

            const answer =
                await warehouseAiContextService.ask(
                    question,
                );

            setAiAnswer(
                answer,
            );
        } catch (error) {
            console.error(
                "Ошибка Ollama:",
                error,
            );

            if (error instanceof Error) {
                setAiError(
                    error.message,
                );
            } else {
                setAiError(
                    "Неизвестная ошибка Ollama",
                );
            }
        } finally {
            setIsAiLoading(false);
        }
    };

    const resetAiSession = (): void => {
        warehouseAiContextService.resetSession();
        setAiAnswer("");
        setAiError("");
    };

    const handleKeyDown = (
        event: React.KeyboardEvent<HTMLInputElement>,
    ): void => {
        if (
            event.key === "Enter" &&
            !isAiLoading
        ) {
            void askAi();
        }
    };

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
        <div>
            <div className="connection">
                {
                    isConnected === null &&
                    <p>
                        Проверяем подключение...
                    </p>
                }

                {
                    isConnected === true &&
                    <p>
                        API МоегоСклада подключено ✅
                    </p>
                }

                {
                    isConnected === false &&
                    <p>
                        Нет подключения к API МоегоСклада ❌
                    </p>
                }
            </div>

            <div className="products">
                {
                    products.map((product) => (
                        <div
                            className="tea"
                            key={product.id}
                        >
                            <div className="tea-name">
                                * {product.name}
                            </div>

                            <div className="product-description">
                                Description:
                                {" "}
                                {
                                    product.description ??
                                    "Описание отсутствует"
                                }
                            </div>
                        </div>
                    ))
                }

                <div className="count">
                    Количество:
                    {" "}
                    {products.length}
                </div>
            </div>

            <div className="ai-test">
                <input
                    type="text"
                    value={question}
                    onChange={(event) => {
                        setQuestion(
                            event.target.value,
                        );

                        if (aiError) {
                            setAiError("");
                        }
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Например: какие товары связаны с чаем?"
                    disabled={isAiLoading}
                />

                <button
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
                            ? "Ищу подходящие товары и отвечаю..."
                            : "Спросить"
                    }
                </button>

                <button
                    type="button"
                    onClick={resetAiSession}
                    disabled={isAiLoading}
                >
                    Новый диалог
                </button>

                {
                    aiAnswer &&
                    <div className="ai-answer">
                        <h3>
                            Ответ Qwen:
                        </h3>

                        <p>
                            {aiAnswer}
                        </p>
                    </div>
                }

                {
                    aiError &&
                    <div className="ai-error">
                        Ошибка:
                        {" "}
                        {aiError}
                    </div>
                }
            </div>
        </div>
    );
};

export default App;
