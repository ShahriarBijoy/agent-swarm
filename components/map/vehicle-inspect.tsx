'use client';

import { motion } from 'framer-motion';
import { X } from 'lucide-react';
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

const STATUS: Record<
  VehicleRow['status'],
  { label: string; dot: string; pill: string }
> = {
  available: {
    label: 'Ready',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-50 text-emerald-700 border-emerald-300/40',
  },
  'in-use': {
    label: 'In route',
    dot: 'bg-amber-500',
    pill: 'bg-amber-50 text-amber-700 border-amber-300/40',
  },
  maintenance: {
    label: 'Service',
    dot: 'bg-rose-500',
    pill: 'bg-rose-50 text-rose-700 border-rose-300/40',
  },
};

export function VehicleInspect({
  vehicle,
  activeTrip,
  onClose,
}: {
  vehicle: VehicleRow;
  activeTrip?: ActiveTrip;
  onClose: () => void;
}) {
  const status = STATUS[vehicle.status];
  const tint = SEGMENT_TINT[vehicle.segment];
  const dailyRate = Math.round(Number(vehicle.dailyRateUsd));
  const odoK = (vehicle.odometerKm / 1000).toFixed(1);
  const tripKm = activeTrip ? Math.round(Number(activeTrip.distanceKm)) : 0;
  const progress = computeProgress(activeTrip);
  const serviced = vehicle.lastServicedAt
    ? humanDelta(new Date(vehicle.lastServicedAt))
    : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full flex-col overflow-y-auto bg-[var(--color-surface-warm)]"
    >
      <div className="relative">
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--color-bg)]">
          <img
            src={`/vehicles/${vehicle.segment}.jpg`}
            alt={`${vehicle.make} ${vehicle.model}`}
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[var(--color-surface-warm)] to-transparent"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close vehicle detail"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-[var(--color-surface-warm)]/85 text-[var(--color-ink)]/70 shadow-sm backdrop-blur transition-colors hover:bg-[var(--color-surface-warm)] hover:text-[var(--color-ink)]"
        >
          <X size={14} />
        </button>
      </div>

      <header className="px-5 pb-5 pt-3">
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: tint }}
        >
          {vehicle.segment}
        </p>
        <h2 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-[var(--color-ink)]">
          {vehicle.make} {vehicle.model}
        </h2>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
          {vehicle.plate} · {vehicle.year} · seats {vehicle.seats}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.22em]',
              status.pill,
            )}
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', status.dot)} />
            {status.label}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            {DEPOT_LABELS[vehicle.depot] ?? vehicle.depot}
          </span>
        </div>
      </header>

      <Divider />

      <dl className="grid grid-cols-3 px-5 py-5">
        <Stat label="Range" value={`${vehicle.rangeKm}`} unit="km" />
        <Stat label="Odometer" value={odoK} unit="k km" />
        <Stat label="Daily" value={`$${dailyRate}`} unit="" />
      </dl>

      {serviced ? (
        <>
          <Divider />
          <p className="px-5 py-4 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            Serviced {serviced}
          </p>
        </>
      ) : null}

      {activeTrip ? (
        <>
          <Divider />
          <section className="px-5 py-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
              Active trip
            </p>
            <p className="mt-2 text-[15px] font-medium tracking-tight text-[var(--color-ink)]">
              {activeTrip.customerName ?? 'Unknown customer'}
            </p>
            <p className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
              {tripKm} km · group of {vehicle.seats}
            </p>

            <div className="mt-4 space-y-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-line-strong)]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: tint }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.round(progress * 100)}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)] tabular-nums">
                <span>{Math.round(progress * 100)}% complete</span>
                <span>ETA {formatTime(new Date(activeTrip.scheduledEndAt))}</span>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </motion.section>
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
    <div className="flex flex-col gap-1">
      <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        {label}
      </dt>
      <dd className="flex items-baseline gap-1 text-[var(--color-ink)]">
        <span className="text-[20px] font-semibold leading-none tracking-tight tabular-nums">
          {value}
        </span>
        {unit ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
            {unit}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function Divider() {
  return (
    <div aria-hidden className="mx-5 border-t border-dashed border-[var(--color-line)]" />
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
