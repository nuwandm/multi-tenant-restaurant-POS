import postgres from 'postgres';

/** Postgres client that returns bigint columns (money in öre, receipt numbers) as safe JS numbers. */
export function createSql(url: string, options: postgres.Options<Record<string, never>> = {}) {
  return postgres(url, {
    onnotice: () => {},
    ...options,
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => {
          const n = Number(value);
          if (!Number.isSafeInteger(n)) throw new RangeError(`bigint out of safe range: ${value}`);
          return n;
        },
      },
    },
  });
}
