import { type WarehouseProduct } from "./ProductsStorageService";
import { ProductTextService } from "./ProductTextService";
import { getProductPriceAmount } from "@utils/functions/productMoney";

export type WarehouseSortBy =
    | "name"
    | "stock"
    | "price"
    | "category"
    | "relevance";

export type WarehouseSortDirection = "asc" | "desc";

export interface WarehouseSearchParams {
    query?: string;
    category?: string;
    inStockOnly?: boolean;
    archived?: boolean;
    minStock?: number;
    maxStock?: number;
    minPrice?: number;
    maxPrice?: number;
    limit?: number;
    offset?: number;
    sortBy?: WarehouseSortBy;
    sortDirection?: WarehouseSortDirection;
}

export interface WarehouseSearchResult {
    items: WarehouseProduct[];
    total: number;
    limit: number;
    offset: number;
}

export interface ScoredProduct {
    product: WarehouseProduct;
    score: number;
    index: number;
}

const compareText = (left: string, right: string): number =>
    left.localeCompare(right, "ru", { sensitivity: "base" });

export class ProductSearchEngine {
    private readonly productTextService = new ProductTextService();

    searchProducts = (
        products: WarehouseProduct[],
        params: WarehouseSearchParams = {},
    ): WarehouseSearchResult => {
        const filteredProducts = this.applyStructuredFilters(products, params);
        const rankedProducts = this.rankProviderProducts(
            filteredProducts,
            params.query,
        );
        const sortedProducts = this.sortScoredProducts(
            rankedProducts,
            params.sortBy,
            params.sortDirection,
            false,
        );
        const total = sortedProducts.length;
        const offset = Math.max(0, params.offset ?? 0);
        const limit = Math.max(0, params.limit ?? total);

        return {
            items: sortedProducts
                .slice(offset, offset + limit)
                .map(({ product }) => product),
            total,
            limit,
            offset,
        };
    };

