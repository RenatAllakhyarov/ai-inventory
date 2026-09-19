import { type WarehouseProduct } from "./ProductsStorageService";
import { ProductTextService } from "./ProductTextService";
import {
    type WarehouseIndexedCatalogSnapshot,
    type WarehouseSearchField,
    WarehouseIdbStorageService,
} from "./WarehouseIdbStorageService";
import {
    ProductSearchEngine,
    type WarehouseSearchParams,
    type WarehouseSortBy,
    type WarehouseSortDirection,
} from "./ProductSearchEngine";

export type WarehouseQueryType = "aggregate" | "lookup";
export type WarehouseAggregateOperation =
    | "count"
    | "list"
    | "sum"
    | "min"
    | "max";
export type WarehouseQueryTable =
    | "categories"
    | "products"
    | "stocks"
    | "prices";
export type WarehouseFilterOperator =
    | "eq"
    | "contains"
    | "gt"
    | "gte"
    | "lt"
    | "lte";

export interface WarehouseQueryFilter {
    field: string;
    operator: WarehouseFilterOperator;
    value: string | number | boolean;
}

export interface WarehouseQuerySort {
    field: WarehouseSortBy;
    direction: WarehouseSortDirection;
}

export interface WarehouseAggregateQueryPlan {
    type: "aggregate";
    operation: WarehouseAggregateOperation;
    table: WarehouseQueryTable;
    field?: string;
    filters?: WarehouseQueryFilter[];
    limit?: number;
}

export interface WarehouseLookupQueryPlan {
    type: "lookup";
    query?: string;
    fields?: WarehouseSearchField[];
    filters?: WarehouseQueryFilter[];
    sort?: WarehouseQuerySort;
    limit?: number;
    offset?: number;
    includeDescription?: boolean;
}

export type WarehouseQueryPlan =
    | WarehouseAggregateQueryPlan
    | WarehouseLookupQueryPlan;

export interface WarehouseQueryResult {
    kind: WarehouseQueryType;
    total: number;
    limit: number;
    offset: number;
    products: WarehouseProduct[];
    factsText: string;
    includeDescription: boolean;
}

const MAX_QUERY_LIMIT = 100;
const MAX_CONTEXT_PRODUCTS = 25;
const LOOKUP_FIELDS: WarehouseSearchField[] = [
    "name",
    "category",
    "description",
    "article",
    "code",
    "barcode",
];
const SORT_FIELDS: WarehouseSortBy[] = [
    "name",
    "stock",
    "price",
    "category",
    "relevance",
];
const SORT_DIRECTIONS: WarehouseSortDirection[] = ["asc", "desc"];
const AGGREGATE_OPERATIONS: WarehouseAggregateOperation[] = [
    "count",
    "list",
    "sum",
    "min",
    "max",
];
const QUERY_TABLES: WarehouseQueryTable[] = [
    "categories",
    "products",
    "stocks",
    "prices",
];
const FILTER_OPERATORS: WarehouseFilterOperator[] = [
    "eq",
    "contains",
    "gt",
    "gte",
    "lt",
    "lte",
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === "object" && value !== null && !Array.isArray(value);
};

const compareText = (left: string, right: string): number => {
    return left.localeCompare(right, "ru", { sensitivity: "base" });
};

export class WarehouseCatalogQueryService {
    private readonly productTextService = new ProductTextService();
    private readonly productSearchEngine = new ProductSearchEngine();
    private readonly warehouseIdbStorageService =
        new WarehouseIdbStorageService();

