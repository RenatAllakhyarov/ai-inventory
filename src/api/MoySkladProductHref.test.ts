import { describe, expect, it } from "vitest";
import { getMoySkladProductIdFromHref } from "./MoySkladProductHref";

describe("getMoySkladProductIdFromHref", () => {
    it("returns the final segment from a normal absolute URL", () => {
        expect(
            getMoySkladProductIdFromHref(
                "https://api.moysklad.ru/api/remap/1.2/entity/product/product-id?expand=owner",
            ),
        ).toBe("product-id");
    });

    it("supports relative URLs", () => {
        expect(
            getMoySkladProductIdFromHref(
                "/api/remap/1.2/entity/product/relative-id?expand=owner",
            ),
        ).toBe("relative-id");
    });

    it("preserves encoded path segments", () => {
        expect(
            getMoySkladProductIdFromHref(
                "https://api.moysklad.ru/entity/product/id%2Fwith%20encoding",
            ),
        ).toBe("id%2Fwith%20encoding");
    });

    it.each([undefined, "", "   "])("returns undefined for empty input", (href) => {
        expect(getMoySkladProductIdFromHref(href)).toBeUndefined();
    });

    it("ignores a trailing slash", () => {
        expect(
            getMoySkladProductIdFromHref(
                "https://api.moysklad.ru/entity/product/trailing-id/",
            ),
        ).toBe("trailing-id");
    });

    it("returns undefined for malformed URLs", () => {
        expect(getMoySkladProductIdFromHref("http://[malformed")).toBeUndefined();
    });
});
