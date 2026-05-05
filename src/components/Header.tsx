import { Search, Bell, Plus, ChevronDown } from 'lucide-react';

interface HeaderProps {
  onNewOrder?: () => void;
}

export default function Header({ onNewOrder }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-surface-border flex items-center px-6 gap-4 shrink-0">
      {/* Search */}
      <div className="flex-1 max-w-xl relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search orders, travelers, tickets, notes…"
          className="w-full pl-9 pr-10 py-2 text-sm bg-gray-50 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder-gray-400"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded border border-gray-300">
          ⌘K
        </span>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Notification bell */}
        <button className="relative p-2 rounded-md hover:bg-gray-100 transition-colors">
          <Bell size={18} className="text-gray-500" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-danger-500 rounded-full" />
        </button>

        {/* New Order CTA */}
        <button onClick={onNewOrder} className="btn-primary">
          <Plus size={15} />
          New Order
        </button>

        {/* User avatar */}
        <button className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-md hover:bg-gray-100 transition-colors">
          <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-semibold select-none">
            AR
          </div>
          <span className="text-sm font-medium text-gray-700 hidden sm:block">ari</span>
          <ChevronDown size={13} className="text-gray-400" />
        </button>
      </div>
    </header>
  );
}
