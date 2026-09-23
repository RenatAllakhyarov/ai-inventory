import { describe, expect, it } from "vitest";
import { ProductTextService } from "./ProductTextService";

describe("ProductTextService", () => {
    const service = new ProductTextService();

    it("uses the shared product-money formatting in generated context", () => {
        const context = service.prepareCompactContext(
            [{ id: "product-1", salePrices: [{ value: 12300, currency: "USD" }] }],
            false,
        );

        expect(context).toContain(`price=${service.getPrice({
            id: "product-1",
            salePrices: [{ value: 12300, currency: "USD" }],
        })}`);
    });
});
