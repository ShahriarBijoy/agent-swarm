// app/(dashboard)/layout.tsx
import { TopNav } from '@/components/dashboard/top-nav';

export default function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-6 pt-6 pb-10">
      <TopNav />
      {children}
    </div>
  );
}
