import { TrendingUp, Plane, DollarSign, Users, ArrowUpRight } from 'lucide-react';

const metrics = [
  { label: 'Total Revenue',    value: '$284,390', change: '+12.4%', up: true,  icon: <DollarSign size={18} className="text-emerald-600" />, bg: 'bg-emerald-50' },
  { label: 'Active Orders',    value: '1,284',    change: '+3.2%',  up: true,  icon: <Plane size={18} className="text-blue-600" />,         bg: 'bg-blue-50'    },
  { label: 'New Customers',    value: '148',       change: '-1.8%',  up: false, icon: <Users size={18} className="text-violet-600" />,       bg: 'bg-violet-50'  },
  { label: 'Conversion Rate',  value: '24.6%',     change: '+5.1%',  up: true,  icon: <TrendingUp size={18} className="text-amber-600" />,   bg: 'bg-amber-50'   },
];

const recentOrders = [
  { id: 'ORD-881', passenger: 'Goldman/A',  route: 'JFK → LAX', amount: '$889', status: 'Confirmed', date: '20 Apr' },
  { id: 'ORD-765', passenger: 'Weiss/D',    route: 'EWR → MIA', amount: '$320', status: 'Pending',   date: '18 Apr' },
  { id: 'ORD-744', passenger: 'Stern/R',    route: 'TLV → NYC', amount: '$1,240', status: 'Processing', date: '19 Apr' },
  { id: 'ORD-701', passenger: 'Landau/S',   route: 'EWR → TLV', amount: '$0',   status: 'Exchange',  date: '21 Apr' },
  { id: 'ORD-698', passenger: 'Eichler/J',  route: 'EWR → JFK', amount: '$128', status: 'Confirmed', date: '22 Apr' },
];

const statusColor: Record<string, string> = {
  Confirmed:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Pending:    'bg-amber-50   text-amber-700   border border-amber-200',
  Processing: 'bg-blue-50    text-blue-700    border border-blue-200',
  Exchange:   'bg-orange-50  text-orange-700  border border-orange-200',
};

export default function DashboardPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Welcome back — here's what's happening today.</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {metrics.map((m) => (
            <div key={m.label} className="card px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${m.bg}`}>{m.icon}</div>
                <span className={`text-xs font-semibold flex items-center gap-0.5 ${m.up ? 'text-emerald-600' : 'text-red-500'}`}>
                  <ArrowUpRight size={12} className={m.up ? '' : 'rotate-180'} />
                  {m.change}
                </span>
              </div>
              <p className="text-2xl font-bold text-slate-900">{m.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Recent orders */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">Recent Orders</h2>
            <button className="text-xs text-brand-600 hover:underline">View all</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-subtle border-b border-surface-border">
                {['Order', 'Passenger', 'Route', 'Amount', 'Status', 'Date'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {recentOrders.map((o) => (
                <tr key={o.id} className="hover:bg-surface-subtle transition-colors cursor-pointer">
                  <td className="px-5 py-3 font-mono font-semibold text-brand-700 text-xs">{o.id}</td>
                  <td className="px-5 py-3 text-slate-700 font-medium">{o.passenger}</td>
                  <td className="px-5 py-3 text-slate-600">{o.route}</td>
                  <td className="px-5 py-3 font-semibold text-slate-800">{o.amount}</td>
                  <td className="px-5 py-3">
                    <span className={`badge ${statusColor[o.status] ?? ''}`}>{o.status}</span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{o.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
