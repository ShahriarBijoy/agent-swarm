import Link from 'next/link';

export default function TaskNotFound() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="font-heading text-lg font-medium">Task not found</h1>
      <p className="text-sm text-muted-foreground">
        No task row matches this id. If you just created it, reload once — the
        DB insert may not have committed yet.
      </p>
      <Link
        href="/tasks"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        ← all tasks
      </Link>
    </main>
  );
}
