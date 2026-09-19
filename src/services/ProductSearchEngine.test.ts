import { describe, expect, it } from "vitest";
import { ProductSearchEngine } from "./ProductSearchEngine";
import { type WarehouseProduct } from "./ProductsStorageService";

const createProduct = (
    id: string,
    overrides: Partial<WarehouseProduct> = {},
): WarehouseProduct => ({
    id,
    ...overrides,
});

const productIds = (
    products: ReturnType<ProductSearchEngine["sortScoredProducts"]>,
): string[] => products.map(({ product }) => product.id);

describe("ProductSearchEngine", () => {
    const engine = new ProductSearchEngine();

    it("preserves provider ranking scores and stable ties", () => {
        const rankedProducts = engine.rankProviderProducts(
            [
                createProduct("first", { name: "Молоко" }),
                createProduct("second", { name: "Молоко" }),
            ],
            "молоко",
        );

        expect(productIds(rankedProducts)).toEqual(["first", "second"]);
    });

    it("ranks DSL fallback exact identifiers above name matches", () => {
        const rankedProducts = engine.rankDslFallbackProducts(
            [
                createProduct("name", { name: "SKU 42" }),
                createProduct("code", { code: "SKU-42" }),
            ],
            "sku 42",
        );

        expect(productIds(rankedProducts)).toEqual(["code", "name"]);
    });

    it("sorts by text and preserves original indexes for equal values", () => {
        const sortedProducts = engine.sortScoredProducts(
            [
                { product: createProduct("first", { name: "Товар" }), score: 0, index: 0 },
                { product: createProduct("second", { name: "Товар" }), score: 0, index: 1 },
                { product: createProduct("third", { name: "Альфа" }), score: 0, index: 2 },
            ],
            "name",
        );

        expect(productIds(sortedProducts)).toEqual(["third", "first", "second"]);
    });

    it("sorts by category", () => {
        const sortedProducts = engine.sortScoredProducts(
            [
                {
                    product: createProduct("dairy", { pathName: "Молочные" }),
                    score: 0,
                    index: 0,
                },
                {
                    product: createProduct("bakery", { pathName: "Выпечка" }),
                    score: 0,
                    index: 1,
                },
            ],
            "category",
        );

        expect(productIds(sortedProducts)).toEqual(["bakery", "dairy"]);
    });

    it("sorts missing stock and price values after numeric values", () => {
        const sortedByStock = engine.sortScoredProducts(
            [
                { product: createProduct("missing"), score: 0, index: 0 },
                { product: createProduct("stock", { stock: 3 }), score: 0, index: 1 },
            ],
            "stock",
        );
        const sortedByPrice = engine.sortScoredProducts(
            [
                { product: createProduct("missing"), score: 0, index: 0 },
                {
                    product: createProduct("price", {
                        salePrices: [{ value: 12300 }],
                    }),
                    score: 0,
                    index: 1,
                },
            ],
            "price",
        );

        expect(productIds(sortedByStock)).toEqual(["stock", "missing"]);
        expect(productIds(sortedByPrice)).toEqual(["price", "missing"]);
        expect(
            engine.getNumericPrice(createProduct("price", {
                salePrices: [{ value: 12300 }],
            })),
        ).toBe(123);
    });
});
