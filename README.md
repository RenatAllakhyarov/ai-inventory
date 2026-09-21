# AI Inventory

Local React/Vite application for viewing a MoySklad catalog and answering warehouse questions through Ollama.

## Requirements

- Node.js and npm
- access to the MoySklad API
- Ollama running for AI chat and, when enabled, embeddings

## Run locally

```bash
npm install
npm run dev
```

Other available commands:

- `npm run build` — TypeScript validation and production build;
- `npm run lint` — ESLint;
- `npm run test` — Vitest;
- `npm run preview` — preview the production build.

## Configuration

Create `.env.local` in the project root:

```dotenv
VITE_MOYSKLAD_BASE_URL=https://api.moysklad.ru/api/remap/1.2
```

`VITE_MOYSKLAD_BASE_URL` is required for the MoySklad client. You can also configure:

- `VITE_OLLAMA_CHAT_MODEL` — chat model; defaults to `gemma3:4b`;
- `VITE_OLLAMA_EMBEDDING_MODEL` — embedding model; defaults to `nomic-embed-text`;
- `VITE_OLLAMA_EMBEDDINGS_ENABLED=true` — enables embeddings for retrieval.

The Ollama API is expected at `http://localhost:11434`.

## Architecture

`AiInventoryPage` is the composition layer. It connects UI components to two main hooks:

- `useWarehouseCatalog` loads the catalog, synchronizes localStorage and IndexedDB, performs search, and supplies table data;
- `useWarehouseChat` maintains chat history and sends questions to `WarehouseAiContextService`.

`ConfiguredWarehouseSourceClient` creates `MoySkladClient`, the catalog source implementation. `WarehouseIdbStorageService` stores products and derived indexes. `WarehouseCatalogQueryService` executes lookup/aggregate plans against the local catalog. `WarehouseAiContextService` selects relevant facts, prepares context, and calls Ollama.

## Data flows

1. `useWarehouseCatalog` first uses the local catalog, hydrates IndexedDB when needed, and requests MoySklad as a fallback.
2. `MoySkladClient` combines products with the stock report; the result is saved for local search.
3. When a question is asked, `useWarehouseChat` passes the catalog to `WarehouseAiContextService`.
4. The service creates a retrieval plan, obtains relevant records from IndexedDB or the fallback catalog, and sends those facts with chat history to Ollama.
