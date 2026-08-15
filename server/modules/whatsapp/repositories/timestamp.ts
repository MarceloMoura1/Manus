export class PersistedDataIntegrityError extends Error {
  constructor(field: string) {
    super(`Dado persistido inválido no campo ${field}.`);
    this.name = "PersistedDataIntegrityError";
  }
}

const MYSQL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

export function parseDatabaseTimestamp(value: string, field: string): Date {
  if (!MYSQL_TIMESTAMP.test(value)) throw new PersistedDataIntegrityError(field);
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  if (Number.isNaN(date.getTime())) throw new PersistedDataIntegrityError(field);
  return date;
}