    getSchemaContext = (): string => {
        return `
ДОСТУПНАЯ СХЕМА ЛОКАЛЬНОГО СКЛАДСКОГО ИНДЕКСА:
TABLE categories: id, name, path, parentId, productCount, stockTotal
TABLE products: id, nameId, categoryId, descriptionId, article, code, externalCode, archived
TABLE names: id, original, normalized, tokens
TABLE stocks: productId, stock
TABLE prices: productId, price, currency
TABLE descriptions: id, boundedText, normalized, tokens
TABLE barcodes: barcode, productId
TABLE search_terms: term, productId, field, weight
RELATION products.categoryId -> categories.id
RELATION products.nameId -> names.id
RELATION products.descriptionId -> descriptions.id
RELATION stocks.productId -> products.id
RELATION prices.productId -> products.id
RELATION barcodes.productId -> products.id

РАЗРЕШЕННЫЙ JSON DSL:
aggregate: { "type": "aggregate", "operation": "count|list|sum|min|max", "table": "categories|products|stocks|prices", "field": "...", "filters": [], "limit": 25 }
lookup: { "type": "lookup", "query": "поисковые слова без служебных фраз", "fields": ["name","category","description","article","code","barcode"], "filters": [], "sort": {"field":"relevance|name|stock|price|category","direction":"asc|desc"}, "limit": 25 }

ВАЖНО:
- Для lookup в query оставляй только название товара, категорию, артикул, код или штрихкод.
- Не копируй весь вопрос пользователя в query, если можно выделить поисковую сущность.
- Для условий по остатку/цене используй filters.
        `.trim();
    };

    createLookupPlan = (
        params: WarehouseSearchParams,
    ): WarehouseLookupQueryPlan => {
        const filters: WarehouseQueryFilter[] = [];

        if (params.category) {
            filters.push({
                field: "category",
                operator: "contains",
                value: params.category,
            });
        }

        if (typeof params.archived === "boolean") {
            filters.push({
                field: "archived",
                operator: "eq",
                value: params.archived,
            });
        }

        if (params.inStockOnly) {
            filters.push({
                field: "stock",
                operator: "gt",
                value: 0,
            });
        }

        this.addNumberFilter(filters, "stock", "gte", params.minStock);
        this.addNumberFilter(filters, "stock", "lte", params.maxStock);
        this.addNumberFilter(filters, "price", "gte", params.minPrice);
        this.addNumberFilter(filters, "price", "lte", params.maxPrice);

        return {
            type: "lookup",
            query: params.query,
            filters,
            sort: {
                field: params.sortBy ?? "relevance",
                direction: params.sortDirection ?? "asc",
            },
            limit: params.limit,
            offset: params.offset,
        };
    };

    detectDeterministicPlan = (question: string): WarehouseQueryPlan | null => {
        const questionText =
            this.productTextService.normalizeSearchText(question);

        const wantsCount = ["сколько", "количество", "число", "count"].some(
            (token) => questionText.includes(token),
        );

        const wantsList = [
            "список",
            "перечисли",
            "какие",
            "покажи",
            "list",
        ].some((token) => questionText.includes(token));

        const mentionsCategories = ["категор", "category", "categories"].some(
            (token) => questionText.includes(token),
        );

        if (mentionsCategories && wantsCount) {
            return {
                type: "aggregate",
                operation: "count",
                table: "categories",
            };
        }

        if (mentionsCategories && wantsList) {
            return {
                type: "aggregate",
                operation: "list",
                table: "categories",
                limit: MAX_QUERY_LIMIT,
            };
        }

        const mentionsProducts = ["товар", "товаров", "позиц", "products"].some(
            (token) => questionText.includes(token),
        );

        if (mentionsProducts && wantsCount && !questionText.includes("остат")) {
            return {
                type: "aggregate",
                operation: "count",
                table: "products",
            };
        }

        return null;
    };

    validatePlan = (value: unknown): WarehouseQueryPlan | null => {
        if (!isRecord(value)) {
            return null;
        }

        if (value.type === "aggregate") {
            return this.validateAggregatePlan(value);
        }

        if (value.type === "lookup") {
            return this.validateLookupPlan(value);
        }

        return null;
    };

    executePlan = async (
        plan: WarehouseQueryPlan,
        fallbackProducts: WarehouseProduct[] = [],
    ): Promise<WarehouseQueryResult> => {
        if (plan.type === "lookup") {
            return this.executeLookupPlan(plan, fallbackProducts);
        }

        const snapshot = await this.getCatalogSnapshot(fallbackProducts);
        return this.executeAggregatePlan(plan, snapshot);
    };

