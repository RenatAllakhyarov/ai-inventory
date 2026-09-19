export type IdFactory = () => string;

export const createUuid = (): string => crypto.randomUUID();
