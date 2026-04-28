import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/**
 * Earth-tone palette tuned to the warm-beige dashboard background. Saturation
 * stays low so multiple avatars on one page read as a coherent set rather
 * than as a confetti of bright dots. White text on every swatch — luminance
 * is balanced across the palette so contrast stays consistent.
 */
const PALETTE = [
  '#a85c4a', // terracotta
  '#6f7a4e', // olive
  '#8a6e4a', // umber
  '#5a6f7a', // slate-blue
  '#8a5a6e', // mauve
  '#7a8a5a', // sage
  '#5a8a7a', // teal-moss
  '#8a7a4a', // gold-brown
  '#6e5a8a', // dusty-purple
  '#5a4a6e', // deep-purple
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function agentInitials(name: string): string {
  const parts = name.split('-').filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? '';
    const b = parts[1]?.[0] ?? '';
    return (a + b).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function agentColor(name: string): string {
  return PALETTE[hash(name) % PALETTE.length] ?? PALETTE[0]!;
}

type Size = 'sm' | 'default' | 'lg';

export function AgentAvatar({
  name,
  size = 'default',
  className,
}: {
  name: string;
  size?: Size;
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn('shadow-xs', className)}>
      <AvatarFallback
        style={{ backgroundColor: agentColor(name), color: '#ffffff' }}
        className="font-mono font-medium tracking-[0.04em]"
      >
        {agentInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
