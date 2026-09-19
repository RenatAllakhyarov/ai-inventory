import { describe, expect, it, vi } from "vitest";
import {
    MoySkladClient,
    MoySkladClientError,
} from "./MoySkladClient";

const createResponse = (
    overrides: Partial<Response> = {},
): Response => ({
    ok: true,
    status: 200,
    json: async () => ({ rows: [] }),
    text: async () => "",
    ...overrides,
}) as Response;

const createClient = (fetchImplementation: typeof fetch): MoySkladClient =>
    new MoySkladClient({
        baseUrl: "https://warehouse.test",
        fetchImplementation,
        retryDelayMs: 0,
    });

describe("MoySkladClient", () => {
    it.each([undefined, "", "   "])(
        "fails during initialization when the base URL is %j",
        (baseUrl) => {
        const fetchImplementation = vi.fn() as unknown as typeof fetch;

        expect(
            () => new MoySkladClient({ baseUrl, fetchImplementation }),
        ).toThrow(MoySkladClientError);

        try {
            new MoySkladClient({ baseUrl, fetchImplementation });
        } catch (error) {
            expect(error).toMatchObject({
                kind: "configuration",
                message: "MoySklad base URL is not configured",
            });
        }

        expect(fetchImplementation).not.toHaveBeenCalled();
        },
    );

    it("uses the configured base URL for source requests", async () => {
        const fetchImplementation = vi.fn(async () => createResponse()) as unknown as typeof fetch;
        const client = createClient(fetchImplementation);

        await expect(client.fetchProducts()).resolves.toEqual([]);
        expect(fetchImplementation).toHaveBeenCalledWith(
            "https://warehouse.test/entity/product?limit=1000",
            { signal: undefined },
        );
    });

    it("binds the default fetch implementation to the global context", async () => {
        const fetchImplementation = vi.fn(function (this: unknown) {
            if (this !== globalThis) {
                throw new TypeError("Illegal invocation");
            }

            return Promise.resolve(createResponse());
        }) as unknown as typeof fetch;
        vi.stubGlobal("fetch", fetchImplementation);

        try {
            await expect(
                new MoySkladClient({ baseUrl: "https://warehouse.test" }).fetchProducts(),
            ).resolves.toEqual([]);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("preserves the final network failure as the error cause", async () => {
        const networkError = new TypeError("Failed to fetch");
        const fetchImplementation = vi.fn(async () => {
            throw networkError;
        }) as unknown as typeof fetch;

        await expect(createClient(fetchImplementation).fetchProducts()).rejects.toMatchObject({
            kind: "network",
            message: "Connection lost",
            cause: networkError,
        });
        expect(fetchImplementation).toHaveBeenCalledTimes(3);
    });

    it("reports non-success responses as HTTP failures", async () => {
        const fetchImplementation = vi.fn(async () =>
            createResponse({
                ok: false,
                status: 401,
                text: async () => "Unauthorized",
            }),
        ) as unknown as typeof fetch;

        await expect(createClient(fetchImplementation).fetchProducts()).rejects.toMatchObject({
            kind: "http",
            message: "Ошибка API 401: Unauthorized",
            cause: expect.any(Error),
        });
    });

    it("reports invalid JSON as a response-parsing failure", async () => {
        const parsingError = new SyntaxError("Unexpected token");
        const fetchImplementation = vi.fn(async () =>
            createResponse({
                json: async () => {
                    throw parsingError;
                },
            }),
        ) as unknown as typeof fetch;

        await expect(createClient(fetchImplementation).fetchProducts()).rejects.toMatchObject({
            kind: "response-parsing",
            cause: parsingError,
        });
    });

    it.each([
        ["network", async () => {
            throw new TypeError("Failed to fetch");
        }],
        ["http", async () => createResponse({ ok: false, status: 500 })],
        ["response parsing", async () => createResponse({
            json: async () => {
                throw new SyntaxError("Unexpected token");
            },
        })],
    ])("returns false when the connection probe has a %s failure", async (_, response) => {
        const fetchImplementation = vi.fn(response) as unknown as typeof fetch;

        await expect(
            createClient(fetchImplementation).checkConnection(),
        ).resolves.toBe(false);
    });
});
