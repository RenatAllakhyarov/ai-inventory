import { describe, expect, it } from "vitest";
import { WarehouseProvider } from "./WarehouseProvider";

describe("WarehouseProvider", () => {
    const provider = new WarehouseProvider();
    const products = [
        { id: "1", name: "Кабель USB", stock: 2 },
        { id: "2", name: "Кабель USB-C", stock: 8 },
        { id: "3", name: "Адаптер", stock: 1 },
    ];

    it("ranks exact product matches before partial matches", () => {
        expect(provider.searchProducts(products, { query: "кабель usb" }).items)
            .toMatchObject([{ id: "1" }, { id: "2" }]);
    });

    it("applies stock sorting", () => {
        expect(provider.searchProducts(products, {
            sortBy: "stock",
            sortDirection: "desc",
        }).items[0]).toMatchObject({ id: "2" });
    });
});
