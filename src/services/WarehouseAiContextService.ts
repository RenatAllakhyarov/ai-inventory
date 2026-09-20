import { WarehouseRetrievalPlannerService } from "./WarehouseRetrievalPlannerService";
import { WarehouseIdbStorageService } from "./WarehouseIdbStorageService";
import { type WarehouseProduct } from "./ProductsStorageService";
import { ProductTextService } from "./ProductTextService";
import {
    MAX_AI_CONTEXT_PRODUCTS,
    WAREHOUSE_SYSTEM_PROMPT,
} from "@utils/constants";
import {
    type WarehouseQueryResult,
    WarehouseCatalogQueryService,
} from "./WarehouseCatalogQueryService";
import {
    fetchOllamaEmbedApi,
    fetchOllamaChatApi,
    type OllamaChatMessage,
    OLLAMA_EMBEDDING_MODEL,
} from "@api/OllamaApi";


const MAX_HISTORY_MESSAGES = 4;
const ENABLE_EMBEDDING_RETRIEVAL =
    import.meta.env.VITE_OLLAMA_EMBEDDINGS_ENABLED === "true";

interface ProductEmbedding {
    productId: string;
    embedding: number[];
}

export class WarehouseAiContextService {
    private products: WarehouseProduct[] = [];
    private productsSignature = "";
    private productEmbeddings: ProductEmbedding[] = [];
    private readonly productTextService = new ProductTextService();
    private readonly warehouseCatalogQueryService =
        new WarehouseCatalogQueryService();
    private readonly warehouseIdbStorageService =
        new WarehouseIdbStorageService();
    private readonly warehouseRetrievalPlannerService =
        new WarehouseRetrievalPlannerService();
    private sessionMessages: OllamaChatMessage[] = [];

    updateProducts = (products: WarehouseProduct[]): void => {
        const nextSignature = this.getProductsSignature(products);

        if (nextSignature !== this.productsSignature) {
            this.productEmbeddings = [];
            this.productsSignature = nextSignature;
        }

        this.products = products;
    };

    resetSession = (): void => {
        this.sessionMessages = [];
    };

    getSessionMessages = (): OllamaChatMessage[] => {
        return [...this.sessionMessages];
    };

    ask = async (question: string, signal?: AbortSignal): Promise<string> => {
        const trimmedQuestion = question.trim();

        if (!trimmedQuestion) {
            throw new Error("Введите вопрос");
        }

        if (this.products.length === 0) {
            throw new Error("Каталог пуст");
        }

        const retrievalText = this.getRetrievalText(trimmedQuestion);
        const includeDetails =
            this.productTextService.shouldIncludeDetails(trimmedQuestion);

        const retrievalResult = await this.selectWarehouseContext(
            retrievalText,
            includeDetails,
            signal,
        );

        this.throwIfAborted(signal);

        if (
            retrievalResult.total === 0 &&
            retrievalResult.products.length === 0 &&
            retrievalResult.kind === "lookup"
        ) {
            const insufficientAnswer =
                "В доступном складском индексе не нашлось данных для ответа. Уточни название, категорию, артикул, код или штрихкод.";

            this.sessionMessages = this.trimSessionMessages([
                ...this.sessionMessages,
                {
                    role: "user",
                    content: trimmedQuestion,
                },
                {
                    role: "assistant",
                    content: insufficientAnswer,
                },
            ]);

            return insufficientAnswer;
        }

        const messages = this.prepareMessages(
            retrievalResult.factsText,
            trimmedQuestion,
        );
        const answer = await fetchOllamaChatApi(messages, signal);

        this.throwIfAborted(signal);

        this.sessionMessages = this.trimSessionMessages([
            ...this.sessionMessages,
            {
                role: "user",
                content: trimmedQuestion,
            },
            {
                role: "assistant",
                content: answer,
            },
        ]);

        return answer;
    };

    private getRetrievalText = (question: string): string => {
        return question.trim();
    };

    private prepareMessages = (
        warehouseFactsText: string,
        question: string,
    ): OllamaChatMessage[] => {
        return [
            {
                role: "system",
                content: WAREHOUSE_SYSTEM_PROMPT,
            },
            {
                role: "user",
                content: this.prepareWarehouseFactsContext(warehouseFactsText),
            },
            ...this.sessionMessages.slice(-MAX_HISTORY_MESSAGES),
            {
                role: "user",
                content: question,
            },
        ];
    };

