import { WarehouseRetrievalPlannerService } from "./WarehouseRetrievalPlannerService";
import { WarehouseIdbStorageService } from "./WarehouseIdbStorageService";
import { type WarehouseProduct } from "./ProductsStorageService";
import { ProductTextService } from "./ProductTextService";
import {
    EMBEDDING_BATCH_SIZE,
    MAX_AI_CONTEXT_PRODUCTS,
    MAX_EMBEDDING_PRODUCT_TEXT_LENGTH,
} from "@utils/constants";
import { WAREHOUSE_SYSTEM_PROMPT } from "@utils/aiPrompts";
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

interface ProductEmbeddingInput {
    productId: string;
    input: string;
    productSignature: string;
}

export const getBoundedEmbeddingInput = (input: string): string =>
    input.slice(0, MAX_EMBEDDING_PRODUCT_TEXT_LENGTH);

export const getProductEmbeddingFingerprint = (input: string): string =>
    `${input.length}:${input}`;

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_HASH_WIDTH = 16;

interface CatalogSignatureProduct {
    id: string;
    name: string | null;
    description: string | null;
    code: string | null;
    externalCode: string | null;
    article: string | null;
    pathName: string | null;
    stock: number | null;
    salePriceValue: number | null;
    salePriceCurrency: string | null;
}

const normalizeSignatureString = (value: unknown): string | null =>
    typeof value === "string" ? value : null;

const normalizeSignatureNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

const getCatalogSignatureProduct = (
    product: WarehouseProduct,
): CatalogSignatureProduct => {
    const [firstSalePrice] = product.salePrices ?? [];

    return {
        id: product.id,
        name: normalizeSignatureString(product.name),
        description: normalizeSignatureString(product.description),
        code: normalizeSignatureString(product.code),
        externalCode: normalizeSignatureString(product.externalCode),
        article: normalizeSignatureString(product.article),
        pathName: normalizeSignatureString(product.pathName),
        stock: normalizeSignatureNumber(product.stock),
        salePriceValue: normalizeSignatureNumber(firstSalePrice?.value),
        salePriceCurrency: normalizeSignatureString(firstSalePrice?.currency),
    };
};

const updateFnvHash = (hash: bigint, value: string): bigint => {
    let nextHash = hash;

    for (let index = 0; index < value.length; index += 1) {
        nextHash ^= BigInt(value.charCodeAt(index));
        nextHash = BigInt.asUintN(64, nextHash * FNV_PRIME);
    }

    return nextHash;
};

export const getProductsSignature = (products: WarehouseProduct[]): string => {
    const serializedProducts = products
        .map((product) => JSON.stringify(getCatalogSignatureProduct(product)))
        .sort();
    let hash = FNV_OFFSET_BASIS;

    for (const serializedProduct of serializedProducts) {
        hash = updateFnvHash(hash, String(serializedProduct.length));
        hash = updateFnvHash(hash, serializedProduct);
    }

    return hash.toString(16).padStart(FNV_HASH_WIDTH, "0");
};

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
        const nextSignature = getProductsSignature(products);

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
        if (this.productEmbeddings.length > 0 || this.products.length === 0) {
            return;
        }

        const embeddingInputs = this.getProductEmbeddingInputs();
        const embeddingsByProductId = new Map<string, ProductEmbedding>();

        try {
            const storedEmbeddings =
                await this.warehouseIdbStorageService.getEmbeddingsByModel();

            this.throwIfAborted(signal);

            const storedEmbeddingsByProductId = new Map(
                storedEmbeddings.map((record) => [record.productId, record]),
            );

            for (const input of embeddingInputs) {
                const storedEmbedding = storedEmbeddingsByProductId.get(
                    input.productId,
                );

                if (
                    storedEmbedding
                    && storedEmbedding.productSignature === input.productSignature
                ) {
                    embeddingsByProductId.set(input.productId, {
                        productId: input.productId,
                        embedding: storedEmbedding.embedding,
                    });
                }
            }
        } catch (error) {
            console.warn("IndexedDB embedding load fallback:", error);
        }

        const missingInputs = embeddingInputs.filter(
            (input) => !embeddingsByProductId.has(input.productId),
        );

        for (
            let batchStart = 0;
            batchStart < missingInputs.length;
            batchStart += EMBEDDING_BATCH_SIZE
        ) {
            this.throwIfAborted(signal);

            const batch = missingInputs.slice(
                batchStart,
                batchStart + EMBEDDING_BATCH_SIZE,
            );
            const embeddings = await fetchOllamaEmbedApi(
                batch.map((input) => input.input),
                signal,
            );

            this.throwIfAborted(signal);

            if (embeddings.length !== batch.length) {
                throw new Error("Ollama returned an incomplete embedding batch");
            }

            const records = batch.map((input, index) => ({
                productId: input.productId,
                embedding: embeddings[index] as number[],
                productSignature: input.productSignature,
                model: OLLAMA_EMBEDDING_MODEL,
                updatedAt: Date.now(),
            }));

            try {
                await this.warehouseIdbStorageService.upsertEmbeddings(records);
            } catch (error) {
                console.warn("IndexedDB embedding save fallback:", error);
            }

            for (const record of records) {
                embeddingsByProductId.set(record.productId, {
                    productId: record.productId,
                    embedding: record.embedding,
                });
            }
        }

        if (embeddingsByProductId.size !== embeddingInputs.length) {
            throw new Error("Product embedding refresh is incomplete");
        }

        this.productEmbeddings = embeddingInputs.map((input) =>
            embeddingsByProductId.get(input.productId) as ProductEmbedding,
        );
    };

    private getProductEmbeddingInputs = (): ProductEmbeddingInput[] => {
        return this.products.map((product) => {
            const input = getBoundedEmbeddingInput(
                this.productTextService.getSearchableText(product),
            );

            return {
                productId: product.id,
                input,
                productSignature: getProductEmbeddingFingerprint(input),
            };
        });
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
