export function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function buildErrorRedirectUrl(
  request: Request,
  fallbackPath: string,
  errors: string[],
) {
  const referer = request.headers.get("referer");
  const baseUrl = new URL(request.url);
  const target = referer ? new URL(referer) : new URL(fallbackPath, baseUrl);
  target.searchParams.delete("saved");
  target.searchParams.delete("errors");
  target.searchParams.set("errors", JSON.stringify(errors));
  return target;
}

export function readErrorsFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const raw = firstValue(searchParams.errors);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
