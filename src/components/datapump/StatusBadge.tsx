import clsx from 'clsx';
import type { TicketStatus, TicketType, TicketSource } from '../../data/mockData';

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={clsx(
      'badge whitespace-nowrap',
      status === 'Pending Linking' && 'bg-amber-50 text-amber-700 border border-amber-200',
      status === 'Linked'          && 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      status === 'Processing'      && 'bg-blue-50 text-blue-700 border border-blue-200',
      status === 'Error'           && 'bg-red-50 text-red-700 border border-red-200',
    )}>
      <span className={clsx(
        'w-1.5 h-1.5 rounded-full mr-1',
        status === 'Pending Linking' && 'bg-amber-400',
        status === 'Linked'          && 'bg-emerald-500',
        status === 'Processing'      && 'bg-blue-500',
        status === 'Error'           && 'bg-red-500',
      )} />
      {status}
    </span>
  );
}

export function TypeBadge({ type }: { type: TicketType }) {
  return (
    <span className={clsx(
      'badge font-semibold',
      type === 'EMD'  && 'bg-purple-100 text-purple-700',
      type === '1st'  && 'bg-slate-100 text-slate-700',
      type === 'EXCH' && 'bg-orange-100 text-orange-700',
    )}>
      {type}
    </span>
  );
}

export function SourceBadge({ source }: { source: TicketSource }) {
  return (
    <span className={clsx(
      'badge',
      source === 'Airfile' && 'bg-blue-50 text-blue-600 border border-blue-100',
      source === 'Email'   && 'bg-violet-50 text-violet-600 border border-violet-100',
      source === 'Manual'  && 'bg-slate-50 text-slate-600 border border-slate-200',
    )}>
      {source === 'Airfile' && '✈ '}
      {source === 'Email'   && '✉ '}
      {source === 'Manual'  && '✏ '}
      {source}
    </span>
  );
}
