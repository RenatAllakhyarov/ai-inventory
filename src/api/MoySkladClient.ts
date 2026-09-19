import { type WarehouseProduct } from "@services/ProductsStorageService";
import {
    type WarehouseSourceClient,
    type WarehouseStock,
} from "@services/WarehouseSourceClient";
import { getMoySkladProductIdFromHref } from "./MoySkladProductHref";

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

export type MoySkladClientErrorKind =
    | "configuration"
    | "network"
    | "http"
    | "response-parsing";

export class MoySkladClientError extends Error {
    readonly cause?: unknown;

    constructor(
        readonly kind: MoySkladClientErrorKind,
        message: string,
        cause?: unknown,
    ) {
        super(message);
        this.name = "MoySkladClientError";
        this.cause = cause;
    }
}

interface MoySkladClientOptions {
    baseUrl?: string;
    fetchImplementation?: typeof fetch;
    retryDelayMs?: number;
}

export class MoySkladClient implements WarehouseSourceClient {
    readonly sourceName = "МойСклад";

    private readonly baseUrl: string;
    private readonly fetchImplementation: typeof fetch;
    private readonly retryDelayMs: number;

    constructor(options: MoySkladClientOptions = {}) {
        const baseUrl = "baseUrl" in options
            ? options.baseUrl
            : import.meta.env.VITE_MOYSKLAD_BASE_URL;

        if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
            throw new MoySkladClientError(
                "configuration",
                "MoySklad base URL is not configured",
            );
        }

        this.baseUrl = baseUrl;
        this.fetchImplementation = options.fetchImplementation ?? fetch.bind(globalThis);
        this.retryDelayMs = options.retryDelayMs ?? 1000;
    }

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
            const productId = getMoySkladProductIdFromHref(
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

    fetchCatalog = async (): Promise<WarehouseProduct[]> => {
        const [products, stocks] = await Promise.all([
            this.fetchProducts(),
            this.fetchStocks(),
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
            let response: Response;

            try {
                response = await this.fetchImplementation(`${this.baseUrl}${endpoint}`);
            } catch (cause) {
                if (attempt === retries) {
                    throw new MoySkladClientError(
                        "network",
                        "Connection lost",
                        cause,
                    );
                }

                await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
                continue;
            }

            if (!response.ok) {
                let errorText = "";

                try {
                    errorText = await response.text();
                } catch (cause) {
                    throw new MoySkladClientError(
                        "http",
                        `Ошибка API ${response.status}: unable to read error response`,
                        cause,
                    );
                }

                const httpError = new Error(
                    `Ошибка API ${response.status}: ${errorText}`,
                );

                throw new MoySkladClientError(
                    "http",
                    httpError.message,
                    httpError,
                );
            }

            try {
                return await response.json() as TResponse;
            } catch (cause) {
                throw new MoySkladClientError(
                    "response-parsing",
                    "Unable to parse MoySklad API response",
                    cause,
                );
            }
        }

        throw new MoySkladClientError("network", "Connection lost");
    };
}
