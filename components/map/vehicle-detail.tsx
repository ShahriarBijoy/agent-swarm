'use client';

import { ArrowLeft, MapPin, Activity, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEPOT_LABELS, SEGMENT_TINT } from './fleet-status-bar';
import type { VehicleRow } from './fleet-rail';

type ActiveTrip = {
  id: string;
  distanceKm: string;
  actualStartAt: string | null;
  scheduledEndAt: string;
  customerName: string | null;
};

const STATUS_PALETTE: Record<
  VehicleRow['status'],
  { ring: string; dot: string; label: string; ink: string }
> = {
  available: {
    ring: 'border-emerald-400/40 bg-emerald-50',
    dot: 'bg-emerald-500',
    label: 'Ready',
    ink: 'text-emerald-700',
  },
  'in-use': {
    ring: 'border-amber-400/40 bg-amber-50',
    dot: 'bg-amber-500',
    label: 'In route',
    ink: 'text-amber-700',
  },
  maintenance: {
    ring: 'border-rose-400/40 bg-rose-50',
    dot: 'bg-rose-500',
    label: 'Service',
    ink: 'text-rose-700',
  },
};

export function VehicleDetail({
  vehicle,
  activeTrip,
  onBack,
}: {
  vehicle: VehicleRow;
  activeTrip?: ActiveTrip;
  onBack: () => void;
}) {
  const status = STATUS_PALETTE[vehicle.status];
  const segmentTint = SEGMENT_TINT[vehicle.segment];
  const progress = computeProgress(activeTrip);
  const dailyRate = Math.round(Number(vehicle.dailyRateUsd));
  const tripDistance = activeTrip ? Math.round(Number(activeTrip.distanceKm)) : 0;
  const lastServiced = vehicle.lastServicedAt
    ? humanDelta(new Date(vehicle.lastServicedAt))
    : 'unknown';

  return (
    <aside className="relative flex h-full flex-col overflow-hidden border-l border-[var(--color-line)] bg-[var(--color-surface-warm)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={12} /> roster
        </button>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.22em]',
            status.ring,
            status.ink,
          )}
        >
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
          {status.label}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-black">
          <img
            src={`/vehicles/${vehicle.segment}.jpg`}
            alt={`${vehicle.make} ${vehicle.model}`}
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
            <div className="text-white">
              <p
                className="font-mono text-[10px] uppercase tracking-[0.22em]"
                style={{ color: segmentTint }}
              >
                {vehicle.segment}
              </p>
              <p className="mt-0.5 text-[20px] font-semibold leading-tight tracking-tight">
                {vehicle.make} {vehicle.model}
              </p>
              <p className="text-[12px] text-white/70 tabular-nums">
                {vehicle.year} · seats {vehicle.seats}
              </p>
            </div>
            <span className="rounded-md bg-white/95 px-2 py-1 font-mono text-[12px] font-semibold tabular-nums tracking-tight text-[var(--color-ink)] shadow-sm">
              {vehicle.plate}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-[var(--color-line)] border-b border-[var(--color-line)]">
          <Stat label="Range" value={`${vehicle.rangeKm}`} unit="km" />
          <Stat
            label="Odometer"
            value={(vehicle.odometerKm / 1000).toFixed(1)}
            unit="k km"
          />
          <Stat label="Daily" value={`$${dailyRate}`} unit="/day" />
        </div>

        <div className="space-y-5 px-5 py-5">
          <Row
            icon={<MapPin size={13} />}
            label="Depot"
            value={DEPOT_LABELS[vehicle.depot] ?? vehicle.depot}
          />
          <Row
            icon={<Wrench size={13} />}
            label="Last serviced"
            value={lastServiced}
          />
          {vehicle.status === 'maintenance' ? (
            <Row
              icon={<Activity size={13} />}
              label="State"
              value="Out of service · awaiting bay"
              ink="text-rose-700"
            />
          ) : null}
        </div>

        {activeTrip ? (
          <section className="border-t border-[var(--color-line)] bg-[var(--color-bg)]/50 px-5 py-5">
            <div className="flex items-baseline justify-between">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
                Active trip
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] tabular-nums text-[var(--color-muted)]">
                trip · {activeTrip.id.slice(0, 7)}
              </p>
            </div>
            <p className="mt-2 text-[15px] font-medium tracking-tight text-[var(--color-ink)]">
              {activeTrip.customerName ?? 'Unknown customer'}
            </p>
            <p className="text-[12px] text-[var(--color-muted)] tabular-nums">
              {tripDistance} km · group of {vehicle.seats}
            </p>

            <div className="mt-4 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                  progress
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink)]">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line-strong)]">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
                <span>started {humanDelta(new Date(activeTrip.actualStartAt ?? activeTrip.scheduledEndAt))}</span>
                <span>ETA {formatTime(new Date(activeTrip.scheduledEndAt))}</span>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="px-4 py-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1 text-[var(--color-ink)]">
        <span className="text-[18px] font-semibold leading-none tabular-nums">
          {value}
        </span>
        <span className="text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
          {unit}
        </span>
      </p>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  ink,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ink?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        <span aria-hidden className="text-[var(--color-muted-2)]">
          {icon}
        </span>
        {label}
      </span>
      <span className={cn('text-[13px] tabular-nums', ink ?? 'text-[var(--color-ink)]')}>
        {value}
      </span>
    </div>
  );
}

function computeProgress(trip?: ActiveTrip): number {
  if (!trip || !trip.actualStartAt) return 0;
  const start = new Date(trip.actualStartAt).getTime();
  const end = new Date(trip.scheduledEndAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, Math.min(1, (Date.now() - start) / (end - start)));
}

function humanDelta(date: Date): string {
  const ms = Date.now() - date.getTime();
  const sign = ms >= 0 ? 'ago' : 'from now';
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  if (min < 60) return `${min}m ${sign}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ${sign}`;
  const days = Math.round(hr / 24);
  return `${days}d ${sign}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export type { ActiveTrip };
