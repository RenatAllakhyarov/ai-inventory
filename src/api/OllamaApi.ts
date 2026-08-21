const OLLAMA_URL = "http://localhost:11434";
const DEFAULT_CHAT_MODEL = "gemma3:4b";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

export const QWEN_CHAT_MODEL_ALTERNATIVE = "qwen3:4b";

export const OLLAMA_CHAT_MODEL =
    import.meta.env.VITE_OLLAMA_CHAT_MODEL ??
    DEFAULT_CHAT_MODEL;

export const OLLAMA_EMBEDDING_MODEL =
    import.meta.env.VITE_OLLAMA_EMBEDDING_MODEL ??
    DEFAULT_EMBEDDING_MODEL;

export type OllamaMessageRole = "system" | "user" | "assistant";

export interface OllamaChatMessage {
    role: OllamaMessageRole;
    content: string;
}

interface OllamaResponse {
    message: {
        role: string;
        content: string;
    };
}

interface OllamaEmbedResponse {
    embeddings: number[][];
}

export const WAREHOUSE_SYSTEM_PROMPT = `
Ты — помощник по складу.

Отвечай только на основании переданных данных о товарах.

Не придумывай товары.

Не придумывай цены.

Не придумывай остатки.

Если данных недостаточно, прямо скажи об этом.

Отвечай на русском языке.
`.trim();


export const fetchOllamaChatApi = async (
    messages: OllamaChatMessage[],
): Promise<string> => {
    const response = await fetch(
        `${OLLAMA_URL}/api/chat`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },


            body: JSON.stringify({

                model: OLLAMA_CHAT_MODEL,

                stream: false,


                options: {
                    num_ctx: 8192,
                    temperature: 0.1,
                },


                messages,

            }),

        },
    );



    if (!response.ok) {

        const errorText =
            await response.text();


        throw new Error(
            `Ошибка Ollama API ${response.status}: ${errorText}`,
        );

    }



    const data: OllamaResponse =
        await response.json();



    return data.message.content;

};

export const fetchOllamaEmbedApi = async (
    input: string[],
): Promise<number[][]> => {
    const response = await fetch(
        `${OLLAMA_URL}/api/embed`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                model: OLLAMA_EMBEDDING_MODEL,
                input,
            }),
        },
    );

    if (!response.ok) {
        const errorText =
            await response.text();

        throw new Error(
            `Ошибка Ollama Embed API ${response.status}: ${errorText}`,
        );
    }

    const data: OllamaEmbedResponse =
        await response.json();

    return data.embeddings;
};

export const fetchOllamaApi = async (
    prompt: string,
): Promise<string> => {
    return fetchOllamaChatApi(
        [
            {
                role: "system",
                content: WAREHOUSE_SYSTEM_PROMPT,
            },
            {
                role: "user",
                content: prompt,
            },
        ],
    );
};
