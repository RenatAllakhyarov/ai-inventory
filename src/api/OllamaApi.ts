import {
    DEFAULT_CHAT_MODEL,
    DEFAULT_EMBEDDING_MODEL,
    OLLAMA_URL,
    WAREHOUSE_SYSTEM_PROMPT,
} from "@utils/constants";

export const OLLAMA_CHAT_MODEL =
    import.meta.env.VITE_OLLAMA_CHAT_MODEL ?? DEFAULT_CHAT_MODEL;

export const OLLAMA_EMBEDDING_MODEL =
    import.meta.env.VITE_OLLAMA_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isOllamaChatResponse = (
    value: unknown,
): value is OllamaResponse => {
    if (!isRecord(value) || !isRecord(value.message)) {
        return false;
    }

    return typeof value.message.content === "string";
};

const isOllamaEmbedResponse = (
    value: unknown,
): value is OllamaEmbedResponse => {
    if (!isRecord(value) || !Array.isArray(value.embeddings)) {
        return false;
    }

    return value.embeddings.every(
        (embedding) =>
            Array.isArray(embedding)
            && embedding.every(
                (value) => typeof value === "number" && Number.isFinite(value),
            ),
    );
};

export const fetchOllamaChatApi = async (
    messages: OllamaChatMessage[],
    signal?: AbortSignal,
): Promise<string> => {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
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
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(`Ошибка Ollama API ${response.status}: ${errorText}`);
    }

    const data: unknown = await response.json();

    if (!isOllamaChatResponse(data)) {
        throw new Error(
            "Invalid Ollama chat response: expected message.content to be a string",
        );
    }

    return data.message.content;
};

export const fetchOllamaEmbedApi = async (
    input: string[],
    signal?: AbortSignal,
): Promise<number[][]> => {
    const response = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: OLLAMA_EMBEDDING_MODEL,
            input,
        }),
        signal,
    });

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `Ошибка Ollama Embed API ${response.status}: ${errorText}`,
        );
    }

    const data: unknown = await response.json();

    if (!isOllamaEmbedResponse(data)) {
        throw new Error(
            "Invalid Ollama embedding response: expected numeric embedding arrays",
        );
    }

    return data.embeddings;
};

export const fetchOllamaApi = async (
    prompt: string,
    signal?: AbortSignal,
): Promise<string> => {
    return fetchOllamaChatApi([
        {
            role: "system",
            content: WAREHOUSE_SYSTEM_PROMPT,
        },
        {
            role: "user",
            content: prompt,
        },
    ], signal);
};
