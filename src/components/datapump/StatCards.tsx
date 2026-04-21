import { FileText, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  iconBg: string;
  trend?: string;
}

function StatCard({ label, value, icon, iconBg, trend }: StatCardProps) {
  return (
    <div className="card px-5 py-4 flex items-center gap-4">
      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-900 leading-none mt-0.5">{value.toLocaleString()}</p>
        {trend && <p className="text-xs text-slate-400 mt-0.5">{trend}</p>}
      </div>
    </div>
  );
}

interface StatCardsProps {
  total: number;
  pending: number;
  processed: number;
  errors: number;
}

export default function StatCards({ total, pending, processed, errors }: StatCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total"
        value={total}
        icon={<FileText size={18} className="text-slate-600" />}
        iconBg="bg-slate-100"
        trend="All time records"
      />
      <StatCard
        label="Pending"
        value={pending}
        icon={<Clock size={18} className="text-amber-600" />}
        iconBg="bg-amber-50"
        trend="Awaiting action"
      />
      <StatCard
        label="Processed"
        value={processed}
        icon={<CheckCircle2 size={18} className="text-emerald-600" />}
        iconBg="bg-emerald-50"
        trend="Successfully linked"
      />
      <StatCard
        label="Errors"
        value={errors}
        icon={<AlertTriangle size={18} className="text-red-500" />}
        iconBg="bg-red-50"
        trend={errors === 0 ? 'All clear' : `${errors} require attention`}
      />
    </div>
  );
}
