export const OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_CHAT_MODEL = "gemma3:4b";
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
export const QWEN_CHAT_MODEL_ALTERNATIVE = "qwen3:4b";

export const WAREHOUSE_SYSTEM_PROMPT = `
Ты — помощник по складу.

Отвечай только на основании переданных данных о товарах.

Не придумывай товары.

Не придумывай цены.

Не придумывай остатки.

Если данных недостаточно, прямо скажи об этом.

Отвечай на русском языке.
`.trim();

export const DEFAULT_TOAST_DURATION_MS = 4200;

export const DATABASE_NAME = "ai_inventory_warehouse";
export const DATABASE_VERSION = 3;
export const PRODUCTS_STORE = "warehouse_products";
export const INDEXED_PRODUCTS_STORE = "warehouse_indexed_products";
export const CATEGORIES_STORE = "warehouse_categories";
export const NAMES_STORE = "warehouse_names";
export const STOCKS_STORE = "warehouse_stocks";
export const PRICES_STORE = "warehouse_prices";
export const DESCRIPTIONS_STORE = "warehouse_descriptions";
export const BARCODES_STORE = "warehouse_barcodes";
export const SEARCH_TERMS_STORE = "warehouse_search_terms";
export const EMBEDDINGS_STORE = "warehouse_embeddings";
export const META_STORE = "warehouse_meta";

export const LEGACY_SEARCH_INDEX_STORE = "warehouse_search_index";