    private executeLookupPlan = async (
        plan: WarehouseLookupQueryPlan,
        fallbackProducts: WarehouseProduct[],
    ): Promise<WarehouseQueryResult> => {
        const normalizedQuery = this.productTextService.normalizeSearchText(
            plan.query ?? "",
        );

        let products: WarehouseProduct[] = [];
        const scoreByProductId = new Map<string, number>();

        try {
            if (normalizedQuery) {
                const termMatches =
                    await this.warehouseIdbStorageService.searchTerms(
                        normalizedQuery,
                        plan.fields,
                    );

                for (const { record, match } of termMatches) {
                    const multiplier = match === "exact" ? 10 : 3;
                    const fieldBonus = this.getFieldBonus(record.field);
                    const current = scoreByProductId.get(record.productId) ?? 0;

                    scoreByProductId.set(
                        record.productId,
                        current + record.weight * multiplier + fieldBonus,
                    );
                }

                const rankedIds = [...scoreByProductId.entries()]
                    .sort((left, right) => right[1] - left[1])
                    .map(([productId]) => productId);

                products =
                    await this.warehouseIdbStorageService.getProductsByIds(
                        rankedIds,
                    );
            } else {
                products = await this.warehouseIdbStorageService.getProducts();
            }
        } catch (error) {
            console.warn("Indexed lookup fallback:", error);
            products = [...fallbackProducts];

            if (normalizedQuery) {
                const fallbackRanked = this.productSearchEngine.rankDslFallbackProducts(
                    products,
                    normalizedQuery,
                );

                products = fallbackRanked.map(({ product }) => product);
                for (const item of fallbackRanked) {
                    scoreByProductId.set(item.product.id, item.score);
                }
            }
        }

        if (products.length === 0 && fallbackProducts.length > 0) {
            products = normalizedQuery
                ? this.productSearchEngine.rankDslFallbackProducts(
                      fallbackProducts,
                      normalizedQuery,
                  ).map(({ product }) => product)
                : [...fallbackProducts];
        }

        const originalIndexById = new Map(
            products.map((product, index) => [product.id, index]),
        );

        const scoredProducts = products
            .filter((product) =>
                this.matchesProductFilters(product, plan.filters),
            )
            .map((product) => ({
                product,
                score: scoreByProductId.get(product.id) ?? 0,
                index: originalIndexById.get(product.id) ?? 0,
            }));

        const sortedProducts = this.productSearchEngine.sortScoredProducts(
            scoredProducts,
            plan.sort?.field,
            plan.sort?.direction,
        );
        const total = sortedProducts.length;
        const offset = Math.max(0, plan.offset ?? 0);
        const limit = this.normalizeLimit(plan.limit, total);
        const selectedProducts = sortedProducts
            .slice(offset, offset + limit)
            .map(({ product }) => product);
        const includeDescription = Boolean(plan.includeDescription);

        return {
            kind: "lookup",
            total,
            limit,
            offset,
            products: selectedProducts,
            factsText: this.createProductFactsText(
                selectedProducts,
                total,
                includeDescription,
            ),
            includeDescription,
        };
    };

    private executeAggregatePlan = (
        plan: WarehouseAggregateQueryPlan,
        snapshot: WarehouseIndexedCatalogSnapshot,
    ): WarehouseQueryResult => {
        if (plan.table === "categories") {
            return this.executeCategoryAggregate(plan, snapshot);
        }

        if (plan.table === "products") {
            return this.executeProductAggregate(plan, snapshot);
        }

        if (plan.table === "stocks") {
            return this.executeNumericAggregate(
                plan,
                snapshot,
                "stock",
                snapshot.stocks
                    .filter((record) => typeof record.stock === "number")
                    .map((record) => ({
                        productId: record.productId,
                        value: record.stock as number,
                    })),
            );
        }

        return this.executeNumericAggregate(
            plan,
            snapshot,
            "price",
            snapshot.prices
                .filter((record) => typeof record.price === "number")
                .map((record) => ({
                    productId: record.productId,
                    value: record.price as number,
                })),
        );
    };

