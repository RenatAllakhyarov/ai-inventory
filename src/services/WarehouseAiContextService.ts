import {
    fetchOllamaEmbedApi,
    fetchOllamaChatApi,
    type OllamaChatMessage,
    WAREHOUSE_SYSTEM_PROMPT,
} from "@api/OllamaApi";

import {
    type WarehouseProduct,
} from "./ProductsStorageService";
import { QwenProductsService } from "./QwenProductsService";

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

    private readonly qwenProductsService =
        new QwenProductsService();

    private sessionMessages: OllamaChatMessage[] = [];

    updateProducts = (
        products: WarehouseProduct[],
    ): void => {
        const nextSignature =
            this.getProductsSignature(
                products,
            );

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

    ask = async (
        question: string,
    ): Promise<string> => {
        const trimmedQuestion = question.trim();

        if (!trimmedQuestion) {
            throw new Error(
                "Введите вопрос",
            );
        }

        if (this.products.length === 0) {
            throw new Error(
                "Каталог пуст",
            );
        }

        const retrievalText =
            this.getRetrievalText(
                trimmedQuestion,
            );

        const includeDetails =
            this.qwenProductsService.shouldIncludeDetails(
                trimmedQuestion,
            );

        const productLimit = this.products.length;

        const relevantProducts =
            await this.selectRelevantProducts(
                retrievalText,
                productLimit,
            );

        const messages =
            this.prepareMessages(
                relevantProducts,
                trimmedQuestion,
                includeDetails,
            );

        const answer =
            await fetchOllamaChatApi(
                messages,
            );

        this.sessionMessages =
            this.trimSessionMessages(
                [
                    ...this.sessionMessages,
                    {
                        role: "user",
                        content: trimmedQuestion,
                    },
                    {
                        role: "assistant",
                        content: answer,
                    },
                ],
            );

        return answer;
    };

    private getRetrievalText = (
        question: string,
    ): string => {
        const recentContext =
            this.sessionMessages
                .slice(-MAX_HISTORY_MESSAGES)
                .map((message) => message.content)
                .join("\n");

        return [
            recentContext,
            question,
        ]
            .filter(Boolean)
            .join("\n");
    };

    private prepareMessages = (
        relevantProducts: WarehouseProduct[],
        question: string,
        includeDetails: boolean,
    ): OllamaChatMessage[] => {
        return [
            {
                role: "system",
                content: WAREHOUSE_SYSTEM_PROMPT,
            },
            {
                role: "user",
                content: this.prepareWarehouseContext(
                    relevantProducts,
                    includeDetails,
                ),
            },
            ...this.sessionMessages.slice(-MAX_HISTORY_MESSAGES),
            {
                role: "user",
                content: question,
            },
        ];
    };

    private prepareWarehouseContext = (
        products: WarehouseProduct[],
        includeDetails: boolean,
    ): string => {
        return `
АКТУАЛЬНЫЙ СКЛАДСКОЙ КОНТЕКСТ:

ВСЕГО ТОВАРОВ В ЛОКАЛЬНОМ КАТАЛОГЕ:
${this.products.length}

В ЭТОТ ЗАПРОС ПЕРЕДАНЫ ТОЛЬКО НАИБОЛЕЕ РЕЛЕВАНТНЫЕ ТОВАРЫ:
${products.length}

ФОРМАТ ТОВАРОВ:
name | stock | price | category${includeDetails ? " | bounded description" : ""}

ТОВАРЫ:

${this.qwenProductsService.prepareCompactContext(products, includeDetails)}
        `.trim();
    };

    private trimSessionMessages = (
        messages: OllamaChatMessage[],
    ): OllamaChatMessage[] => {
        return messages.slice(-MAX_HISTORY_MESSAGES);
    };

    private selectRelevantProducts = async (
        retrievalText: string,
        limit: number,
    ): Promise<WarehouseProduct[]> => {
        const keywordProducts =
            this.qwenProductsService.selectRelevantProducts(
                this.products,
                retrievalText,
                limit,
            );

        if (!ENABLE_EMBEDDING_RETRIEVAL) {
            return keywordProducts;
        }

        try {
            const embeddingProducts =
                await this.selectEmbeddingProducts(
                    retrievalText,
                    limit,
                );

            return this.mergeProducts(
                keywordProducts,
                embeddingProducts,
                limit,
            );
        } catch (error) {
            console.warn(
                "Ollama embedding retrieval fallback:",
                error,
            );

            return keywordProducts;
        }
    };

    private selectEmbeddingProducts = async (
        retrievalText: string,
        limit: number,
    ): Promise<WarehouseProduct[]> => {
        await this.ensureProductEmbeddings();

        if (this.productEmbeddings.length === 0) {
            return [];
        }

        const [questionEmbedding] =
            await fetchOllamaEmbedApi(
                [retrievalText],
            );

        if (!questionEmbedding) {
            return [];
        }

        return this.productEmbeddings
            .map((productEmbedding) => {
                const product =
                    this.products.find(
                        (item) => item.id === productEmbedding.productId,
                    );

                return {
                    product,
                    score: this.getCosineSimilarity(
                        questionEmbedding,
                        productEmbedding.embedding,
                    ),
                };
            })
            .filter((item): item is {
                product: WarehouseProduct;
                score: number;
            } => Boolean(item.product))
            .sort((left, right) => right.score - left.score)
            .slice(0, limit)
            .map(({ product }) => product);
    };

    private ensureProductEmbeddings = async (): Promise<void> => {
        if (this.productEmbeddings.length > 0) {
            return;
        }

        const inputs =
            this.products.map((product) =>
                this.qwenProductsService.getSearchableText(product),
            );

        const embeddings =
            await fetchOllamaEmbedApi(
                inputs,
            );

        this.productEmbeddings =
            embeddings
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
    };

    private mergeProducts = (
        primaryProducts: WarehouseProduct[],
        secondaryProducts: WarehouseProduct[],
        limit: number,
    ): WarehouseProduct[] => {
        const productsById = new Map<string, WarehouseProduct>();

        for (const product of [
            ...primaryProducts,
            ...secondaryProducts,
        ]) {
            productsById.set(
                product.id,
                product,
            );
        }

        return [...productsById.values()].slice(0, limit);
    };

    private getProductsSignature = (
        products: WarehouseProduct[],
    ): string => {
        return products
            .map((product) => [
                product.id,
                product.name,
                product.description,
                product.code,
                product.article,
                product.pathName,
                product.stock,
            ].join(":"))
            .join("|");
    };

    private getCosineSimilarity = (
        left: number[],
        right: number[],
    ): number => {
        const length = Math.min(
            left.length,
            right.length,
        );

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

        return dotProduct /
            (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
    };
}
