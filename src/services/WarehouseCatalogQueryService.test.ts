import { describe, expect, it } from "vitest";
import { WarehouseCatalogQueryService } from "./WarehouseCatalogQueryService";

describe("WarehouseCatalogQueryService.validatePlan", () => {
    const service = new WarehouseCatalogQueryService();

    it("accepts a valid lookup DSL plan", () => {
        expect(service.validatePlan({ type: "lookup", query: "кабель", limit: 10 }))
            .toMatchObject({ type: "lookup", query: "кабель", limit: 10 });
    });

    it("rejects unknown and malformed DSL plans", () => {
        expect(service.validatePlan({ type: "unknown" })).toBeNull();
        expect(service.validatePlan("lookup")).toBeNull();
    });
});