    private executeCategoryAggregate = (
        plan: WarehouseAggregateQueryPlan,
        snapshot: WarehouseIndexedCatalogSnapshot,
    ): WarehouseQueryResult => {
        const categories = snapshot.categories
            .filter((category) =>
                this.matchesFilters(
                    {
                        category: category.path,
                        name: category.name,
                        stock: category.stockTotal,
                        productCount: category.productCount,
                    },
                    plan.filters,
                ),
            )
            .sort((left, right) => compareText(left.path, right.path));

        const limit = this.normalizeLimit(plan.limit, categories.length);
        const limited = categories.slice(0, limit);

        if (plan.operation === "count") {
            return this.aggregateResult(
                categories.length,
                limit,
                `ТИП: categories.count\nВСЕГО КАТЕГОРИЙ: ${categories.length}`,
            );
        }

        if (plan.operation === "list") {
            return this.aggregateResult(
                categories.length,
                limit,
                [
                    "ТИП: categories.list",
                    `ВСЕГО КАТЕГОРИЙ: ${categories.length}`,
                    "",
                    ...limited.map(
                        (category, index) =>
                            `${index + 1}. ${category.path} | products=${category.productCount} | stockTotal=${category.stockTotal}`,
                    ),
                ].join("\n"),
            );
        }

        const values = categories.map((category) =>
            plan.field === "productCount"
                ? category.productCount
                : category.stockTotal,
        );

        return this.numericAggregateResult(
            plan,
            "categories",
            values,
            categories.length,
            limit,
        );
    };

    private executeProductAggregate = (
        plan: WarehouseAggregateQueryPlan,
        snapshot: WarehouseIndexedCatalogSnapshot,
    ): WarehouseQueryResult => {
        const products = snapshot.products.filter((product) =>
            this.matchesProductFilters(product, plan.filters),
        );
        const limit = this.normalizeLimit(plan.limit, products.length);

        if (plan.operation === "count") {
            return this.aggregateResult(
                products.length,
                limit,
                `ТИП: products.count\nВСЕГО ТОВАРОВ: ${products.length}`,
            );
        }

        if (plan.operation === "list") {
            const selected = products.slice(0, limit);
            return {
                kind: "aggregate",
                total: products.length,
                limit,
                offset: 0,
                products: selected,
                factsText: [
                    "АКТУАЛЬНЫЙ СКЛАДСКОЙ АГРЕГАТ:",
                    "ТИП: products.list",
                    `ВСЕГО ТОВАРОВ: ${products.length}`,
                    "",
                    this.productTextService.prepareCompactContext(
                        selected,
                        false,
                    ),
                ].join("\n"),
                includeDescription: false,
            };
        }

        const values = products
            .map((product) =>
                plan.field === "price"
                    ? this.productSearchEngine.getNumericPrice(product)
                    : this.productSearchEngine.getNumericStock(product),
            )
            .filter((value): value is number => typeof value === "number");

        return this.numericAggregateResult(
            plan,
            "products",
            values,
            products.length,
            limit,
        );
    };

    private executeNumericAggregate = (
        plan: WarehouseAggregateQueryPlan,
        snapshot: WarehouseIndexedCatalogSnapshot,
        field: "stock" | "price",
        rows: Array<{ productId: string; value: number }>,
    ): WarehouseQueryResult => {
        const productsById = new Map(
            snapshot.products.map((product) => [product.id, product]),
        );

        const filteredRows = rows.filter((row) => {
            const product = productsById.get(row.productId);
            if (!product) {
                return false;
            }

            return this.matchesProductFilters(product, plan.filters);
        });

        const limit = this.normalizeLimit(plan.limit, filteredRows.length);

        if (plan.operation === "count") {
            return this.aggregateResult(
                filteredRows.length,
                limit,
                `ТИП: ${plan.table}.count\nВСЕГО ЗАПИСЕЙ: ${filteredRows.length}`,
            );
        }

        if (plan.operation === "list") {
            const selectedRows = filteredRows.slice(0, limit);
            const lines = selectedRows.map((row, index) => {
                const product = productsById.get(row.productId);
                return `${index + 1}. ${product?.name ?? row.productId} | ${field}=${row.value}`;
            });

            return this.aggregateResult(
                filteredRows.length,
                limit,
                [
                    `ТИП: ${plan.table}.list`,
                    `ВСЕГО ЗАПИСЕЙ: ${filteredRows.length}`,
                    "",
                    ...lines,
                ].join("\n"),
            );
        }

        return this.numericAggregateResult(
            plan,
            plan.table,
            filteredRows.map((row) => row.value),
            filteredRows.length,
            limit,
        );
    };

