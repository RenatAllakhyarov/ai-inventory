import { describe, expect, it } from "vitest";
import { WarehouseIdbStorageService } from "./WarehouseIdbStorageService";

describe("WarehouseIdbStorageService", () => {
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
});
