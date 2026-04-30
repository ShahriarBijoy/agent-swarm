// app/(dashboard)/layout.tsx
import { TopNav } from '@/components/dashboard/top-nav';
import { TooltipProvider } from '@/components/ui/tooltip';
import { requireSession } from '@/lib/auth/require-session';

// Phase 11 — Every dashboard route runs through this layout, so calling
// requireSession() here is the single auth boundary for the whole protected
// surface. middleware.ts also redirects unauthenticated requests, but that's
// a coarse cookie-presence check; this server-side getSession is the real
// gate (it'll redirect a stale or expired cookie too).

export default async function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen px-6 pt-6 pb-10">
        <TopNav user={{ email: session.user.email, name: session.user.name }} />
        {children}
      </div>
    </TooltipProvider>
  );
}
