import { type WarehouseProduct } from "./ProductsStorageService";
import { ProductTextService } from "./ProductTextService";
import { OLLAMA_EMBEDDING_MODEL } from "@api/OllamaApi";
import {
    getProductPriceAmount,
    getProductPriceCurrency,
} from "@utils/functions/productMoney";
import {
    BARCODES_STORE,
    CATEGORIES_STORE,
    DATABASE_NAME,
    DATABASE_VERSION,
    DESCRIPTIONS_STORE,
    EMBEDDINGS_STORE,
    INDEXED_PRODUCTS_STORE,
    LEGACY_SEARCH_INDEX_STORE,
    META_STORE,
    NAMES_STORE,
    PRICES_STORE,
    PRODUCTS_STORE,
    SEARCH_TERMS_STORE,
    STOCKS_STORE,
} from "@utils/constants";

export type WarehouseSearchField =
    | "name"
    | "category"
    | "description"
    | "article"
    | "code"
    | "barcode";

export interface WarehouseIndexedProductRecord {
    id: string;
    nameId?: string;
    categoryId?: string;
    descriptionId?: string;
    article?: string;
    code?: string;
    externalCode?: string;
    archived: boolean;
}

export interface WarehouseCategoryRecord {
    id: string;
    name: string;
    path: string;
    parentId?: string;
    normalizedPath: string;
    productCount: number;
    stockTotal: number;
}

export interface WarehouseNameRecord {
    id: string;
    original: string;
    normalized: string;
    tokens: string[];
}

export interface WarehouseStockRecord {
    productId: string;
    stock?: number;
}

export interface WarehousePriceRecord {
    productId: string;
    price?: number;
    currency: string;
}

export interface WarehouseDescriptionRecord {
    id: string;
    boundedText: string;
    normalized: string;
    tokens: string[];
}

export interface WarehouseBarcodeRecord {
    id: string;
    barcode: string;
    productId: string;
}

export interface WarehouseSearchTermRecord {
    term: string;
    productId: string;
    field: WarehouseSearchField;
    weight: number;
}

export interface WarehouseEmbeddingRecord {
    productId: string;
    embedding: number[];
    productSignature: string;
    model: string;
    updatedAt: number;
}

export interface WarehouseMetaRecord {
    name: string;
    value: unknown;
    updatedAt: number;
}

export interface WarehouseIndexedCatalogSnapshot {
    products: WarehouseProduct[];
    indexedProducts: WarehouseIndexedProductRecord[];
    categories: WarehouseCategoryRecord[];
    names: WarehouseNameRecord[];
    stocks: WarehouseStockRecord[];
    prices: WarehousePriceRecord[];
    descriptions: WarehouseDescriptionRecord[];
    barcodes: WarehouseBarcodeRecord[];
    searchTerms: WarehouseSearchTermRecord[];
}

export interface WarehouseTermMatch {
    record: WarehouseSearchTermRecord;
    match: "exact" | "prefix";
}

export class WarehouseIdbStorageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WarehouseIdbStorageError";
    }
}

const requestToPromise = <TValue>(
    request: IDBRequest<TValue>,
): Promise<TValue> => {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const transactionToPromise = (transaction: IDBTransaction): Promise<void> => {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
    });
};

const getStore = (
    transaction: IDBTransaction,
    database: IDBDatabase,
    name: string,
    options?: IDBObjectStoreParameters,
): IDBObjectStore => {
    if (database.objectStoreNames.contains(name)) {
        return transaction.objectStore(name);
    }

    return database.createObjectStore(name, options);
};

const createIndexIfMissing = (
    store: IDBObjectStore,
    name: string,
    keyPath: string | string[],
): void => {
    if (!store.indexNames.contains(name)) {
        store.createIndex(name, keyPath, { unique: false });
    }
};

export class WarehouseIdbStorageService {
    private databasePromise?: Promise<IDBDatabase>;

    private readonly productTextService = new ProductTextService();

    open = async (): Promise<IDBDatabase> => {
        if (!("indexedDB" in window)) {
            throw new WarehouseIdbStorageError("IndexedDB недоступен");
        }

        this.databasePromise ??= new Promise((resolve, reject) => {
            const request = window.indexedDB.open(
                DATABASE_NAME,
                DATABASE_VERSION,
            );

            request.onupgradeneeded = () => {
                if (!request.transaction) {
                    reject(
                        new WarehouseIdbStorageError(
                            "Не удалось обновить IndexedDB",
                        ),
                    );
                    return;
                }

                this.upgradeDatabase(request.result, request.transaction);
            };

            request.onsuccess = () => {
                const database = request.result;

                database.onversionchange = () => {
                    database.close();
                    this.databasePromise = undefined;
                };

                resolve(database);
            };

            request.onerror = () => reject(request.error);
            request.onblocked = () => {
                console.warn("IndexedDB upgrade blocked by another tab");
            };
        });

        return this.databasePromise;
    };

