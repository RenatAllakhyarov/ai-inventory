import { type WarehouseProduct } from "@services/ProductsStorageService";

export const DEFAULT_PRODUCT_CURRENCY = "RUB";
export const PRODUCT_MONEY_LOCALE = "ru-RU";
export const UNAVAILABLE_PRODUCT_PRICE_LABEL = "нет";

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

const normalizeCurrencyCode = (value: unknown): string => {
    if (typeof value !== "string") {
        return DEFAULT_PRODUCT_CURRENCY;
    }

    const currency = value.trim().toUpperCase();

    return CURRENCY_CODE_PATTERN.test(currency)
        ? currency
        : DEFAULT_PRODUCT_CURRENCY;
};

export const getProductPriceAmount = (
    product: WarehouseProduct,
): number | undefined => {
    const [firstSalePrice] = product.salePrices ?? [];
    const value = firstSalePrice?.value;

    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }

    return value / 100;
};

export const getProductPriceCurrency = (
    product: WarehouseProduct,
): string => {
    const [firstSalePrice] = product.salePrices ?? [];

    return normalizeCurrencyCode(firstSalePrice?.currency);
};

export const formatMoney = (
    amount: number | undefined,
    currency = DEFAULT_PRODUCT_CURRENCY,
): string => {
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
        return UNAVAILABLE_PRODUCT_PRICE_LABEL;
    }

    const normalizedCurrency = normalizeCurrencyCode(currency);

    try {
        return new Intl.NumberFormat(PRODUCT_MONEY_LOCALE, {
            style: "currency",
            currency: normalizedCurrency,
        }).format(amount);
    } catch {
        return new Intl.NumberFormat(PRODUCT_MONEY_LOCALE, {
            style: "currency",
            currency: DEFAULT_PRODUCT_CURRENCY,
        }).format(amount);
    }
};

export const formatProductMoney = (product: WarehouseProduct): string =>
    formatMoney(getProductPriceAmount(product), getProductPriceCurrency(product));
