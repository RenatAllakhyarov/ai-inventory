import { describe, expect, it } from "vitest";
import { type WarehouseProduct } from "@services/ProductsStorageService";
import {
    DEFAULT_PRODUCT_CURRENCY,
    formatMoney,
    formatProductMoney,
    getProductPriceAmount,
    getProductPriceCurrency,
    UNAVAILABLE_PRODUCT_PRICE_LABEL,
} from "./productMoney";

const productWithPrice = (
    value?: number,
    currency?: string,
): WarehouseProduct => ({
    id: "product-1",
    salePrices: [{ value, currency }],
});

describe("product money", () => {
    it("converts a finite minor-unit sale price to a major-unit amount", () => {
        expect(getProductPriceAmount(productWithPrice(12300))).toBe(123);
    });

    it("returns no amount for unavailable or malformed sale prices", () => {
        expect(getProductPriceAmount({ id: "missing" })).toBeUndefined();
        expect(getProductPriceAmount(productWithPrice(Number.NaN))).toBeUndefined();
    });

    it("retains a supplied currency code and falls back to roubles", () => {
        expect(getProductPriceCurrency(productWithPrice(12300, "usd"))).toBe("USD");
        expect(getProductPriceCurrency(productWithPrice(12300, "bad!"))).toBe(
            DEFAULT_PRODUCT_CURRENCY,
        );
        expect(getProductPriceCurrency({
            id: "legacy-product",
            salePrices: [{ value: 12300, currency: { meta: {} } as unknown as string }],
        })).toBe(DEFAULT_PRODUCT_CURRENCY);
    });

    it("formats available prices and labels unavailable prices", () => {
        expect(formatProductMoney(productWithPrice(12300, "USD"))).toBe(
            formatMoney(123, "USD"),
        );
        expect(formatMoney(123, "usd")).toBe(formatMoney(123, "USD"));
        expect(formatProductMoney({ id: "missing" })).toBe(
            UNAVAILABLE_PRODUCT_PRICE_LABEL,
        );
    });

    it("uses the default currency for an invalid formatter currency", () => {
        expect(formatMoney(123, "invalid")).toBe(
            formatMoney(123, DEFAULT_PRODUCT_CURRENCY),
        );
    });
});
