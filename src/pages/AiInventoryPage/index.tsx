import SignalRail from "@components/SignalRail";
import ChatConsole from "@components/ChatConsole";
import ProductTable from "@components/ProductTable";
import WarehouseFilters from "@components/WarehouseFilters";
import InventorySummary from "@components/InventorySummary";
import ToastViewport from "@components/ToastViewport";
import { OLLAMA_CHAT_MODEL } from "@api/OllamaApi";
import { useToasts } from "@hooks/useToasts";
import { useWarehouseCatalog } from "@hooks/useWarehouseCatalog";
import { useWarehouseChat } from "@hooks/useWarehouseChat";
import { type ConnectionTone } from "../../types";
import { type ReactElement } from "react";
import "./style.css";

interface ConnectionViewModel {
    label: string;
    tone: ConnectionTone;
}

const getConnectionViewModel = (
    isConnected: boolean | null,
): ConnectionViewModel => {
    if (isConnected === null) {
        return { label: "Проверка", tone: "pending" };
    }

    return isConnected
        ? { label: "Подключено", tone: "good" }
        : { label: "Нет связи", tone: "danger" };
};

const AiInventoryPage = (): ReactElement => {
    const { messages: toastMessages, dismissToast, showToast } = useToasts();
    const {
        sourceName,
        isConnected,
        products,
        isCatalogLoading,
        searchResult,
        searchQuery,
        selectedCategory,
        showInStockOnly,
        categoryOptions,
        productsWithStock,
        outOfStockCount,
        archivedCount,
        setSearchQuery,
        setSelectedCategory,
        setShowInStockOnly,
    } = useWarehouseCatalog({ showToast });
    const {
        question,
        chatMessages,
        isAiLoading,
        chatFeedRef,
        setQuestion,
        askAi,
        resetAiSession,
        handleQuestionKeyDown,
    } = useWarehouseChat({ products, showToast });

    const connectionViewModel = getConnectionViewModel(isConnected);

    const catalogLabel = isCatalogLoading
        ? "Загрузка"
        : products.length > 0
          ? `${products.length} товаров`
          : "Каталог пуст";

    const aiContextLabel = isCatalogLoading
        ? "Готовим локальный каталог"
        : products.length > 0
          ? "Локальный каталог готов"
          : "Нет данных для ответа";

    const signals = {
        sourceName,
        connectionLabel: connectionViewModel.label,
        connectionTone: connectionViewModel.tone,
        catalogLabel,
        aiContextLabel,
        hasProducts: products.length > 0,
    };
    const chatState = {
        modelName: OLLAMA_CHAT_MODEL,
        productsCount: products.length,
        question,
        chatMessages,
        isAiLoading,
        chatFeedRef,
    };
    const chatActions = {
        onQuestionChange: setQuestion,
        onQuestionKeyDown: handleQuestionKeyDown,
        onAsk: askAi,
        onReset: resetAiSession,
    };

    return (
        <main className="warehouse-shell">
            <SignalRail signals={signals} />
            <section className="workspace-grid">
                <div className="inventory-workspace">
                    <header className="section-header">
                        <div>
                            <span className="section-eyebrow">
                                Каталог товаров
                            </span>
                            <h2>Остатки и карточки</h2>
                        </div>
                        <span className="section-count">
                            {searchResult.total}/{products.length} позиций
                        </span>
                    </header>
                    <InventorySummary
                        totalCount={products.length}
                        inStockCount={productsWithStock.length}
                        outOfStockCount={outOfStockCount}
                        categoryCount={categoryOptions.length}
                        archivedCount={archivedCount}
                    />
                    <WarehouseFilters
                        searchQuery={searchQuery}
                        selectedCategory={selectedCategory}
                        showInStockOnly={showInStockOnly}
                        categoryOptions={categoryOptions}
                        onSearchQueryChange={setSearchQuery}
                        onSelectedCategoryChange={setSelectedCategory}
                        onShowInStockOnlyChange={setShowInStockOnly}
                    />
                    <ProductTable
                        sourceName={sourceName}
                        isCatalogLoading={isCatalogLoading}
                        allProductsCount={products.length}
                        products={searchResult.items}
                    />
                </div>
                <ChatConsole chatState={chatState} chatActions={chatActions} />
            </section>
            <ToastViewport messages={toastMessages} onDismiss={dismissToast} />
        </main>
    );
};

export default AiInventoryPage;
