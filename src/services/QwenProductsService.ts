import { type WarehouseProduct } from "./ProductsStorageService";

const DEFAULT_PRODUCTS_LIMIT = 15;

type RankedProduct = {
    product: WarehouseProduct;
    score: number;
};

export class QwenProductsService {
    normalizeSearchText = (value: string): string => {
        return value
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^\p{L}\p{N}\s]+/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    getSearchTokens = (value: string): string[] => {
        return this.normalizeSearchText(value)
            .split(" ")
            .filter((token) => token.length >= 2);
    };

    getBarcode = (product: WarehouseProduct): string => {
        const [firstBarcode] = product.barcodes ?? [];

        return firstBarcode?.ean13 ??
            firstBarcode?.code128 ??
            firstBarcode?.upc ??
            "нет";
    };

    getPrice = (product: WarehouseProduct): string => {
        const [firstSalePrice] = product.salePrices ?? [];

        if (typeof firstSalePrice?.value !== "number") {
            return "нет";
        }

        return String(firstSalePrice.value / 100);
    };

    getSearchableText = (product: WarehouseProduct): string => {
        return this.normalizeSearchText(
            [
                product.name,
                product.description,
                product.code,
                product.externalCode,
                product.article,
                product.pathName,
                this.getBarcode(product),
            ]
                .filter(Boolean)
                .join(" "),
        );
    };

    shouldIncludeDetails = (
        question: string,
    ): boolean => {
        const questionText = this.normalizeSearchText(question);

        return [
            "описание",
            "описания",
            "опиши",
            "подробно",
            "состав",
            "характеристики",
            "похож",
            "связан",
            "категория",
            "категории",
            "description",
            "describe",
            "details",
        ].some((token) => questionText.includes(token));
    };

    private rankProducts = (
        products: WarehouseProduct[],
        question: string,
    ): RankedProduct[] => {
        const questionText = this.normalizeSearchText(question);
        const questionTokens = this.getSearchTokens(question);

        return products
            .map((product) => {
                const searchableText = this.getSearchableText(product);
                let score = 0;

                for (const token of questionTokens) {
                    if (searchableText.includes(token)) {
                        score += token.length > 4 ? 3 : 2;
                    }
                }

                if (
                    product.name &&
                    questionText.includes(this.normalizeSearchText(product.name))
                ) {
                    score += 8;
                }

                if (
                    product.article &&
                    questionText.includes(this.normalizeSearchText(product.article))
                ) {
                    score += 6;
                }

                if (
                    product.code &&
                    questionText.includes(this.normalizeSearchText(product.code))
                ) {
                    score += 6;
                }

                return {
                    product,
                    score,
                };
            })
            .sort((left, right) => right.score - left.score);
    };

    selectRelevantProducts = (
        products: WarehouseProduct[],
        question: string,
        limit = DEFAULT_PRODUCTS_LIMIT,
    ): WarehouseProduct[] => {
        const rankedProducts = this.rankProducts(products, question);
        const matchedProducts = rankedProducts
            .filter(({ score }) => score > 0)
            .slice(0, limit)
            .map(({ product }) => product);

        if (matchedProducts.length > 0) {
            return matchedProducts;
        }

        return products.slice(0, limit);
    };

    prepareContext = (
        products: WarehouseProduct[],
    ): string => {
        return products
            .map((product, index) => {
                return `
ТОВАР №${index + 1}

ID:
${product.id}

Название:
${product.name ?? "нет"}

Описание:
${product.description ?? "нет"}

Код:
${product.code ?? "нет"}

Внешний код:
${product.externalCode ?? "нет"}

Артикул:
${product.article ?? "нет"}

Штрихкод:
${this.getBarcode(product)}

Цена:
${this.getPrice(product)}

Остаток:
${typeof product.stock === "number" ? String(product.stock) : "нет"}

Архивный:
${product.archived ? "да" : "нет"}

Категория:
${product.pathName ?? "нет"}
                `.trim();
            })
            .join(
                "\n\n====================\n\n",
            );
    };

    prepareCompactContext = (
        products: WarehouseProduct[],
        includeDetails: boolean,
    ): string => {
        const rows =
            products
                .map((product, index) => {
                    const row = [
                        `${index + 1}. name=${product.name ?? "нет"}`,
                        `stock=${typeof product.stock === "number" ? String(product.stock) : "нет"}`,
                        `price=${this.getPrice(product)}`,
                        `category=${product.pathName ?? "нет"}`,
                    ].join(" | ");

                    if (!includeDetails) {
                        return row;
                    }

                    return [
                        row,
                        `description=${product.description ?? "нет"}`,
                    ].join("\n");
                });

        return rows.join("\n");
    };

    preparePrompt = (
        products: WarehouseProduct[],
        question: string,
        totalProductsCount: number,
    ): string => {
        const context = this.prepareContext(products);

        return `
ВСЕГО ТОВАРОВ В КАТАЛОГЕ:
${totalProductsCount}

В КОНТЕКСТ ДЛЯ ОТВЕТА ПЕРЕДАНЫ ТОЛЬКО НАИБОЛЕЕ РЕЛЕВАНТНЫЕ ТОВАРЫ:
${products.length}

ТОВАРЫ ИЗ СКЛАДА:

${context}

ВОПРОС ПОЛЬЗОВАТЕЛЯ:

${question}
        `.trim();
    };
}