    private numericAggregateResult = (
        plan: WarehouseAggregateQueryPlan,
        table: WarehouseQueryTable,
        values: number[],
        total: number,
        limit: number,
    ): WarehouseQueryResult => {
        let value: number | null = null;

        if (plan.operation === "sum") {
            value = values.reduce((sum, current) => sum + current, 0);
        } else if (plan.operation === "min") {
            value = values.length > 0 ? Math.min(...values) : null;
        } else if (plan.operation === "max") {
            value = values.length > 0 ? Math.max(...values) : null;
        }

        return this.aggregateResult(
            total,
            limit,
            [
                `ТИП: ${table}.${plan.operation}`,
                `ЗАПИСЕЙ: ${values.length}`,
                `ЗНАЧЕНИЕ: ${value ?? "нет данных"}`,
            ].join("\n"),
        );
    };

    private aggregateResult = (
        total: number,
        limit: number,
        body: string,
    ): WarehouseQueryResult => {
        return {
            kind: "aggregate",
            total,
            limit,
            offset: 0,
            products: [],
            factsText: `АКТУАЛЬНЫЙ СКЛАДСКОЙ АГРЕГАТ:\n${body}`,
            includeDescription: false,
        };
    };

    private getCatalogSnapshot = async (
        fallbackProducts: WarehouseProduct[],
    ): Promise<WarehouseIndexedCatalogSnapshot> => {
        try {
            const snapshot =
                await this.warehouseIdbStorageService.getIndexedCatalogSnapshot();

            if (
                snapshot.products.length > 0 &&
                snapshot.indexedProducts.length > 0
            ) {
                return snapshot;
            }
        } catch (error) {
            console.warn("Indexed catalog fallback:", error);
        }

        if (fallbackProducts.length === 0) {
            return {
                products: [],
                indexedProducts: [],
                categories: [],
                names: [],
                stocks: [],
                prices: [],
                descriptions: [],
                barcodes: [],
                searchTerms: [],
            };
        }

        return {
            products: fallbackProducts,
            ...this.warehouseIdbStorageService.createIndexedCatalog(
                fallbackProducts,
            ),
        };
    };

    private validateAggregatePlan = (
        value: Record<string, unknown>,
    ): WarehouseAggregateQueryPlan | null => {
        if (
            typeof value.operation !== "string" ||
            !AGGREGATE_OPERATIONS.includes(
                value.operation as WarehouseAggregateOperation,
            ) ||
            typeof value.table !== "string" ||
            !QUERY_TABLES.includes(value.table as WarehouseQueryTable)
        ) {
            return null;
        }

        const filters = this.validateFilters(value.filters);
        if (filters === null) {
            return null;
        }

        return {
            type: "aggregate",
            operation: value.operation as WarehouseAggregateOperation,
            table: value.table as WarehouseQueryTable,
            field: typeof value.field === "string" ? value.field : undefined,
            filters,
            limit: this.validateLimit(value.limit),
        };
    };

    private validateLookupPlan = (
        value: Record<string, unknown>,
    ): WarehouseLookupQueryPlan | null => {
        const filters = this.validateFilters(value.filters);
        if (filters === null) {
            return null;
        }

        const plan: WarehouseLookupQueryPlan = {
            type: "lookup",
            query:
                typeof value.query === "string"
                    ? value.query.trim()
                    : undefined,
            filters,
            limit: this.validateLimit(value.limit),
            includeDescription:
                typeof value.includeDescription === "boolean"
                    ? value.includeDescription
                    : undefined,
        };

        if (Array.isArray(value.fields)) {
            const fields = value.fields.filter(
                (field): field is WarehouseSearchField =>
                    typeof field === "string" &&
                    LOOKUP_FIELDS.includes(field as WarehouseSearchField),
            );

            if (fields.length !== value.fields.length) {
                return null;
            }
            plan.fields = fields;
        }

        if (isRecord(value.sort)) {
            if (
                typeof value.sort.field !== "string" ||
                !SORT_FIELDS.includes(value.sort.field as WarehouseSortBy) ||
                typeof value.sort.direction !== "string" ||
                !SORT_DIRECTIONS.includes(
                    value.sort.direction as WarehouseSortDirection,
                )
            ) {
                return null;
            }

            plan.sort = {
                field: value.sort.field as WarehouseSortBy,
                direction: value.sort.direction as WarehouseSortDirection,
            };
        }

        const hasSignal = Boolean(
            plan.query || (plan.filters && plan.filters.length > 0),
        );

        return hasSignal ? plan : null;
    };

