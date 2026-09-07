import { type ChangeEvent, type ReactElement } from "react";
import "./style.css";

interface IWarehouseFiltersProps {
    searchQuery: string;
    selectedCategory: string;
    showInStockOnly: boolean;
    categoryOptions: string[];
    onSearchQueryChange: (value: string) => void;
    onSelectedCategoryChange: (value: string) => void;
    onShowInStockOnlyChange: (value: boolean) => void;
}

const WarehouseFilters = ({
    searchQuery,
    selectedCategory,
    showInStockOnly,
    categoryOptions,
    onSearchQueryChange,
    onSelectedCategoryChange,
    onShowInStockOnlyChange,
}: IWarehouseFiltersProps): ReactElement => {
    const handleSearchQueryChange = (
        event: ChangeEvent<HTMLInputElement>,
    ): void => {
        onSearchQueryChange(event.target.value);
    };

    const handleSelectedCategoryChange = (
        event: ChangeEvent<HTMLSelectElement>,
    ): void => {
        onSelectedCategoryChange(event.target.value);
    };

    const handleShowInStockOnlyChange = (
        event: ChangeEvent<HTMLInputElement>,
    ): void => {
        onShowInStockOnlyChange(event.target.checked);
    };

    return (
        <div className="filter-bar" aria-label="Параметры поиска товаров">
            <label className="filter-field filter-field--wide">
                <span>Поиск</span>
                <input
                    type="search"
                    value={searchQuery}
                    onChange={handleSearchQueryChange}
                    placeholder="Название, артикул, код или штрихкод"
                />
            </label>
            <label className="filter-field">
                <span>Категория</span>
                <select
                    value={selectedCategory}
                    onChange={handleSelectedCategoryChange}
                >
                    <option value="">Все категории</option>
                    {categoryOptions.map((category) => (
                        <option key={category} value={category}>
                            {category}
                        </option>
                    ))}
                </select>
            </label>
            <label className="stock-toggle">
                <input
                    type="checkbox"
                    checked={showInStockOnly}
                    onChange={handleShowInStockOnlyChange}
                />
                <span>Только с остатком</span>
            </label>
        </div>
    );
};

export default WarehouseFilters;