    private prepareWarehouseFactsContext = (
        warehouseFactsText: string,
    ): string => {
        return `
АКТУАЛЬНЫЕ СКЛАДСКИЕ ФАКТЫ:

ВСЕГО ТОВАРОВ В ЛОКАЛЬНОМ КАТАЛОГЕ:
${this.products.length}

${warehouseFactsText}
        `.trim();
    };

    private trimSessionMessages = (
        messages: OllamaChatMessage[],
    ): OllamaChatMessage[] => {
        return messages.slice(-MAX_HISTORY_MESSAGES);
    };

    private selectWarehouseContext = async (
        retrievalText: string,
        includeDetails: boolean,
        signal?: AbortSignal,
    ): Promise<WarehouseQueryResult> => {
        const limit = Math.min(this.products.length, MAX_AI_CONTEXT_PRODUCTS);

        const deterministicPlan =
            this.warehouseCatalogQueryService.detectDeterministicPlan(
                retrievalText,
            );

        if (deterministicPlan) {
            return this.warehouseCatalogQueryService.executePlan(
                deterministicPlan,
                this.products,
            );
        }

        try {
            const retrievalPlan =
                await this.warehouseRetrievalPlannerService.planRetrieval(
                    retrievalText,
                    signal,
                );

            this.throwIfAborted(signal);

            if (retrievalPlan) {
                const plannedResult =
                    await this.warehouseCatalogQueryService.executePlan(
                        retrievalPlan.type === "lookup"
                            ? {
                                  ...retrievalPlan,
                                  limit: retrievalPlan.limit ?? limit,
                                  includeDescription:
                                      includeDetails ||
                                      Boolean(retrievalPlan.includeDescription),
                              }
                            : retrievalPlan,
                        this.products,
                    );

                if (
                    plannedResult.kind === "aggregate" ||
                    plannedResult.products.length > 0 ||
                    plannedResult.total > 0
                ) {
                    return this.addEmbeddingResultsIfEnabled(
                        plannedResult,
                        retrievalText,
                        limit,
                        signal,
                    );
                }
            }
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }

            console.warn("Warehouse retrieval planner fallback:", error);
        }

        const lexicalResult =
            await this.warehouseCatalogQueryService.executePlan(
                {
                    type: "lookup",
                    query: retrievalText,
                    limit,
                    sort: {
                        field: "relevance",
                        direction: "desc",
                    },
                    includeDescription: includeDetails,
                },
                this.products,
            );

