// app/(dashboard)/page.tsx
export default function HomePage() {
  return (
    <div className="grid grid-cols-5 gap-[14px]" data-testid="bento-home">
      <div className="col-span-5 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-[22px] text-[var(--color-muted)]">
        Phase 10 home — widgets land here.
      </div>
    </div>
  );
}
