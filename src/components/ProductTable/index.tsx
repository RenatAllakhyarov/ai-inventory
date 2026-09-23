import { type WarehouseProduct } from "@services/ProductsStorageService";
import { formatProductMoney } from "@utils/functions/productMoney";
import { type ReactElement, type ReactNode } from "react";
import "./style.css";

interface IProductTableProps {
    sourceName: string;
    isCatalogLoading: boolean;
    allProductsCount: number;
    products: WarehouseProduct[];
}

const getProductStock = (product: WarehouseProduct): string => {
    if (typeof product.stock !== "number") {
        return "нет";
    }

    return String(product.stock);
};

interface IProductTableEmptyStateProps {
    title: string;
    children: ReactNode;
    isLoading?: boolean;
}

const ProductTableEmptyState = ({
    title,
    children,
    isLoading = false,
}: IProductTableEmptyStateProps): ReactElement => {
    const className = isLoading
        ? "empty-state empty-state--loading"
        : "empty-state";

    return (
        <div className={className}>
            <strong>{title}</strong>
            <span>{children}</span>
        </div>
    );
};

const ProductTable = ({
    sourceName,
    isCatalogLoading,
    allProductsCount,
    products,
}: IProductTableProps): ReactElement => {
    const hasProducts = allProductsCount > 0;

    return (
        <div className="product-table" aria-label="Товары склада">
            <div className="product-row product-row--head">
                <span>Товар</span>
                <span>Остаток</span>
                <span>Цена</span>
                <span>Категория</span>
            </div>
            {isCatalogLoading && (
                <ProductTableEmptyState title="Загружаем каталог" isLoading>
                    Проверяем локальные источники и {sourceName}.
                </ProductTableEmptyState>
            )}
            {!isCatalogLoading && !hasProducts && (
                <ProductTableEmptyState title="Каталог пока не загружен">
                    Когда появятся данные из источника {sourceName} или
                    localStorage, здесь будет рабочий список товаров.
                </ProductTableEmptyState>
            )}
            {hasProducts && products.length === 0 && (
                <ProductTableEmptyState title="По фильтрам ничего не найдено">
                    Попробуй очистить поиск, выбрать другую категорию или
                    показать товары без остатка.
                </ProductTableEmptyState>
            )}
            {products.map((product) => (
                <article className="product-row" key={product.id}>
                    <strong>{product.name ?? "Без названия"}</strong>
                    <span>{getProductStock(product)}</span>
                    <span>{formatProductMoney(product)}</span>
                    <span>{product.pathName ?? "нет"}</span>
                </article>
            ))}
        </div>
    );
};

export default ProductTable;
