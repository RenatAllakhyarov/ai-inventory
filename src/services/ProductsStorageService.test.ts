import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ProductsStorageService,
    type WarehouseProduct,
} from "./ProductsStorageService";

const storageKey = "warehouse_products";

const createStorage = (): Storage => {
    const values = new Map<string, string>();

    return {
        getItem: vi.fn((key: string): string | null => values.get(key) ?? null),
        setItem: vi.fn((key: string, value: string): void => {
            values.set(key, value);
        }),
        removeItem: vi.fn((key: string): void => {
            values.delete(key);
        }),
        clear: vi.fn((): void => {
            values.clear();
        }),
        key: vi.fn((): null => null),
        length: 0,
    } as Storage;
};

const createProduct = (
    overrides: Partial<WarehouseProduct> = {},
): WarehouseProduct => ({
    id: "product-1",
    name: "Товар",
    externalCode: "external-1",
    salePrices: [{ value: 100 }, { value: 200 }],
    barcodes: [
        { ean13: "4600000000001" },
        { code128: "CODE-128" },
    ],
    ...overrides,
});

describe("ProductsStorageService.getProductsFromStorage", () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createStorage();
        vi.stubGlobal("localStorage", storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("clears corrupted JSON and returns a controlled empty result", () => {
        storage.setItem(storageKey, "{not-json");
        const service = new ProductsStorageService();
        let result: ReturnType<
            ProductsStorageService["getProductsFromStorage"]
        > | undefined;

        expect(() => {
            result = service.getProductsFromStorage();
        }).not.toThrow();

        expect(result).toEqual({
            products: [],
            isInvalid: true,
        });
        expect(storage.removeItem).toHaveBeenCalledWith(storageKey);
    });

    it("clears incompatible stored products and returns a controlled empty result", () => {
        storage.setItem(storageKey, JSON.stringify([{ name: "Без ID" }]));
        const service = new ProductsStorageService();
        const result = service.getProductsFromStorage();

        expect(result).toEqual({
            products: [],
            isInvalid: true,
        });
        expect(storage.removeItem).toHaveBeenCalledWith(storageKey);
    });
});

describe("ProductsStorageService.compareProducts", () => {
    const service = new ProductsStorageService();

    it("returns false for equivalent products with reordered collections", () => {
        const oldProducts = [createProduct()];
        const newProducts = [
            createProduct({
                salePrices: [{ value: 200 }, { value: 100 }],
                barcodes: [
                    { code128: "CODE-128" },
                    { ean13: "4600000000001" },
                ],
            }),
        ];

        expect(service.compareProducts(oldProducts, newProducts)).toBe(false);
    });

    it("returns true when products are added or removed", () => {
        expect(
            service.compareProducts(
                [createProduct()],
                [createProduct(), createProduct({ id: "product-2" })],
            ),
        ).toBe(true);
        expect(service.compareProducts([createProduct()], [])).toBe(true);
    });

    it("returns true when the external code changes", () => {
        expect(
            service.compareProducts(
                [createProduct()],
                [createProduct({ externalCode: "external-2" })],
            ),
        ).toBe(true);
    });

    it("returns true when sale prices change", () => {
        expect(
            service.compareProducts(
                [createProduct()],
                [createProduct({ salePrices: [{ value: 300 }] })],
            ),
        ).toBe(true);
    });

    it("returns true when barcodes change", () => {
        expect(
            service.compareProducts(
                [createProduct()],
                [createProduct({ barcodes: [{ upc: "012345678905" }] })],
            ),
        ).toBe(true);
    });
});
