import { getMemories } from '@/lib/dashboard/queries';
import { MemoriesTable, type MemoryRow } from './memories-table';

export const dynamic = 'force-dynamic';

export default async function MemoriesPage() {
  const result = await getMemories({}, 0, 1000);
  const rows: MemoryRow[] = result.rows;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6">
      <MemoriesTable rows={rows} total={result.total} />
    </div>
  );
}
