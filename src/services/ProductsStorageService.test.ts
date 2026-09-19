import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsStorageService } from "./ProductsStorageService";

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
