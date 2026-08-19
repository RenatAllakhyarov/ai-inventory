const BASE_URL = import.meta.env.VITE_MOYSKLAD_BASE_URL;

export const fetchWarehouseApi = async (
    endpoint: string,
    retries = 3,
): Promise<any> => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await new Promise((resolve) => setTimeout(resolve, 3000));

            const response = await fetch(`${BASE_URL}${endpoint}`);

            if (!response.ok) {
                const errorText = await response.text();

                throw new Error(`Ошибка API ${response.status}: ${errorText}`);
            }

            return response.json();
        } catch (error) {
            if (attempt === retries) {
                throw new Error("Connection lost");
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
};

export const checkMoySkladConnection = async (): Promise<boolean> => {
    try {
        await fetchWarehouseApi("/entity/product?limit=1", 3);

        return true;
    } catch (error) {
        return false;
    }
};
