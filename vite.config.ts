import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");

    const proxyPath = env.MOYSKLAD_PROXY_PATH;
    const apiTarget = env.MOYSKLAD_API_TARGET;
    const apiBasePath = env.MOYSKLAD_API_BASE_PATH;
    const token = env.MOYSKLAD_TOKEN;

    return {
        base: "./",
        plugins: [react()],
        resolve: {
            alias: {
                "@api": path.resolve(__dirname, "./src/api"),
                "@components": path.resolve(__dirname, "./src/components"),
                "@context": path.resolve(__dirname, "./src/context"),
                "@domains": path.resolve(__dirname, "./src/domains"),
                "@hooks": path.resolve(__dirname, "./src/hooks"),
                "@router": path.resolve(__dirname, "./src/router"),
                "@pages": path.resolve(__dirname, "./src/pages"),
                "@layouts": path.resolve(__dirname, "./src/layouts"),
                "@services": path.resolve(__dirname, "./src/services"),
                "@utils": path.resolve(__dirname, "./src/utils"),
                "@data": path.resolve(__dirname, "./src/data"),
                "@store": path.resolve(__dirname, "./src/store"),
            },
        },
        server: proxyPath && apiTarget && apiBasePath
            ? {
                proxy: {
                    [proxyPath]: {
                        target: apiTarget,
                        changeOrigin: true,
                        rewrite: (requestPath) => requestPath.replace(proxyPath, apiBasePath),
                        headers: token
                            ? {
                                Authorization: `Bearer ${token}`,
                            }
                            : undefined,
                    },
                },
            }
            : undefined,
    };
});
