import { beforeEach, describe, expect, it, vi } from "vitest";
import { type WarehouseProduct } from "./ProductsStorageService";
import { EMBEDDING_BATCH_SIZE, MAX_EMBEDDING_PRODUCT_TEXT_LENGTH } from "@utils/constants";

const { fetchOllamaEmbedApiMock } = vi.hoisted(() => ({
    fetchOllamaEmbedApiMock: vi.fn(),
}));

vi.mock("@api/OllamaApi", () => ({
    OLLAMA_EMBEDDING_MODEL: "test-model",
    fetchOllamaEmbedApi: fetchOllamaEmbedApiMock,
    fetchOllamaChatApi: vi.fn(),
}));

import {
    getBoundedEmbeddingInput,
    getProductEmbeddingFingerprint,
    getProductsSignature,
    WarehouseAiContextService,
} from "./WarehouseAiContextService";
import { ProductTextService } from "./ProductTextService";
import { type WarehouseEmbeddingRecord } from "./WarehouseIdbStorageService";

type AiContextInternals = {
    ensureProductEmbeddings: (signal?: AbortSignal) => Promise<void>;
    productEmbeddings: Array<{ productId: string; embedding: number[] }>;
    warehouseIdbStorageService: {
        getEmbeddingsByModel: () => Promise<WarehouseEmbeddingRecord[]>;
        upsertEmbeddings: (records: WarehouseEmbeddingRecord[]) => Promise<void>;
    };
};

const getEmbeddingInput = (product: WarehouseProduct): string =>
    getBoundedEmbeddingInput(
        new ProductTextService().getSearchableText(product),
    );

const createService = (
    products: WarehouseProduct[],
    storedEmbeddings: WarehouseEmbeddingRecord[] = [],
) => {
    const service = new WarehouseAiContextService();
    service.updateProducts(products);
    const internals = service as unknown as AiContextInternals;
    const records = [...storedEmbeddings];
    const upsertEmbeddings = vi.fn(async (nextRecords: WarehouseEmbeddingRecord[]) => {
        for (const record of nextRecords) {
            const index = records.findIndex(
                (storedRecord) => storedRecord.productId === record.productId,
            );

            if (index >= 0) {
                records[index] = record;
            } else {
                records.push(record);
            }
        }
    });

    internals.warehouseIdbStorageService = {
        getEmbeddingsByModel: vi.fn(async () => records),
        upsertEmbeddings,
    };

    return { internals, records, upsertEmbeddings };
};