    rankProviderProducts = (
        products: WarehouseProduct[],
        query?: string,
    ): ScoredProduct[] => {
        const normalizedQuery = this.productTextService.normalizeSearchText(
            query ?? "",
        );
        const queryTokens = this.productTextService.getSearchTokens(
            query ?? "",
        );
        const scoredProducts = products.map((product, index) => {
            const searchableText =
                this.productTextService.getSearchableText(product);
            let score = 0;

            for (const token of queryTokens) {
                if (searchableText.includes(token)) {
                    score += token.length > 4 ? 3 : 2;
                }
            }

            if (
                product.name
                && normalizedQuery.includes(
                    this.productTextService.normalizeSearchText(product.name),
                )
            ) {
                score += 8;
            }

            if (
                product.article
                && normalizedQuery.includes(
                    this.productTextService.normalizeSearchText(product.article),
                )
            ) {
                score += 6;
            }

            if (
                product.code
                && normalizedQuery.includes(
                    this.productTextService.normalizeSearchText(product.code),
                )
            ) {
                score += 6;
            }

            return { product, score, index };
        });

        if (!normalizedQuery) {
            return scoredProducts;
        }

        if (!scoredProducts.some(({ score }) => score > 0)) {
            return [];
        }

        return scoredProducts
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score || left.index - right.index);
    };

    rankDslFallbackProducts = (
        products: WarehouseProduct[],
        query: string,
    ): ScoredProduct[] => {
        const queryTokens = this.productTextService.getSearchTokens(query);

        return products
            .map((product, index) => {
                const nameTokens = new Set(
                    this.productTextService.getSearchTokens(product.name ?? ""),
                );
                const categoryTokens = new Set(
                    this.productTextService.getSearchTokens(product.pathName ?? ""),
                );
                const descriptionTokens = new Set(
                    this.productTextService.getSearchTokens(
                        product.description ?? "",
                    ),
                );
                const exactIdentifiers = new Set(
                    [
                        product.article,
                        product.code,
                        product.externalCode,
                        ...(product.barcodes ?? []).flatMap((barcode) => [
                            barcode.ean13,
                            barcode.code128,
                            barcode.upc,
                        ]),
                    ]
                        .filter((value): value is string => Boolean(value))
                        .flatMap((value) =>
                            this.productTextService.getSearchTokens(value),
                        ),
                );
                let score = 0;

                for (const token of queryTokens) {
                    if (exactIdentifiers.has(token)) {
                        score += 120;
                    }
                    if (nameTokens.has(token)) {
                        score += 40;
                    } else if (
                        token.length >= 3
                        && [...nameTokens].some((term) => term.startsWith(token))
                    ) {
                        score += 15;
                    }
                    if (categoryTokens.has(token)) {
                        score += 15;
                    }
                    if (descriptionTokens.has(token)) {
                        score += 3;
                    }
                }

                return { product, score, index };
            })
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score || left.index - right.index);
    };

    sortScoredProducts = (
        products: ScoredProduct[],
        sortBy: WarehouseSortBy = "relevance",
        direction: WarehouseSortDirection = "asc",
        sortRelevance = true,
    ): ScoredProduct[] => {
        if (sortBy === "relevance") {
            if (!sortRelevance) {
                return [...products];
            }

            return [...products].sort(
                (left, right) => right.score - left.score || left.index - right.index,
            );
        }

        const directionMultiplier = direction === "desc" ? -1 : 1;

        return [...products].sort((left, right) => {
            const compared = this.compareProductsByField(
                left.product,
                right.product,
                sortBy,
            );

            return compared !== 0
                ? compared * directionMultiplier
                : left.index - right.index;
        });
    };

    compareProductsByField = (
        left: WarehouseProduct,
        right: WarehouseProduct,
        sortBy: Exclude<WarehouseSortBy, "relevance">,
    ): number => {
        if (sortBy === "name") {
            return compareText(left.name ?? "", right.name ?? "");
        }

        if (sortBy === "category") {
            return compareText(left.pathName ?? "", right.pathName ?? "");
        }

        if (sortBy === "stock") {
            return this.compareOptionalNumbers(
                this.getNumericStock(left),
                this.getNumericStock(right),
            );
        }

        return this.compareOptionalNumbers(
            this.getNumericPrice(left),
            this.getNumericPrice(right),
        );
    };

    getNumericStock = (product: WarehouseProduct): number | undefined =>
        typeof product.stock === "number" ? product.stock : undefined;

    getNumericPrice = (product: WarehouseProduct): number | undefined =>
        getProductPriceAmount(product);

    private applyStructuredFilters = (
        products: WarehouseProduct[],
        params: WarehouseSearchParams,
    ): WarehouseProduct[] => {
        const category = this.productTextService.normalizeSearchText(
            params.category ?? "",
        );

        return products.filter((product) => {
            if (
                typeof params.archived === "boolean"
                && Boolean(product.archived) !== params.archived
            ) {
                return false;
            }

            if (
                category
                && !this.productTextService
                    .normalizeSearchText(product.pathName ?? "")
                    .includes(category)
            ) {
                return false;
            }

            const stock = this.getNumericStock(product);
            const price = this.getNumericPrice(product);

            return !(
                (params.inStockOnly && !(typeof stock === "number" && stock > 0))
                || (typeof params.minStock === "number"
                    && !(typeof stock === "number" && stock >= params.minStock))
                || (typeof params.maxStock === "number"
                    && !(typeof stock === "number" && stock <= params.maxStock))
                || (typeof params.minPrice === "number"
                    && !(typeof price === "number" && price >= params.minPrice))
                || (typeof params.maxPrice === "number"
                    && !(typeof price === "number" && price <= params.maxPrice))
            );
        });
    };

    private compareOptionalNumbers = (
        left?: number,
        right?: number,
    ): number => {
        if (typeof left !== "number" && typeof right !== "number") {
            return 0;
        }

        if (typeof left !== "number") {
            return 1;
        }

        if (typeof right !== "number") {
            return -1;
        }

        return left - right;
    };
}
