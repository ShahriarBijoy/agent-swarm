// app/(dashboard)/layout.tsx
import { TopNav } from '@/components/dashboard/top-nav';
import { TooltipProvider } from '@/components/ui/tooltip';

export default function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen px-6 pt-6 pb-10">
        <TopNav />
        {children}
      </div>
    </TooltipProvider>
  );
}
