const STORAGE_KEY = "warehouse_products";

export interface WarehouseProduct {
    id: string;
    name?: string;
    description?: string;
    code?: string;
    externalCode?: string;
    archived?: boolean;
    article?: string;
    pathName?: string;
    stock?: number;
    salePrices?: Array<{
        value?: number;
    }>;
    barcodes?: Array<{
        ean13?: string;
        code128?: string;
        upc?: string;
    }>;
}

export class ProductsStorageService {
    saveProductsToStorage = (products: WarehouseProduct[]): void => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    };

    getProductsFromStorage = (): WarehouseProduct[] => {
        const data = localStorage.getItem(STORAGE_KEY);

        if (!data) {
            return [];
        }

        return JSON.parse(data) as WarehouseProduct[];
    };

    compareProducts = (
        oldProducts: WarehouseProduct[],
        newProducts: WarehouseProduct[],
    ): boolean => {
        if (oldProducts.length !== newProducts.length) {
            return true;
        }

        for (const newProduct of newProducts) {
            const oldProduct = oldProducts.find(
                (item) => item.id === newProduct.id,
            );

            if (!oldProduct) {
                return true;
            }

            if (
                oldProduct.name !== newProduct.name ||
                oldProduct.description !== newProduct.description ||
                oldProduct.code !== newProduct.code ||
                oldProduct.archived !== newProduct.archived ||
                oldProduct.article !== newProduct.article ||
                oldProduct.pathName !== newProduct.pathName ||
                oldProduct.stock !== newProduct.stock
            ) {
                return true;
            }
        }

        return false;
    };
}