    getProducts = async (): Promise<WarehouseProduct[]> => {
        return this.getAllFromStore<WarehouseProduct>(PRODUCTS_STORE);
    };

    getProductById = async (
        productId: string,
    ): Promise<WarehouseProduct | undefined> => {
        const database = await this.open();
        const transaction = database.transaction(PRODUCTS_STORE, "readonly");

        return requestToPromise(
            transaction.objectStore(PRODUCTS_STORE).get(productId),
        ) as Promise<WarehouseProduct | undefined>;
    };

    getProductsByIds = async (
        productIds: string[],
    ): Promise<WarehouseProduct[]> => {
        if (productIds.length === 0) {
            return [];
        }

        const database = await this.open();
        const transaction = database.transaction(PRODUCTS_STORE, "readonly");
        const store = transaction.objectStore(PRODUCTS_STORE);

        const records = await Promise.all(
            productIds.map(
                (productId) =>
                    requestToPromise(store.get(productId)) as Promise<
                        WarehouseProduct | undefined
                    >,
            ),
        );

        return records.filter((record): record is WarehouseProduct =>
            Boolean(record),
        );
    };

    searchTerms = async (
        query: string,
        fields?: WarehouseSearchField[],
    ): Promise<WarehouseTermMatch[]> => {
        const tokens = this.productTextService.getSearchTokens(query);

        if (tokens.length === 0) {
            return [];
        }

        const database = await this.open();
        const transaction = database.transaction(
            SEARCH_TERMS_STORE,
            "readonly",
        );
        const index = transaction.objectStore(SEARCH_TERMS_STORE).index("term");
        const allowedFields = fields?.length ? new Set(fields) : null;
        const matches = new Map<string, WarehouseTermMatch>();

        for (const token of tokens) {
            const exactRecords = (await requestToPromise(
                index.getAll(IDBKeyRange.only(token)),
            )) as WarehouseSearchTermRecord[];

            for (const record of exactRecords) {
                if (allowedFields && !allowedFields.has(record.field)) {
                    continue;
                }

                matches.set(
                    `${record.term}:${record.productId}:${record.field}`,
                    { record, match: "exact" },
                );
            }

            if (token.length < 3) {
                continue;
            }

            const prefixRecords = (await requestToPromise(
                index.getAll(
                    IDBKeyRange.bound(token, `${token}\uffff`, false, false),
                ),
            )) as WarehouseSearchTermRecord[];

            for (const record of prefixRecords) {
                if (
                    record.term === token ||
                    !["name", "category"].includes(record.field) ||
                    (allowedFields && !allowedFields.has(record.field))
                ) {
                    continue;
                }

                const key = `${record.term}:${record.productId}:${record.field}`;
                if (!matches.has(key)) {
                    matches.set(key, { record, match: "prefix" });
                }
            }
        }

        return [...matches.values()];
    };

    getCategories = async (): Promise<WarehouseCategoryRecord[]> => {
        return this.getAllFromStore<WarehouseCategoryRecord>(CATEGORIES_STORE);
    };

    getStocks = async (): Promise<WarehouseStockRecord[]> => {
        return this.getAllFromStore<WarehouseStockRecord>(STOCKS_STORE);
    };

    getPrices = async (): Promise<WarehousePriceRecord[]> => {
        return this.getAllFromStore<WarehousePriceRecord>(PRICES_STORE);
    };

