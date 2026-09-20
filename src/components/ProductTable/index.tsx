import { type WarehouseProduct } from "@services/ProductsStorageService";
import { formatProductMoney } from "@utils/functions/productMoney";
import { type ReactElement } from "react";
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
                <div className="empty-state empty-state--loading">
                    <strong>Загружаем каталог</strong>
                    <span>
                        Проверяем локальные источники и {sourceName}.
                    </span>
                </div>
            )}
            {!isCatalogLoading && !hasProducts && (
                <div className="empty-state">
                    <strong>Каталог пока не загружен</strong>
                    <span>
                        Когда появятся данные из источника {sourceName} или localStorage,
                        здесь будет рабочий список товаров.
                    </span>
                </div>
            )}
            {hasProducts && products.length === 0 && (
                <div className="empty-state">
                    <strong>По фильтрам ничего не найдено</strong>
                    <span>
                        Попробуй очистить поиск, выбрать другую категорию или
                        показать товары без остатка.
                    </span>
                </div>
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
