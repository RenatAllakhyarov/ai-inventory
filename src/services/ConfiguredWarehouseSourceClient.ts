import { MoySkladClient } from "@api/MoySkladClient";
import { type WarehouseSourceClient } from "@services/WarehouseSourceClient";

export const configuredWarehouseSourceClient: WarehouseSourceClient =
    new MoySkladClient();
