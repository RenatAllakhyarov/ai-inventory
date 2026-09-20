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
        currency?: string;
    }>;
    barcodes?: Array<{
        ean13?: string;
        code128?: string;
        upc?: string;
    }>;
}

export interface ProductsStorageReadResult {
    products: WarehouseProduct[];
    isInvalid: boolean;
}

const isWarehouseProduct = (value: unknown): value is WarehouseProduct => {
    if (
        typeof value !== "object"
        || value === null
        || Array.isArray(value)
    ) {
        return false;
    }

    const product = value as { id?: unknown };

    return typeof product.id === "string" && product.id.trim().length > 0;
};

const normalizeSalePrices = (
    salePrices: WarehouseProduct["salePrices"],
): Array<[number | null, string | null]> =>
    (salePrices ?? [])
        .map((salePrice) => [
            salePrice.value ?? null,
            salePrice.currency ?? null,
        ] as [number | null, string | null])
        .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );

const normalizeBarcodes = (
    barcodes: WarehouseProduct["barcodes"],
): Array<[string | null, string | null, string | null]> =>
    (barcodes ?? [])
        .map((barcode) => [
            barcode.ean13 ?? null,
            barcode.code128 ?? null,
            barcode.upc ?? null,
        ] as [string | null, string | null, string | null])
        .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );

const getProductFingerprint = (product: WarehouseProduct): string =>
    JSON.stringify({
        id: product.id,
        name: product.name ?? null,
        description: product.description ?? null,
        code: product.code ?? null,
        externalCode: product.externalCode ?? null,
        archived: product.archived ?? null,
        article: product.article ?? null,
        pathName: product.pathName ?? null,
        stock: product.stock ?? null,
        salePrices: normalizeSalePrices(product.salePrices),
        barcodes: normalizeBarcodes(product.barcodes),
    });

export class ProductsStorageService {
    saveProductsToStorage = (products: WarehouseProduct[]): void => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
    };

    getProductsFromStorage = (): ProductsStorageReadResult => {
        const data = localStorage.getItem(STORAGE_KEY);

        if (!data) {
            return {
                products: [],
                isInvalid: false,
            };
        }

        try {
            const products: unknown = JSON.parse(data);

            if (
                !Array.isArray(products)
                || !products.every(isWarehouseProduct)
            ) {
                return this.clearInvalidProducts();
            }

            return {
                products,
                isInvalid: false,
            };
        } catch {
            return this.clearInvalidProducts();
        }
    };

    compareProducts = (
        oldProducts: WarehouseProduct[],
        newProducts: WarehouseProduct[],
    ): boolean => {
        if (oldProducts.length !== newProducts.length) {
            return true;
        }

        const previousProductsById = new Map(
            oldProducts.map((product) => [product.id, product]),
        );

        for (const newProduct of newProducts) {
            const oldProduct = previousProductsById.get(newProduct.id);

            if (
                !oldProduct
                || getProductFingerprint(oldProduct)
                    !== getProductFingerprint(newProduct)
            ) {
                return true;
            }
        }

        return false;
    };

    private clearInvalidProducts = (): ProductsStorageReadResult => {
        localStorage.removeItem(STORAGE_KEY);

        return {
            products: [],
            isInvalid: true,
        };
    };
}
