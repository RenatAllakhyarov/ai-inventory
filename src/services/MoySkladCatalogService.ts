import { fetchWarehouseApi } from "@api/MoySkladApi";
import { type WarehouseProduct } from "@services/ProductsStorageService";
import {
    type MoySkladStockResponse,
    type WarehouseProductsResponse,
} from "../types";

const getProductIdFromHref = (href?: string): string | undefined => {
    if (!href) {
        return undefined;
    }

    const cleanHref = href.split("?")[0].replace(/\/$/, "");

    const parts = cleanHref.split("/");

    return parts.at(-1);
};

export const fetchMoySkladCatalog = async (): Promise<WarehouseProduct[]> => {
    const [productsData, stockData] = await Promise.all([
        fetchWarehouseApi<WarehouseProductsResponse<WarehouseProduct>>(
            "/entity/product?limit=1000",
        ),
        fetchWarehouseApi<MoySkladStockResponse>(
            "/report/stock/all?limit=1000",
        ),
    ]);

    const productRows = productsData.rows ?? [];
    const stockRows = stockData.rows ?? [];
    const stockByProductId = new Map<string, number>();

    for (const stockRow of stockRows) {
        const productId = getProductIdFromHref(
            stockRow.assortment?.meta?.href,
        );

        if (!productId) {
            continue;
        }

        const stock =
            typeof stockRow.quantity === "number" ? stockRow.quantity : 0;

        stockByProductId.set(productId, stock);
    }

    return productRows.map((product) => ({
        ...product,
        stock: stockByProductId.get(product.id) ?? 0,
    }));
};
