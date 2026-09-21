import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOllamaChatApi, fetchOllamaEmbedApi } from "./OllamaApi";

const createResponse = (data: unknown): Response => ({
    ok: true,
    status: 200,
    json: async () => data,
}) as Response;

const mockResponse = (data: unknown): void => {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => createResponse(data)) as unknown as typeof fetch,
    );
};

describe("OllamaApi response validation", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns valid chat content unchanged", async () => {
        mockResponse({ message: { role: "assistant", content: "Ответ" } });

        await expect(fetchOllamaChatApi([])).resolves.toBe("Ответ");
    });

    it("rejects a chat response without string message content", async () => {
        mockResponse({ message: { content: 42 } });

        await expect(fetchOllamaChatApi([])).rejects.toThrow(
            "Invalid Ollama chat response: expected message.content to be a string",
        );
    });

    it("returns valid numeric embedding vectors unchanged", async () => {
        mockResponse({ embeddings: [[0.1, 0.2], []] });

        await expect(fetchOllamaEmbedApi(["товар"])).resolves.toEqual([
            [0.1, 0.2],
            [],
        ]);
    });

    it.each([
        {},
        { embeddings: "not-an-array" },
        { embeddings: [[0.1, "not-a-number"]] },
        { embeddings: [[Number.NaN]] },
    ])("rejects an invalid embedding response %j", async (responseData) => {
        mockResponse(responseData);

        await expect(fetchOllamaEmbedApi(["товар"])).rejects.toThrow(
            "Invalid Ollama embedding response: expected numeric embedding arrays",
        );
    });
});