    private validateFilters = (
        value: unknown,
    ): WarehouseQueryFilter[] | null | undefined => {
        if (typeof value === "undefined") {
            return undefined;
        }
        if (!Array.isArray(value)) {
            return null;
        }

        const filters: WarehouseQueryFilter[] = [];

        for (const item of value) {
            if (
                !isRecord(item) ||
                typeof item.field !== "string" ||
                typeof item.operator !== "string" ||
                !FILTER_OPERATORS.includes(
                    item.operator as WarehouseFilterOperator,
                ) ||
                !["string", "number", "boolean"].includes(typeof item.value)
            ) {
                return null;
            }

            filters.push({
                field: item.field,
                operator: item.operator as WarehouseFilterOperator,
                value: item.value as string | number | boolean,
            });
        }

        return filters;
    };

    private validateLimit = (value: unknown): number | undefined => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return undefined;
        }

        return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(value)));
    };

    private getFieldBonus = (field: WarehouseSearchField): number => {
        if (field === "barcode") {
            return 100;
        }
        if (field === "article" || field === "code") {
            return 80;
        }
        if (field === "name") {
            return 40;
        }
        if (field === "category") {
            return 15;
        }
        return 0;
    };

    private matchesProductFilters = (
        product: WarehouseProduct,
        filters?: WarehouseQueryFilter[],
    ): boolean => {
        return this.matchesFilters(
            {
                name: product.name ?? "",
                category: product.pathName ?? "",
                description: product.description ?? "",
                article: product.article ?? "",
                code: [product.code, product.externalCode]
                    .filter(Boolean)
                    .join(" "),
                barcode: this.productTextService.getBarcode(product),
                stock: this.productSearchEngine.getNumericStock(product),
                price: this.productSearchEngine.getNumericPrice(product),
                archived: Boolean(product.archived),
            },
            filters,
        );
    };

    private matchesFilters = (
        values: Record<string, string | number | boolean | undefined>,
        filters?: WarehouseQueryFilter[],
    ): boolean => {
        if (!filters || filters.length === 0) {
            return true;
        }

        return filters.every((filter) => {
            const value = values[filter.field];
            if (typeof value === "undefined") {
                return false;
            }

            if (filter.operator === "eq") {
                if (
                    typeof value === "string" &&
                    typeof filter.value === "string"
                ) {
                    return (
                        this.productTextService.normalizeSearchText(value) ===
                        this.productTextService.normalizeSearchText(
                            filter.value,
                        )
                    );
                }
                return value === filter.value;
            }

            if (filter.operator === "contains") {
                return this.productTextService
                    .normalizeSearchText(String(value))
                    .includes(
                        this.productTextService.normalizeSearchText(
                            String(filter.value),
                        ),
                    );
            }

            if (typeof value !== "number" || typeof filter.value !== "number") {
                return false;
            }

            if (filter.operator === "gt") {
                return value > filter.value;
            }
            if (filter.operator === "gte") {
                return value >= filter.value;
            }
            if (filter.operator === "lt") {
                return value < filter.value;
            }
            return value <= filter.value;
        });
    };

    private createProductFactsText = (
        products: WarehouseProduct[],
        total: number,
        includeDescription: boolean,
    ): string => {
        return `
АКТУАЛЬНЫЙ СКЛАДСКОЙ КОНТЕКСТ:
ТИП: products.lookup
ВСЕГО СОВПАДЕНИЙ В ЛОКАЛЬНОМ ИНДЕКСЕ: ${total}
ПЕРЕДАНО ТОВАРОВ: ${products.length}
ФОРМАТ ТОВАРОВ:
name | stock | price | category${includeDescription ? " | bounded description" : ""}

ТОВАРЫ:

${this.productTextService.prepareCompactContext(products, includeDescription)}
        `.trim();
    };

    private normalizeLimit = (
        limit: number | undefined,
        total: number,
    ): number => {
        if (typeof limit !== "number") {
            return Math.min(total, MAX_CONTEXT_PRODUCTS);
        }

        return Math.max(0, Math.min(total, limit));
    };

    private addNumberFilter = (
        filters: WarehouseQueryFilter[],
        field: string,
        operator: WarehouseFilterOperator,
        value: number | undefined,
    ): void => {
        if (typeof value === "number") {
            filters.push({ field, operator, value });
        }
    };

}