    replaceProducts = async (products: WarehouseProduct[]): Promise<void> => {
        const database = await this.open();
        const indexedCatalog = this.createIndexedCatalog(products);
        const transaction = database.transaction(
            [
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
            ],
            "readwrite",
        );

        for (const storeName of [
            PRODUCTS_STORE,
            INDEXED_PRODUCTS_STORE,
            CATEGORIES_STORE,
            NAMES_STORE,
            STOCKS_STORE,
            PRICES_STORE,
            DESCRIPTIONS_STORE,
            BARCODES_STORE,
            SEARCH_TERMS_STORE,
        ]) {
            transaction.objectStore(storeName).clear();
        }

        const putAll = <TRecord>(
            storeName: string,
            records: TRecord[],
        ): void => {
            const store = transaction.objectStore(storeName);
            for (const record of records) {
                store.put(record);
            }
        };

        putAll(PRODUCTS_STORE, products);
        putAll(INDEXED_PRODUCTS_STORE, indexedCatalog.indexedProducts);
        putAll(CATEGORIES_STORE, indexedCatalog.categories);
        putAll(NAMES_STORE, indexedCatalog.names);
        putAll(STOCKS_STORE, indexedCatalog.stocks);
        putAll(PRICES_STORE, indexedCatalog.prices);
        putAll(DESCRIPTIONS_STORE, indexedCatalog.descriptions);
        putAll(BARCODES_STORE, indexedCatalog.barcodes);
        putAll(SEARCH_TERMS_STORE, indexedCatalog.searchTerms);

        const now = Date.now();
        const metaStore = transaction.objectStore(META_STORE);

        metaStore.put({
            name: "lastProductSyncAt",
            value: now,
            updatedAt: now,
        } satisfies WarehouseMetaRecord);

        metaStore.put({
            name: "productSignature",
            value: this.getProductsSignature(products),
            updatedAt: now,
        } satisfies WarehouseMetaRecord);

        metaStore.put({
            name: "categoriesCount",
            value: indexedCatalog.categories.length,
            updatedAt: now,
        } satisfies WarehouseMetaRecord);

        await transactionToPromise(transaction);
    };

    getIndexedCatalogSnapshot =
        async (): Promise<WarehouseIndexedCatalogSnapshot> => {
            const [
                products,
                indexedProducts,
                categories,
                names,
                stocks,
                prices,
                descriptions,
                barcodes,
                searchTerms,
            ] = await Promise.all([
                this.getProducts(),
                this.getAllFromStore<WarehouseIndexedProductRecord>(
                    INDEXED_PRODUCTS_STORE,
                ),
                this.getAllFromStore<WarehouseCategoryRecord>(CATEGORIES_STORE),
                this.getAllFromStore<WarehouseNameRecord>(NAMES_STORE),
                this.getAllFromStore<WarehouseStockRecord>(STOCKS_STORE),
                this.getAllFromStore<WarehousePriceRecord>(PRICES_STORE),
                this.getAllFromStore<WarehouseDescriptionRecord>(
                    DESCRIPTIONS_STORE,
                ),
                this.getAllFromStore<WarehouseBarcodeRecord>(BARCODES_STORE),
                this.getAllFromStore<WarehouseSearchTermRecord>(
                    SEARCH_TERMS_STORE,
                ),
            ]);

            return {
                products,
                indexedProducts,
                categories,
                names,
                stocks,
                prices,
                descriptions,
                barcodes,
                searchTerms,
            };
        };

    getMeta = async <TValue>(name: string): Promise<TValue | undefined> => {
        const database = await this.open();
        const transaction = database.transaction(META_STORE, "readonly");
        const record = (await requestToPromise(
            transaction.objectStore(META_STORE).get(name),
        )) as WarehouseMetaRecord | undefined;

        return record?.value as TValue | undefined;
    };

    setMeta = async (name: string, value: unknown): Promise<void> => {
        const database = await this.open();
        const transaction = database.transaction(META_STORE, "readwrite");

        transaction.objectStore(META_STORE).put({
            name,
            value,
            updatedAt: Date.now(),
        } satisfies WarehouseMetaRecord);

        await transactionToPromise(transaction);
    };

    getEmbeddings = async (
        productSignature: string,
    ): Promise<WarehouseEmbeddingRecord[]> => {
        const database = await this.open();
        const transaction = database.transaction(EMBEDDINGS_STORE, "readonly");
        const store = transaction.objectStore(EMBEDDINGS_STORE);

        if (store.indexNames.contains("signatureModel")) {
            return requestToPromise(
                store
                    .index("signatureModel")
                    .getAll(
                        IDBKeyRange.only([
                            productSignature,
                            OLLAMA_EMBEDDING_MODEL,
                        ]),
                    ),
            ) as Promise<WarehouseEmbeddingRecord[]>;
        }

        const records = (await requestToPromise(
            store.getAll(),
        )) as WarehouseEmbeddingRecord[];

        return records.filter(
            (record) =>
                record.productSignature === productSignature &&
                record.model === OLLAMA_EMBEDDING_MODEL,
        );
    };

    replaceEmbeddings = async (
        records: WarehouseEmbeddingRecord[],
    ): Promise<void> => {
        const database = await this.open();
        const transaction = database.transaction(EMBEDDINGS_STORE, "readwrite");
        const store = transaction.objectStore(EMBEDDINGS_STORE);

        store.clear();
        for (const record of records) {
            store.put(record);
        }

        await transactionToPromise(transaction);
    };

