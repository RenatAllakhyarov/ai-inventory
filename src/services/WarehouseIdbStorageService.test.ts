import { afterEach, describe, expect, it, vi } from "vitest";
import {
    type WarehouseEmbeddingRecord,
    WarehouseIdbStorageService,
} from "./WarehouseIdbStorageService";

const createRequest = <TValue>(result: TValue): IDBRequest<TValue> => {
    let successHandler: IDBRequest<TValue>["onsuccess"] = null;

    return {
        result,
        set onsuccess(handler: IDBRequest<TValue>["onsuccess"]) {
            successHandler = handler;
            queueMicrotask(() => successHandler?.call(
                this as unknown as IDBRequest<TValue>,
                new Event("success"),
            ));
        },
    } as IDBRequest<TValue>;
};

const createEmbeddingStorage = (): WarehouseIdbStorageService => {
    const records = new Map<string, WarehouseEmbeddingRecord>();
    const store = {
        indexNames: {
            contains: (name: string): boolean => name === "model",
        },
        index: () => ({
            getAll: (model: string) => createRequest(
                [...records.values()].filter((record) => record.model === model),
            ),
        }),
        put: (record: WarehouseEmbeddingRecord): void => {
            records.set(record.productId, record);
        },
    };
    const service = new WarehouseIdbStorageService();

    (service as unknown as { open: () => Promise<IDBDatabase> }).open = async () => ({
        transaction: () => {
            let completeHandler: IDBTransaction["oncomplete"] = null;

            return {
                objectStore: () => store,
                set oncomplete(handler: IDBTransaction["oncomplete"]) {
                    completeHandler = handler;
                    queueMicrotask(() => completeHandler?.call(
                        this as unknown as IDBTransaction,
                        new Event("complete"),
                    ));
                },
            } as unknown as IDBTransaction;
        },
    } as unknown as IDBDatabase);

    return service;
};

describe("WarehouseIdbStorageService", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("indexes normalized prices with their supplied currency or the rouble fallback", () => {
        const service = new WarehouseIdbStorageService();
        const catalog = service.createIndexedCatalog([
            {
                id: "usd-product",
                salePrices: [{ value: 12300, currency: "USD" }],
            },
            {
                id: "default-product",
                salePrices: [{ value: 45600 }],
            },
        ]);

        expect(catalog.prices).toEqual([
            { productId: "usd-product", price: 123, currency: "USD" },
            { productId: "default-product", price: 456, currency: "RUB" },
        ]);
    });

    it("upserts embedding batches without discarding other products", async () => {
        const service = createEmbeddingStorage();
        vi.stubGlobal("IDBKeyRange", {
            only: (value: string): string => value,
        });

        await service.upsertEmbeddings([
            {
                productId: "first",
                embedding: [1],
                productSignature: "first-v1",
                model: "test-model",
                updatedAt: 1,
            },
            {
                productId: "second",
                embedding: [2],
                productSignature: "second-v1",
                model: "test-model",
                updatedAt: 1,
            },
        ]);
        await service.upsertEmbeddings([
            {
                productId: "first",
                embedding: [3],
                productSignature: "first-v2",
                model: "test-model",
                updatedAt: 2,
            },
        ]);

        expect(await service.getEmbeddingsByModel("test-model")).toEqual([
            {
                productId: "first",
                embedding: [3],
                productSignature: "first-v2",
                model: "test-model",
                updatedAt: 2,
            },
            {
                productId: "second",
                embedding: [2],
                productSignature: "second-v1",
                model: "test-model",
                updatedAt: 1,
            },
        ]);
    });
});
