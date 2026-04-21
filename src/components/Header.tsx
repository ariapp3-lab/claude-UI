import { Search, Bell, Plus, ChevronDown } from 'lucide-react';

interface HeaderProps {
  onNewOrder?: () => void;
}

export default function Header({ onNewOrder }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-surface-border flex items-center px-6 gap-4 shrink-0">
      {/* Search */}
      <div className="flex-1 max-w-xl relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search orders, travelers, tickets, notes…"
          className="w-full pl-9 pr-10 py-2 text-sm bg-surface-subtle border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder-slate-400"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 font-mono bg-surface-muted px-1.5 py-0.5 rounded border border-surface-border">
          ⌘K
        </span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notification bell */}
        <button className="relative p-2 rounded-lg hover:bg-surface-subtle transition-colors">
          <Bell size={18} className="text-slate-500" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* New Order CTA */}
        <button
          onClick={onNewOrder}
          className="btn-primary"
        >
          <Plus size={15} />
          New Order
        </button>

        {/* User avatar */}
        <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-surface-subtle transition-colors">
          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-semibold select-none">
            AR
          </div>
          <span className="text-sm font-medium text-slate-700 hidden sm:block">ari</span>
          <ChevronDown size={13} className="text-slate-400" />
        </button>
      </div>
    </header>
  );
}
