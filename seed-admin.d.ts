export type AdminEnvironment = {
  DATABASE_URL?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_NAME?: string;
};

export function validateLocalDatabaseUrl(value?: string): string;
export function validateAdminInput(environment: AdminEnvironment): { email: string; password: string; name: string };
export function bootstrapAdmin(environment?: AdminEnvironment): Promise<void>;
