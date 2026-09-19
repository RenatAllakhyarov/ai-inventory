import { WarehouseCatalogQueryService } from "./WarehouseCatalogQueryService";
import {
    ProductSearchEngine,
    type WarehouseSearchParams,
    type WarehouseSearchResult,
} from "./ProductSearchEngine";
import { type WarehouseProduct } from "./ProductsStorageService";

export type {
    WarehouseSearchParams,
    WarehouseSearchResult,
    WarehouseSortBy,
    WarehouseSortDirection,
} from "./ProductSearchEngine";

export class WarehouseProvider {
    private readonly productSearchEngine = new ProductSearchEngine();

    private readonly warehouseCatalogQueryService =
        new WarehouseCatalogQueryService();

    searchProducts = (
        products: WarehouseProduct[],
        params: WarehouseSearchParams = {},
    ): WarehouseSearchResult =>
        this.productSearchEngine.searchProducts(products, params);

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
}
