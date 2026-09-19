import { type WarehouseProduct } from "@services/ProductsStorageService";

export interface WarehouseStock {
    productId: string;
    quantity: number;
}

export interface WarehouseSourceClient {
    sourceName: string;
    fetchProducts: () => Promise<WarehouseProduct[]>;
    fetchStocks: () => Promise<WarehouseStock[]>;
    checkConnection: () => Promise<boolean>;
}
