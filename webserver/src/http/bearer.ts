/** * Bearer token extractor for `Authorization` headers. */
export function readBearer(authHeader?: string): string | null {
  if (authHeader === undefined) return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length === 0 ? null : token;
}
