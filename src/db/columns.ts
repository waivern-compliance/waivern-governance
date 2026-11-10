import { customType } from 'drizzle-orm/pg-core';

/** Postgres bytea, which drizzle does not ship a helper for. */
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  }
});
