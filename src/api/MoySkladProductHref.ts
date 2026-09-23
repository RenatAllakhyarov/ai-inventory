const relativeUrlBase = "https://moysklad.invalid";
const absoluteUrlPattern = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

const getLastPathnameSegment = (pathname: string): string | undefined =>
    pathname.split("/").filter(Boolean).at(-1);

const isRelativeHref = (href: string): boolean =>
    !href.startsWith("//")
    && !absoluteUrlPattern.test(href)
    && !href.includes("\\")
    && !/\s/.test(href);

export const getMoySkladProductIdFromHref = (
    href?: string,
): string | undefined => {
    const value = href?.trim();

    if (!value) {
        return undefined;
    }

    try {
        return getLastPathnameSegment(new URL(value).pathname);
    } catch {
        if (!isRelativeHref(value)) {
            return undefined;
        }

        try {
            return getLastPathnameSegment(
                new URL(value, relativeUrlBase).pathname,
            );
        } catch {
            return undefined;
        }
    }
};
