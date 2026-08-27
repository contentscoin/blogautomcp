export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function isSameIdempotentRequest(input: {
  existingType: string;
  existingInput: unknown;
  requestedType: string;
  requestedInput: unknown;
}): boolean {
  return input.existingType === input.requestedType
    && canonicalJson(input.existingInput) === canonicalJson(input.requestedInput);
}
