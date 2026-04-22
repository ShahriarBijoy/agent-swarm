import { customType } from 'drizzle-orm/pg-core';

export const tsvector = customType<{ data: string; notNull: true }>({
  dataType() {
    return 'tsvector';
  },
});
