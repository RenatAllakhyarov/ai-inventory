import {
    type WarehouseQueryPlan,
    WarehouseCatalogQueryService,
} from "./WarehouseCatalogQueryService";
import { fetchOllamaChatApi, type OllamaChatMessage } from "@api/OllamaApi";

export class WarehouseRetrievalPlannerService {
    private readonly warehouseCatalogQueryService =
        new WarehouseCatalogQueryService();

    planRetrieval = async (
        question: string,
    ): Promise<WarehouseQueryPlan | null> => {
        const answer = await fetchOllamaChatApi(
            this.preparePlannerMessages(question),
        );

        return this.parsePlan(answer);
    };

    parsePlan = (value: string): WarehouseQueryPlan | null => {
        try {
            return this.warehouseCatalogQueryService.validatePlan(
                JSON.parse(value) as unknown,
            );
        } catch {
            return null;
        }
    };

    private preparePlannerMessages = (
        question: string,
    ): OllamaChatMessage[] => {
        return [
            {
                role: "system",
                content: `
Ты планировщик запросов к локальному складскому индексу.
Верни только строгий JSON без markdown и пояснений.
Не отвечай пользователю и не придумывай товары.
Нельзя возвращать JavaScript, SQL, IndexedDB-команды или произвольные поля.

${this.warehouseCatalogQueryService.getSchemaContext()}

Правила:
- Для "сколько категорий" используй aggregate count по table categories.
- Для "какие категории" используй aggregate list по table categories.
- Для поиска товаров используй lookup.
- Если вопрос просит описание, поставь includeDescription=true.
                `.trim(),
            },
            {
                role: "user",
                content: question,
            },
        ];
    };
}
