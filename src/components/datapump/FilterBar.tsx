import { Search, SlidersHorizontal, RotateCcw, Bot, BookOpen } from 'lucide-react';

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  onAddBooking?: () => void;
}

export default function FilterBar({ search, onSearch, onAddBooking }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[240px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search ticket number, PNR, passenger, airline, FOP…"
          className="w-full pl-8 pr-4 py-2 text-sm bg-white border border-surface-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent placeholder-slate-400"
        />
      </div>

      {/* Action buttons */}
      <button className="btn-secondary gap-1.5">
        <RotateCcw size={14} />
        Reset filters
      </button>
      <button className="btn-secondary gap-1.5">
        <SlidersHorizontal size={14} />
        Filters
      </button>
      <button className="btn-secondary gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50">
        <Bot size={14} />
        Reassign by AITAN
      </button>
      <button className="btn-secondary gap-1.5">
        <BookOpen size={14} />
        TJQ
      </button>
      <button className="btn-primary gap-1.5" onClick={onAddBooking}>
        <BookOpen size={14} />
        Add booking
      </button>
    </div>
  );
}
