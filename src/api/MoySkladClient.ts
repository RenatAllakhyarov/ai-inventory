import { type WarehouseProduct } from "@services/ProductsStorageService";
import {
    type WarehouseSourceClient,
    type WarehouseStock,
} from "@services/WarehouseSourceClient";

interface MoySkladProductsResponse {
    rows?: WarehouseProduct[];
}

interface MoySkladStockResponse {
    rows?: MoySkladStockRow[];
}

interface MoySkladStockRow {
    quantity?: number;
    assortment?: {
        meta?: {
            href?: string;
        };
    };
}

const getProductIdFromHref = (href?: string): string | undefined => {
    if (!href) {
        return undefined;
    }

    const cleanHref = href.split("?")[0].replace(/\/$/, "");
    const parts = cleanHref.split("/");

    return parts.at(-1);
};

export class MoySkladClient implements WarehouseSourceClient {
    readonly sourceName = "МойСклад";

    private readonly baseUrl = import.meta.env.VITE_MOYSKLAD_BASE_URL;

    fetchProducts = async (): Promise<WarehouseProduct[]> => {
        const response = await this.fetchResponse<MoySkladProductsResponse>(
            "/entity/product?limit=1000",
        );

        return response.rows ?? [];
    };

    fetchStocks = async (): Promise<WarehouseStock[]> => {
        const response = await this.fetchResponse<MoySkladStockResponse>(
            "/report/stock/all?limit=1000",
        );
        const stockRows = response.rows ?? [];

        return stockRows.flatMap((stockRow): WarehouseStock[] => {
            const productId = getProductIdFromHref(
                stockRow.assortment?.meta?.href,
            );

            if (!productId) {
                return [];
            }

            return [
                {
                    productId,
                    quantity:
                        typeof stockRow.quantity === "number"
                            ? stockRow.quantity
                            : 0,
                },
            ];
        });
    };

    checkConnection = async (): Promise<boolean> => {
        try {
            await this.fetchResponse("/entity/product?limit=1", 3);

            return true;
        } catch {
            return false;
        }
    };

    private fetchResponse = async <TResponse>(
        endpoint: string,
        retries = 3,
    ): Promise<TResponse> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(`${this.baseUrl}${endpoint}`);

                if (!response.ok) {
                    const errorText = await response.text();

                    throw new Error(`Ошибка API ${response.status}: ${errorText}`);
                }

                return await response.json() as TResponse;
            } catch {
                if (attempt === retries) {
                    throw new Error("Connection lost");
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        throw new Error("Connection lost");
    };
}