        return this.addEmbeddingResultsIfEnabled(
            lexicalResult,
            retrievalText,
            limit,
            signal,
        );
    };

    private addEmbeddingResultsIfEnabled = async (
        result: WarehouseQueryResult,
        retrievalText: string,
        limit: number,
        signal?: AbortSignal,
    ): Promise<WarehouseQueryResult> => {
        if (
            result.kind !== "lookup" ||
            result.products.length === 0 ||
            !ENABLE_EMBEDDING_RETRIEVAL
        ) {
            return result;
        }

        try {
            const embeddingProducts = await this.selectEmbeddingProducts(
                retrievalText,
                limit,
                signal,
            );
            const mergedProducts = this.mergeProducts(
                result.products,
                embeddingProducts,
                limit,
            );

            return {
                ...result,
                products: mergedProducts,
                factsText: `
АКТУАЛЬНЫЙ СКЛАДСКОЙ КОНТЕКСТ:
ТИП: products.lookup
ВСЕГО СОВПАДЕНИЙ В ЛОКАЛЬНОМ ИНДЕКСЕ: ${result.total}
ПЕРЕДАНО ТОВАРОВ: ${mergedProducts.length}
ФОРМАТ ТОВАРОВ:
name | stock | price | category${result.includeDescription ? " | bounded description" : ""}

ТОВАРЫ:

${this.productTextService.prepareCompactContext(
    mergedProducts,
    result.includeDescription,
)}
                `.trim(),
            };
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }

            console.warn("Ollama embedding retrieval fallback:", error);

            return result;
        }
    };

    private selectEmbeddingProducts = async (
        retrievalText: string,
        limit: number,
        signal?: AbortSignal,
    ): Promise<WarehouseProduct[]> => {
        await this.ensureProductEmbeddings(signal);

        this.throwIfAborted(signal);

        if (this.productEmbeddings.length === 0) {
            return [];
        }

        const [questionEmbedding] = await fetchOllamaEmbedApi(
            [retrievalText],
            signal,
        );

        this.throwIfAborted(signal);

        if (!questionEmbedding) {
            return [];
        }

        const productsById = new Map(
            this.products.map((product) => [product.id, product]),
        );

        return this.productEmbeddings
            .map((productEmbedding) => {
                const product = productsById.get(productEmbedding.productId);

                return {
                    product,
                    score: this.getCosineSimilarity(
                        questionEmbedding,
                        productEmbedding.embedding,
                    ),
                };
            })
            .filter(
                (
                    item,
                ): item is {
                    product: WarehouseProduct;
                    score: number;
                } => Boolean(item.product),
            )
            .sort((left, right) => right.score - left.score)
            .slice(0, limit)
            .map(({ product }) => product);
    };

    private ensureProductEmbeddings = async (
        signal?: AbortSignal,
    ): Promise<void> => {
        if (this.productEmbeddings.length > 0) {
            return;
        }

        try {
            const storedEmbeddings =
                await this.warehouseIdbStorageService.getEmbeddings(
                    this.productsSignature,
                );

            this.throwIfAborted(signal);

            if (storedEmbeddings.length > 0) {
                this.productEmbeddings = storedEmbeddings.map((record) => ({
                    productId: record.productId,
                    embedding: record.embedding,
                }));
                return;
            }
        } catch (error) {
            console.warn("IndexedDB embedding load fallback:", error);
        }

        const inputs = this.products.map((product) =>
            this.productTextService.getSearchableText(product),
        );
        const embeddings = await fetchOllamaEmbedApi(inputs, signal);

        this.throwIfAborted(signal);

        this.productEmbeddings = embeddings
            .map((embedding, index) => {
                const product = this.products[index];
                if (!product) {
                    return null;
                }

                return {
                    productId: product.id,
                    embedding,
                };
            })
            .filter((item): item is ProductEmbedding => item !== null);

        try {
            await this.warehouseIdbStorageService.replaceEmbeddings(
                this.productEmbeddings.map((record) => ({
                    ...record,
                    productSignature: this.productsSignature,
                    model: OLLAMA_EMBEDDING_MODEL,
                    updatedAt: Date.now(),
                })),
            );
        } catch (error) {
            console.warn("IndexedDB embedding save fallback:", error);
        }
    };

    private mergeProducts = (
        primaryProducts: WarehouseProduct[],
        secondaryProducts: WarehouseProduct[],
        limit: number,
    ): WarehouseProduct[] => {
        const productsById = new Map<string, WarehouseProduct>();

        for (const product of primaryProducts) {
            productsById.set(product.id, product);
        }
        for (const product of secondaryProducts) {
            if (!productsById.has(product.id)) {
                productsById.set(product.id, product);
            }
        }

        return [...productsById.values()].slice(0, limit);
    };

    private getProductsSignature = (products: WarehouseProduct[]): string => {
        return products
            .map((product) =>
                [
                    product.id,
                    product.name,
                    product.description,
                    product.code,
                    product.externalCode,
                    product.article,
                    product.pathName,
                    product.stock,
                    product.salePrices?.[0]?.value,
                    product.salePrices?.[0]?.currency,
                ].join(":"),
            )
            .join("|");
    };

    private throwIfAborted = (signal?: AbortSignal): void => {
        if (signal?.aborted) {
            throw new Error("Request aborted");
        }
    };

    private getCosineSimilarity = (left: number[], right: number[]): number => {
        const length = Math.min(left.length, right.length);
        let dotProduct = 0;
        let leftMagnitude = 0;
        let rightMagnitude = 0;

        for (let index = 0; index < length; index += 1) {
            const leftValue = left[index] ?? 0;
            const rightValue = right[index] ?? 0;

            dotProduct += leftValue * rightValue;
            leftMagnitude += leftValue * leftValue;
            rightMagnitude += rightValue * rightValue;
        }

        if (leftMagnitude === 0 || rightMagnitude === 0) {
            return 0;
        }

        return (
            dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
        );
    };
}
