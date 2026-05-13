export function ForbiddenError(message = "Forbidden") {
  const error = new Error(message) as Error & { code?: string };
  error.code = "FORBIDDEN";
  return error;
}
