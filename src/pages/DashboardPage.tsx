import {
  DollarSign, Plane, Users, Clock, ArrowUpRight, ArrowDownRight,
  Zap, TrendingUp, CheckCircle2, AlertCircle, ChevronRight,
  MapPin, Calendar, Package,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Mini sparkline (pure SVG) ───────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80, h = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  const area = `M${pts[0]} L${pts.join(' L')} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`g-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g-${color})`} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Revenue bar chart (pure SVG) ────────────────────────────────────────────
const revenueData = [
  { month: 'Nov', value: 41200 },
  { month: 'Dec', value: 58900 },
  { month: 'Jan', value: 47300 },
  { month: 'Feb', value: 52100 },
  { month: 'Mar', value: 63800 },
  { month: 'Apr', value: 71400 },
  { month: 'May', value: 68200 },
  { month: 'Jun', value: 79500 },
  { month: 'Jul', value: 84100 },
  { month: 'Aug', value: 76300 },
  { month: 'Sep', value: 91200 },
  { month: 'Oct', value: 88600 },
];

function RevenueChart() {
  const max = Math.max(...revenueData.map(d => d.value));
  const chartH = 160;
  const chartW = 600;
  const barW = 32;
  const gap = (chartW - barW * revenueData.length) / (revenueData.length - 1);
  const currentMonth = 9; // Oct highlighted

  return (
    <svg viewBox={`0 0 ${chartW} ${chartH + 28}`} className="w-full" preserveAspectRatio="none">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={0} y1={chartH * (1 - t)}
          x2={chartW} y2={chartH * (1 - t)}
          stroke="#f1f5f9" strokeWidth="1"
        />
      ))}
      {/* Bars */}
      {revenueData.map((d, i) => {
        const x = i * (barW + gap);
        const barH = (d.value / max) * chartH;
        const isActive = i === currentMonth;
        return (
          <g key={d.month}>
            <rect
              x={x} y={chartH - barH} width={barW} height={barH}
              rx={4}
              fill={isActive ? '#16a34a' : '#dcfce7'}
            />
            {isActive && (
              <rect x={x} y={chartH - barH} width={barW} height={barH} rx={4}
                fill="url(#barGrad)" />
            )}
            <text x={x + barW / 2} y={chartH + 18} textAnchor="middle"
              fontSize="10" fill="#94a3b8" fontFamily="Inter, sans-serif">
              {d.month}
            </text>
            {isActive && (
              <text x={x + barW / 2} y={chartH - barH - 6} textAnchor="middle"
                fontSize="9" fontWeight="600" fill="#16a34a" fontFamily="Inter, sans-serif">
                ${(d.value / 1000).toFixed(0)}k
              </text>
            )}
          </g>
        );
      })}
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ─── Data ────────────────────────────────────────────────────────────────────
const kpis = [
  {
    label: 'Total Revenue',
    value: '$284,390',
    change: '+12.4%', up: true,
    sub: 'vs last month',
    icon: <DollarSign size={18} className="text-emerald-600" />,
    bg: 'bg-emerald-50',
    spark: [34, 42, 38, 51, 47, 55, 61, 58, 67, 72, 69, 78],
    color: '#16a34a',
  },
  {
    label: 'Active Orders',
    value: '1,284',
    change: '+3.2%', up: true,
    sub: 'vs last month',
    icon: <Package size={18} className="text-blue-600" />,
    bg: 'bg-blue-50',
    spark: [80, 85, 78, 90, 88, 92, 95, 89, 97, 101, 98, 105],
    color: '#2563eb',
  },
  {
    label: 'Pending Tickets',
    value: '436',
    change: '+18', up: false,
    sub: 'need linking',
    icon: <Clock size={18} className="text-amber-600" />,
    bg: 'bg-amber-50',
    spark: [20, 28, 35, 29, 42, 38, 45, 50, 44, 52, 48, 55],
    color: '#d97706',
  },
  {
    label: 'Active Travelers',
    value: '892',
    change: '+5.7%', up: true,
    sub: 'booked this month',
    icon: <Users size={18} className="text-violet-600" />,
    bg: 'bg-violet-50',
    spark: [60, 65, 70, 68, 74, 72, 79, 83, 80, 87, 85, 92],
    color: '#7c3aed',
  },
];

const topRoutes = [
  { from: 'EWR', to: 'TLV', airline: 'El Al', bookings: 142, revenue: '$98,420', pct: 92 },
  { from: 'JFK', to: 'LAX', airline: 'United', bookings: 98,  revenue: '$54,210', pct: 64 },
  { from: 'EWR', to: 'MIA', airline: 'Delta',  bookings: 76,  revenue: '$31,080', pct: 50 },
  { from: 'LGA', to: 'FLL', airline: 'Delta',  bookings: 61,  revenue: '$24,900', pct: 40 },
  { from: 'JFK', to: 'ORD', airline: 'AA',     bookings: 44,  revenue: '$18,640', pct: 29 },
];

const recentOrders = [
  { id: 'ORD-881', passenger: 'Goldman/A',  route: 'JFK → LAX', amount: '$889',   status: 'Confirmed', date: '20 Apr', avatar: 'GA' },
  { id: 'ORD-765', passenger: 'Weiss/D',    route: 'EWR → MIA', amount: '$320',   status: 'Pending',   date: '18 Apr', avatar: 'WD' },
  { id: 'ORD-744', passenger: 'Stern/R',    route: 'TLV → NYC', amount: '$1,240', status: 'Processing',date: '19 Apr', avatar: 'SR' },
  { id: 'ORD-701', passenger: 'Landau/S',   route: 'EWR → TLV', amount: '$0',    status: 'Exchange',  date: '21 Apr', avatar: 'LS' },
  { id: 'ORD-698', passenger: 'Eichler/J',  route: 'EWR → JFK', amount: '$128',  status: 'Confirmed', date: '22 Apr', avatar: 'EJ' },
  { id: 'ORD-677', passenger: 'Klein/M',    route: 'EWR → TLV', amount: '$2,100',status: 'Confirmed', date: '17 Apr', avatar: 'KM' },
];

const activity = [
  { icon: <CheckCircle2 size={14} className="text-emerald-500" />, bg: 'bg-emerald-50', text: 'ORD-881 confirmed', sub: '2 min ago' },
  { icon: <Zap size={14} className="text-amber-500" />,            bg: 'bg-amber-50',   text: '18 new airfiles imported', sub: '14 min ago' },
  { icon: <Plane size={14} className="text-blue-500" />,           bg: 'bg-blue-50',    text: 'EWR→TLV flight updated', sub: '31 min ago' },
  { icon: <AlertCircle size={14} className="text-red-500" />,      bg: 'bg-red-50',     text: 'FOP missing on B3YJ6C', sub: '1 hr ago' },
  { icon: <Users size={14} className="text-violet-500" />,         bg: 'bg-violet-50',  text: '3 new travelers added', sub: '2 hr ago' },
  { icon: <CheckCircle2 size={14} className="text-emerald-500" />, bg: 'bg-emerald-50', text: 'ORD-765 linked to ticket', sub: '3 hr ago' },
];

const statusColor: Record<string, string> = {
  Confirmed:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Pending:    'bg-amber-50   text-amber-700   border border-amber-200',
  Processing: 'bg-blue-50    text-blue-700    border border-blue-200',
  Exchange:   'bg-orange-50  text-orange-700  border border-orange-200',
};

const avatarColor = ['bg-blue-500','bg-violet-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'];

// ─── Component ───────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="flex-1 overflow-y-auto bg-surface-subtle">
      <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
              <Calendar size={13} /> {today}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs py-1.5">This Month</button>
            <button className="btn-primary text-xs py-1.5">+ New Order</button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpis.map((k) => (
            <div key={k.label} className="card px-5 py-4">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${k.bg}`}>
                  {k.icon}
                </div>
                <span className={clsx('text-xs font-semibold flex items-center gap-0.5',
                  k.up ? 'text-emerald-600' : 'text-red-500')}>
                  {k.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {k.change}
                </span>
              </div>
              <p className="text-2xl font-bold text-slate-900 leading-none">{k.value}</p>
              <p className="text-xs text-slate-500 mt-1">{k.label}</p>
              <div className="mt-3">
                <Sparkline data={k.spark} color={k.color} />
              </div>
            </div>
          ))}
        </div>

        {/* Middle row: Revenue chart + Top Routes */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Revenue chart — 2/3 width */}
          <div className="card px-6 py-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Revenue Overview</h2>
                <p className="text-xs text-slate-400 mt-0.5">Monthly revenue · last 12 months</p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold bg-emerald-50 px-2.5 py-1 rounded-full">
                <TrendingUp size={12} /> +18.4% YoY
              </div>
            </div>
            <RevenueChart />
          </div>

          {/* Top Routes — 1/3 width */}
          <div className="card px-5 py-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-800">Top Routes</h2>
              <button className="text-xs text-brand-600 hover:underline">View all</button>
            </div>
            <div className="space-y-4">
              {topRoutes.map((r) => (
                <div key={`${r.from}-${r.to}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <MapPin size={12} className="text-slate-400 shrink-0" />
                      <span className="text-sm font-semibold text-slate-800">
                        {r.from} <span className="text-slate-300 font-normal">→</span> {r.to}
                      </span>
                      <span className="text-[10px] text-slate-400">{r.airline}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-700">{r.revenue}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full"
                        style={{ width: `${r.pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 w-12 text-right">{r.bookings} bkgs</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom row: Recent Orders + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Recent Orders — 2/3 */}
          <div className="card overflow-hidden lg:col-span-2">
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-slate-800">Recent Orders</h2>
              <button className="text-xs text-brand-600 hover:underline flex items-center gap-0.5">
                View all <ChevronRight size={12} />
              </button>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-subtle border-b border-surface-border">
                  {['Order', 'Passenger', 'Route', 'Amount', 'Status', 'Date'].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {recentOrders.map((o, i) => (
                  <tr key={o.id} className="hover:bg-surface-subtle transition-colors cursor-pointer group">
                    <td className="px-5 py-3 font-mono font-semibold text-brand-700 text-xs">{o.id}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0', avatarColor[i % avatarColor.length])}>
                          {o.avatar}
                        </div>
                        <span className="text-slate-700 font-medium">{o.passenger}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600 text-xs flex items-center gap-1 mt-2">
                      <Plane size={11} className="text-slate-400" />{o.route}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-800">{o.amount}</td>
                    <td className="px-5 py-3">
                      <span className={`badge ${statusColor[o.status] ?? ''}`}>{o.status}</span>
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{o.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Activity feed — 1/3 */}
          <div className="card px-5 py-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-800">Activity</h2>
              <span className="badge bg-brand-50 text-brand-700 border border-brand-100">{activity.length} new</span>
            </div>
            <div className="space-y-3">
              {activity.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5', a.bg)}>
                    {a.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 leading-snug">{a.text}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{a.sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 text-xs text-slate-400 hover:text-brand-600 transition-colors text-center">
              View all activity →
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