    createIndexedCatalog = (
        products: WarehouseProduct[],
    ): Omit<WarehouseIndexedCatalogSnapshot, "products"> => {
        const categoriesById = new Map<string, WarehouseCategoryRecord>();
        const indexedProducts: WarehouseIndexedProductRecord[] = [];
        const names: WarehouseNameRecord[] = [];
        const stocks: WarehouseStockRecord[] = [];
        const prices: WarehousePriceRecord[] = [];
        const descriptions: WarehouseDescriptionRecord[] = [];
        const barcodes: WarehouseBarcodeRecord[] = [];
        const searchTerms: WarehouseSearchTermRecord[] = [];

        for (const product of products) {
            const name = product.name?.trim() ?? "";
            const categoryPath = product.pathName?.trim() ?? "";
            const categoryId = categoryPath
                ? this.createEntityId(categoryPath)
                : undefined;
            const nameId = name ? product.id : undefined;
            const descriptionText = product.description?.trim() ?? "";
            const descriptionId = descriptionText ? product.id : undefined;
            const stock = this.getNumericStock(product);
            const price = getProductPriceAmount(product);

            indexedProducts.push({
                id: product.id,
                nameId,
                categoryId,
                descriptionId,
                article: product.article,
                code: product.code,
                externalCode: product.externalCode,
                archived: Boolean(product.archived),
            });

            if (nameId) {
                names.push({
                    id: nameId,
                    original: name,
                    normalized:
                        this.productTextService.normalizeSearchText(name),
                    tokens: this.productTextService.getSearchTokens(name),
                });
            }

            stocks.push({ productId: product.id, stock });
            prices.push({
                productId: product.id,
                price,
                currency: getProductPriceCurrency(product),
            });

            if (descriptionId) {
                descriptions.push({
                    id: descriptionId,
                    boundedText: this.boundDescription(descriptionText),
                    normalized:
                        this.productTextService.normalizeSearchText(
                            descriptionText,
                        ),
                    tokens: this.productTextService.getSearchTokens(
                        descriptionText,
                    ),
                });
            }

            if (categoryId) {
                const category = categoriesById.get(categoryId) ?? {
                    id: categoryId,
                    name: this.getCategoryName(categoryPath),
                    path: categoryPath,
                    parentId: this.getParentCategoryId(categoryPath),
                    normalizedPath:
                        this.productTextService.normalizeSearchText(
                            categoryPath,
                        ),
                    productCount: 0,
                    stockTotal: 0,
                };

                category.productCount += 1;
                if (typeof stock === "number") {
                    category.stockTotal += stock;
                }
                categoriesById.set(categoryId, category);
            }

            for (const barcode of this.getBarcodes(product)) {
                barcodes.push({
                    id: `${barcode}:${product.id}`,
                    barcode,
                    productId: product.id,
                });
            }

            searchTerms.push(...this.createSearchTerms(product));
        }

        return {
            indexedProducts,
            categories: [...categoriesById.values()].sort((left, right) =>
                left.path.localeCompare(right.path, "ru", {
                    sensitivity: "base",
                }),
            ),
            names,
            stocks,
            prices,
            descriptions,
            barcodes,
            searchTerms,
        };
    };

    private getAllFromStore = async <TRecord>(
        storeName: string,
    ): Promise<TRecord[]> => {
        const database = await this.open();
        const transaction = database.transaction(storeName, "readonly");

        return requestToPromise(
            transaction.objectStore(storeName).getAll(),
        ) as Promise<TRecord[]>;
    };

