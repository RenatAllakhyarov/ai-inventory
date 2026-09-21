import { afterEach, describe, expect, it, vi } from "vitest";
import {
    type WarehouseEmbeddingRecord,
    WarehouseIdbStorageError,
    WarehouseIdbStorageService,
} from "./WarehouseIdbStorageService";
import {
    BARCODES_STORE,
    CATEGORIES_STORE,
    DESCRIPTIONS_STORE,
    INDEXED_PRODUCTS_STORE,
    META_STORE,
    NAMES_STORE,
    PRICES_STORE,
    PRODUCTS_STORE,
    SEARCH_TERMS_STORE,
    STOCKS_STORE,
} from "@utils/constants";

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

const createErrorRequest = (error: Error): IDBRequest<never> => {
    let errorHandler: IDBRequest<never>["onerror"] = null;

    return {
        error,
        set onerror(handler: IDBRequest<never>["onerror"]) {
            errorHandler = handler;
            queueMicrotask(() => errorHandler?.call(
                this as unknown as IDBRequest<never>,
                new Event("error"),
            ));
        },
    } as IDBRequest<never>;
};

const CATALOG_STORE_NAMES = [
    PRODUCTS_STORE,
    INDEXED_PRODUCTS_STORE,
    CATEGORIES_STORE,
    NAMES_STORE,
    STOCKS_STORE,
    PRICES_STORE,
    DESCRIPTIONS_STORE,
    BARCODES_STORE,
    SEARCH_TERMS_STORE,
    META_STORE,
] as const;

const getRecordKey = (storeName: string, record: Record<string, unknown>) => {
    if (storeName === META_STORE) {
        return record.name as string;
    }

    if (storeName === SEARCH_TERMS_STORE) {
        return `${record.term}:${record.productId}:${record.field}`;
    }

    return (record.id ?? record.productId) as string;
};

const createCatalogReplacementStorage = (
    failReplacementPut: boolean,
): WarehouseIdbStorageService => {
    const committed = new Map<string, Map<string, Record<string, unknown>>>(
        CATALOG_STORE_NAMES.map((storeName) => [storeName, new Map()]),
    );
    committed.get(PRODUCTS_STORE)?.set("previous", { id: "previous" });
    committed.get(META_STORE)?.set("productSignature", {
        name: "productSignature",
        value: "previous-signature",
    });

    const service = new WarehouseIdbStorageService();

    (service as unknown as { open: () => Promise<IDBDatabase> }).open = async () => ({
        transaction: (
            storeNames: string | string[],
            mode?: IDBTransactionMode,
        ) => {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];

            if (mode === "readonly") {
                return {
                    objectStore: (storeName: string) => ({
                        getAll: () => createRequest([
                            ...(committed.get(storeName)?.values() ?? []),
                        ]),
                        get: (key: string) => createRequest(
                            committed.get(storeName)?.get(key),
                        ),
                    }),
                } as unknown as IDBTransaction;
            }

            const staged = new Map(
                names.map((storeName) => [
                    storeName,
                    new Map(committed.get(storeName)),
                ]),
            );
            const writeError = new Error("simulated put failure");
            let aborted = false;
            let abortHandler: IDBTransaction["onabort"] = null;
            let completeHandler: IDBTransaction["oncomplete"] = null;

            const transaction = {
                objectStore: (storeName: string) => ({
                    clear: () => {
                        staged.set(storeName, new Map());
                        return createRequest(undefined);
                    },
                    put: (record: Record<string, unknown>) => {
                        if (
                            failReplacementPut
                            && storeName === PRODUCTS_STORE
                            && record.id === "replacement"
                        ) {
                            return createErrorRequest(writeError);
                        }

                        staged.get(storeName)?.set(
                            getRecordKey(storeName, record),
                            record,
                        );
                        return createRequest(record.id ?? record.productId);
                    },
                }),
                abort: () => {
                    if (aborted) {
                        return;
                    }

                    aborted = true;
                    queueMicrotask(() => abortHandler?.call(
                        transaction as IDBTransaction,
                        new Event("abort"),
                    ));
                },
                get error() {
                    return aborted ? writeError : null;
                },
                set onabort(handler: IDBTransaction["onabort"]) {
                    abortHandler = handler;
                },
                set oncomplete(handler: IDBTransaction["oncomplete"]) {
                    completeHandler = handler;
                    queueMicrotask(() => {
                        if (aborted) {
                            return;
                        }

                        for (const [storeName, records] of staged) {
                            committed.set(storeName, records);
                        }

                        completeHandler?.call(
                            transaction as IDBTransaction,
                            new Event("complete"),
                        );
                    });
                },
            } as unknown as IDBTransaction;

            return transaction;
        },
    } as unknown as IDBDatabase);

    return service;
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

    it("commits a complete replacement catalog with matching metadata", async () => {
        const service = createCatalogReplacementStorage(false);

        await service.replaceProducts([{ id: "replacement" }]);

        expect(await service.getProducts()).toEqual([{ id: "replacement" }]);
        expect(await service.getMeta("productSignature")).not.toBe(
            "previous-signature",
        );
    });

    it("keeps the previous catalog active when a replacement put fails", async () => {
        const service = createCatalogReplacementStorage(true);

        await expect(
            service.replaceProducts([{ id: "replacement" }]),
        ).rejects.toBeInstanceOf(WarehouseIdbStorageError);

        expect(await service.getProducts()).toEqual([{ id: "previous" }]);
        expect(await service.getMeta("productSignature")).toBe(
            "previous-signature",
        );
    });
});
