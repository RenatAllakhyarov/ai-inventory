import { type WarehouseProduct } from "@services/ProductsStorageService";

export interface WarehouseStock {
    productId: string;
    quantity: number;
}

export interface WarehouseSourceClient {
    sourceName: string;
    fetchProducts: (signal?: AbortSignal) => Promise<WarehouseProduct[]>;
    fetchStocks: (signal?: AbortSignal) => Promise<WarehouseStock[]>;
    fetchCatalog: (signal?: AbortSignal) => Promise<WarehouseProduct[]>;
    checkConnection: (signal?: AbortSignal) => Promise<boolean>;
}
