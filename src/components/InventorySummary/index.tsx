import { type ReactElement } from "react";
import "./style.css";

interface IInventorySummaryProps {
    totalCount: number;
    inStockCount: number;
    outOfStockCount: number;
    categoryCount: number;
    archivedCount: number;
}

const InventorySummary = ({
    totalCount,
    inStockCount,
    outOfStockCount,
    categoryCount,
    archivedCount,
}: IInventorySummaryProps): ReactElement => {
    return (
        <div className="summary-grid" aria-label="Сводка склада">
            <div className="summary-item">
                <span>Всего</span>
                <strong>{totalCount}</strong>
            </div>
            <div className="summary-item">
                <span>С остатком</span>
                <strong>{inStockCount}</strong>
            </div>
            <div className="summary-item summary-item--warn">
                <span>Нулевой остаток</span>
                <strong>{outOfStockCount}</strong>
            </div>
            <div className="summary-item">
                <span>Категории</span>
                <strong>{categoryCount}</strong>
            </div>
            <div className="summary-item">
                <span>Архив</span>
                <strong>{archivedCount}</strong>
            </div>
        </div>
    );
};

export default InventorySummary;
