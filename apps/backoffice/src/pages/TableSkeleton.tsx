import { Skeleton, Stack } from '@mantine/core';

/** Placeholder rows while a table loads. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Stack gap="sm" p="lg">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={28} radius="sm" />
      ))}
    </Stack>
  );
}