    private upgradeDatabase = (
        database: IDBDatabase,
        transaction: IDBTransaction,
    ): void => {
        const productsStore = getStore(transaction, database, PRODUCTS_STORE, {
            keyPath: "id",
        });
        const indexedProductsStore = getStore(
            transaction,
            database,
            INDEXED_PRODUCTS_STORE,
            { keyPath: "id" },
        );

        createIndexIfMissing(indexedProductsStore, "categoryId", "categoryId");
        createIndexIfMissing(indexedProductsStore, "nameId", "nameId");
        createIndexIfMissing(indexedProductsStore, "archived", "archived");
        createIndexIfMissing(productsStore, "archived", "archived");

        const categoriesStore = getStore(
            transaction,
            database,
            CATEGORIES_STORE,
            { keyPath: "id" },
        );
        createIndexIfMissing(
            categoriesStore,
            "normalizedPath",
            "normalizedPath",
        );
        createIndexIfMissing(categoriesStore, "parentId", "parentId");

        const namesStore = getStore(transaction, database, NAMES_STORE, {
            keyPath: "id",
        });
        createIndexIfMissing(namesStore, "normalized", "normalized");

        const stocksStore = getStore(transaction, database, STOCKS_STORE, {
            keyPath: "productId",
        });
        createIndexIfMissing(stocksStore, "stock", "stock");

        const pricesStore = getStore(transaction, database, PRICES_STORE, {
            keyPath: "productId",
        });
        createIndexIfMissing(pricesStore, "price", "price");

        getStore(transaction, database, DESCRIPTIONS_STORE, { keyPath: "id" });

        const barcodesStore = getStore(transaction, database, BARCODES_STORE, {
            keyPath: "id",
        });
        createIndexIfMissing(barcodesStore, "barcode", "barcode");
        createIndexIfMissing(barcodesStore, "productId", "productId");

        const searchTermsStore = getStore(
            transaction,
            database,
            SEARCH_TERMS_STORE,
            { keyPath: ["term", "productId", "field"] },
        );
        createIndexIfMissing(searchTermsStore, "term", "term");
        createIndexIfMissing(searchTermsStore, "productId", "productId");
        createIndexIfMissing(searchTermsStore, "field", "field");
        createIndexIfMissing(searchTermsStore, "fieldTerm", ["field", "term"]);

        const embeddingsStore = getStore(
            transaction,
            database,
            EMBEDDINGS_STORE,
            { keyPath: "productId" },
        );
        createIndexIfMissing(
            embeddingsStore,
            "productSignature",
            "productSignature",
        );
        createIndexIfMissing(embeddingsStore, "model", "model");
        createIndexIfMissing(embeddingsStore, "signatureModel", [
            "productSignature",
            "model",
        ]);

        getStore(transaction, database, META_STORE, { keyPath: "name" });

        if (database.objectStoreNames.contains(LEGACY_SEARCH_INDEX_STORE)) {
            database.deleteObjectStore(LEGACY_SEARCH_INDEX_STORE);
        }
    };

    private createSearchTerms = (
        product: WarehouseProduct,
    ): WarehouseSearchTermRecord[] => {
        const weightedFields: Array<{
            field: WarehouseSearchField;
            value?: string;
            weight: number;
        }> = [
            { field: "name", value: product.name, weight: 8 },
            { field: "category", value: product.pathName, weight: 5 },
            { field: "description", value: product.description, weight: 2 },
            { field: "article", value: product.article, weight: 12 },
            {
                field: "code",
                value: [product.code, product.externalCode]
                    .filter(Boolean)
                    .join(" "),
                weight: 12,
            },
            {
                field: "barcode",
                value: this.getBarcodes(product).join(" "),
                weight: 14,
            },
        ];
        const records: WarehouseSearchTermRecord[] = [];

        for (const item of weightedFields) {
            const terms = new Set(
                this.productTextService.getSearchTokens(item.value ?? ""),
            );

            for (const term of terms) {
                records.push({
                    term,
                    productId: product.id,
                    field: item.field,
                    weight: item.weight,
                });
            }
        }

        return records;
    };

    private getBarcodes = (product: WarehouseProduct): string[] => {
        return (product.barcodes ?? [])
            .flatMap((barcode) => [barcode.ean13, barcode.code128, barcode.upc])
            .filter((barcode): barcode is string => Boolean(barcode));
    };

    private getNumericStock = (
        product: WarehouseProduct,
    ): number | undefined => {
        return typeof product.stock === "number" ? product.stock : undefined;
    };

    private getCategoryName = (categoryPath: string): string => {
        const parts = categoryPath
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean);

        return parts.at(-1) ?? categoryPath;
    };

    private getParentCategoryId = (
        categoryPath: string,
    ): string | undefined => {
        const parts = categoryPath
            .split("/")
            .map((part) => part.trim())
            .filter(Boolean);

        if (parts.length <= 1) {
            return undefined;
        }

        return this.createEntityId(parts.slice(0, -1).join("/"));
    };

    private createEntityId = (value: string): string => {
        return this.productTextService.normalizeSearchText(value) || "unknown";
    };

    private boundDescription = (value: string): string => {
        const normalizedValue = value.replace(/\s+/g, " ").trim();

        if (normalizedValue.length <= 220) {
            return normalizedValue;
        }

        return `${normalizedValue.slice(0, 217)}...`;
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
}
