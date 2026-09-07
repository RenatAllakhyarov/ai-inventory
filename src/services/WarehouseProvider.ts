import { WarehouseCatalogQueryService } from "./WarehouseCatalogQueryService";
import { type WarehouseProduct } from "./ProductsStorageService";
import { QwenProductsService } from "./QwenProductsService";

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

interface ScoredProduct {
    product: WarehouseProduct;
    score: number;
    index: number;
}

const compareText = (left: string, right: string): number => {
    return left.localeCompare(right, "ru", {
        sensitivity: "base",
    });
};

export class WarehouseProvider {
    private readonly qwenProductsService = new QwenProductsService();

    private readonly warehouseCatalogQueryService =
        new WarehouseCatalogQueryService();

    searchProducts = (
        products: WarehouseProduct[],
        params: WarehouseSearchParams = {},
    ): WarehouseSearchResult => {
        const filteredProducts = this.applyStructuredFilters(products, params);

        const rankedProducts = this.rankProducts(
            filteredProducts,
            params.query,
        );

        const sortedProducts = this.sortProducts(rankedProducts, params);

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

    searchProductsFromStorage = async (
        params: WarehouseSearchParams = {},
        fallbackProducts: WarehouseProduct[] = [],
    ): Promise<WarehouseSearchResult> => {
        try {
            const result = await this.warehouseCatalogQueryService.executePlan(
                this.warehouseCatalogQueryService.createLookupPlan(params),
                fallbackProducts,
            );

            return {
                items: result.products,
                total: result.total,
                limit: result.limit,
                offset: result.offset,
            };
        } catch (error) {
            console.warn("Indexed warehouse search fallback:", error);
        }

        return this.searchProducts(fallbackProducts, params);
    };

    private applyStructuredFilters = (
        products: WarehouseProduct[],
        params: WarehouseSearchParams,
    ): WarehouseProduct[] => {
        const category = this.qwenProductsService.normalizeSearchText(
            params.category ?? "",
        );

        return products.filter((product) => {
            if (
                typeof params.archived === "boolean" &&
                Boolean(product.archived) !== params.archived
            ) {
                return false;
            }

            if (
                category &&
                !this.qwenProductsService
                    .normalizeSearchText(product.pathName ?? "")
                    .includes(category)
            ) {
                return false;
            }

            const stock = this.getNumericStock(product);

            if (
                params.inStockOnly &&
                !(typeof stock === "number" && stock > 0)
            ) {
                return false;
            }

            if (
                typeof params.minStock === "number" &&
                !(typeof stock === "number" && stock >= params.minStock)
            ) {
                return false;
            }

            if (
                typeof params.maxStock === "number" &&
                !(typeof stock === "number" && stock <= params.maxStock)
            ) {
                return false;
            }

            const price = this.getNumericPrice(product);

            if (
                typeof params.minPrice === "number" &&
                !(typeof price === "number" && price >= params.minPrice)
            ) {
                return false;
            }

            if (
                typeof params.maxPrice === "number" &&
                !(typeof price === "number" && price <= params.maxPrice)
            ) {
                return false;
            }

            return true;
        });
    };

    private rankProducts = (
        products: WarehouseProduct[],
        query?: string,
    ): ScoredProduct[] => {
        const normalizedQuery = this.qwenProductsService.normalizeSearchText(
            query ?? "",
        );
        const queryTokens = this.qwenProductsService.getSearchTokens(
            query ?? "",
        );

        const scoredProducts = products.map((product, index) => {
            const searchableText =
                this.qwenProductsService.getSearchableText(product);
            let score = 0;

            for (const token of queryTokens) {
                if (searchableText.includes(token)) {
                    score += token.length > 4 ? 3 : 2;
                }
            }

            if (
                product.name &&
                normalizedQuery.includes(
                    this.qwenProductsService.normalizeSearchText(product.name),
                )
            ) {
                score += 8;
            }

            if (
                product.article &&
                normalizedQuery.includes(
                    this.qwenProductsService.normalizeSearchText(
                        product.article,
                    ),
                )
            ) {
                score += 6;
            }

            if (
                product.code &&
                normalizedQuery.includes(
                    this.qwenProductsService.normalizeSearchText(product.code),
                )
            ) {
                score += 6;
            }

            return {
                product,
                score,
                index,
            };
        });

        const hasMatches = scoredProducts.some(({ score }) => score > 0);

        if (!normalizedQuery) {
            return scoredProducts;
        }

        if (!hasMatches) {
            return [];
        }

        return scoredProducts
            .filter(({ score }) => score > 0)
            .sort((left, right) => {
                if (left.score !== right.score) {
                    return right.score - left.score;
                }

                return left.index - right.index;
            });
    };

    private sortProducts = (
        products: ScoredProduct[],
        params: WarehouseSearchParams,
    ): ScoredProduct[] => {
        const sortBy = params.sortBy ?? "relevance";
        const direction = params.sortDirection ?? "asc";
        const directionMultiplier = direction === "desc" ? -1 : 1;

        if (sortBy === "relevance") {
            return [...products];
        }

        return [...products].sort((left, right) => {
            const compared = this.compareProductsByField(
                left.product,
                right.product,
                sortBy,
            );

            if (compared !== 0) {
                return compared * directionMultiplier;
            }

            return left.index - right.index;
        });
    };

    private compareProductsByField = (
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

    private getNumericStock = (
        product: WarehouseProduct,
    ): number | undefined => {
        if (typeof product.stock !== "number") {
            return undefined;
        }

        return product.stock;
    };

    private getNumericPrice = (
        product: WarehouseProduct,
    ): number | undefined => {
        const [firstSalePrice] = product.salePrices ?? [];

        if (typeof firstSalePrice?.value !== "number") {
            return undefined;
        }

        return firstSalePrice.value / 100;
    };
}
