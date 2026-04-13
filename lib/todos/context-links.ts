const UUID_CONTEXT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TODO_CONTEXT_ID_PATTERN =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function normalizeTodoContextId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getTodoContextIdForStorage(value: string | null | undefined): string | null {
  const normalized = normalizeTodoContextId(value);
  if (!normalized) {
    return null;
  }

  return UUID_CONTEXT_ID_PATTERN.test(normalized) ? normalized : null;
}