describe("WarehouseAiContextService embeddings", () => {
    beforeEach(() => {
        fetchOllamaEmbedApiMock.mockReset();
    });

    it("bounds embedding inputs and fingerprints the submitted text deterministically", () => {
        const input = "x".repeat(MAX_EMBEDDING_PRODUCT_TEXT_LENGTH + 1);
        const boundedInput = getBoundedEmbeddingInput(input);

        expect(boundedInput).toHaveLength(MAX_EMBEDDING_PRODUCT_TEXT_LENGTH);
        expect(getProductEmbeddingFingerprint(boundedInput)).toBe(
            getProductEmbeddingFingerprint(boundedInput),
        );
        expect(getProductEmbeddingFingerprint(`${boundedInput}x`)).not.toBe(
            getProductEmbeddingFingerprint(boundedInput),
        );
    });

    it("reuses unchanged product embeddings and requests only missing products", async () => {
        const firstProduct = { id: "first", name: "Первый" };
        const secondProduct = { id: "second", name: "Второй" };
        const { internals, upsertEmbeddings } = createService(
            [firstProduct, secondProduct],
            [{
                productId: firstProduct.id,
                embedding: [1],
                productSignature: getProductEmbeddingFingerprint(
                    getEmbeddingInput(firstProduct),
                ),
                model: "test-model",
                updatedAt: 1,
            }],
        );
        fetchOllamaEmbedApiMock.mockResolvedValue([[2]]);

        await internals.ensureProductEmbeddings();

        expect(fetchOllamaEmbedApiMock).toHaveBeenCalledWith(
            [getEmbeddingInput(secondProduct)],
            undefined,
        );
        expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
        expect(internals.productEmbeddings).toEqual([
            { productId: "first", embedding: [1] },
            { productId: "second", embedding: [2] },
        ]);
    });

    it("persists completed batches and resumes only the unfinished batch", async () => {
        const products = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, (_, index) => ({
            id: `product-${index}`,
            name: `Товар ${index}`,
        }));
        const { internals, upsertEmbeddings } = createService(products);
        fetchOllamaEmbedApiMock
            .mockImplementationOnce(async (inputs: string[]) =>
                inputs.map((_, index) => [index]),
            )
            .mockRejectedValueOnce(new Error("second batch failed"));

        await expect(internals.ensureProductEmbeddings()).rejects.toThrow(
            "second batch failed",
        );
        expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
        expect(internals.productEmbeddings).toEqual([]);
        expect(fetchOllamaEmbedApiMock.mock.calls[0]?.[0]).toHaveLength(
            EMBEDDING_BATCH_SIZE,
        );

        fetchOllamaEmbedApiMock.mockReset();
        fetchOllamaEmbedApiMock.mockResolvedValue([[99]]);

        await internals.ensureProductEmbeddings();

        expect(fetchOllamaEmbedApiMock).toHaveBeenCalledWith(
            [getEmbeddingInput(products.at(-1) as WarehouseProduct)],
            undefined,
        );
        expect(internals.productEmbeddings).toHaveLength(products.length);
    });

    it("stops before the next batch when cancelled after a completed batch", async () => {
        const products = Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, (_, index) => ({
            id: `product-${index}`,
            name: `Товар ${index}`,
        }));
        const { internals, upsertEmbeddings } = createService(products);
        const controller = new AbortController();
        const persistBatch = upsertEmbeddings.getMockImplementation();

        if (!persistBatch) {
            throw new Error("Embedding persistence mock is unavailable");
        }

        upsertEmbeddings.mockImplementationOnce(async (records) => {
            await persistBatch(records);
            controller.abort();
        });
        fetchOllamaEmbedApiMock.mockImplementation(async (inputs: string[]) =>
            inputs.map((_, index) => [index]),
        );

        await expect(
            internals.ensureProductEmbeddings(controller.signal),
        ).rejects.toThrow("Request aborted");

        expect(fetchOllamaEmbedApiMock).toHaveBeenCalledTimes(1);
        expect(upsertEmbeddings).toHaveBeenCalledTimes(1);
    });
});

describe("WarehouseAiContextService catalog signature", () => {
    it("is repeatable and independent of catalog product ordering", () => {
        const products = [
            { id: "first", name: "Первый", stock: 1 },
            { id: "second", name: "Второй", stock: 2 },
        ];

        expect(getProductsSignature(products)).toBe(getProductsSignature(products));
        expect(getProductsSignature(products)).toBe(
            getProductsSignature([...products].reverse()),
        );
    });

    it("does not confuse delimiter-containing values with another field layout", () => {
        const valuesWithDelimiters = [{
            id: "product",
            name: "name:description|code",
            description: "article",
        }];
        const rearrangedValues = [{
            id: "product",
            name: "name",
            description: "description|code:article",
        }];

        expect(getProductsSignature(valuesWithDelimiters)).not.toBe(
            getProductsSignature(rearrangedValues),
        );
    });

    it("changes when a signature-relevant product value changes", () => {
        const products = [{
            id: "product",
            stock: 1,
            salePrices: [{ value: 100 }],
        }];
        const changedProducts = [{
            id: "product",
            stock: 2,
            salePrices: [{ value: 100 }],
        }];

        expect(getProductsSignature(products)).not.toBe(
            getProductsSignature(changedProducts),
        );
    });
});
