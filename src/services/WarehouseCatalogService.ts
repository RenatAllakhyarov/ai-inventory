import { type WarehouseProduct } from "@services/ProductsStorageService";
import { type WarehouseSourceClient } from "@services/WarehouseSourceClient";

export const fetchWarehouseCatalog = async (
    sourceClient: WarehouseSourceClient,
): Promise<WarehouseProduct[]> => {
    const [products, stocks] = await Promise.all([
        sourceClient.fetchProducts(),
        sourceClient.fetchStocks(),
    ]);
    const stockByProductId = new Map<string, number>();

    for (const stock of stocks) {
        stockByProductId.set(stock.productId, stock.quantity);
    }

    return products.map((product) => ({
        ...product,
        stock: stockByProductId.get(product.id) ?? 0,
    }));
};
