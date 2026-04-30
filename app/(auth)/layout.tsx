import type { ReactNode } from 'react';

// Phase 11 — Public auth route layout.
// Deliberately stripped: no <TopNav />, no <TooltipProvider />, no session
// gate. The `(auth)` route group lets /login and /register share this shell
// without inheriting the (dashboard) layout's session requirement.

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
