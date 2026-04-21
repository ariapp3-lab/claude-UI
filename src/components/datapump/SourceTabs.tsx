import { FileText, Mail, PenLine } from 'lucide-react';
import clsx from 'clsx';

export type SourceTab = 'All sources' | 'Airfiles (GDS)' | 'Email / OTA' | 'Manual';

const tabs: { id: SourceTab; icon: React.ReactNode }[] = [
  { id: 'All sources',    icon: <FileText size={14} /> },
  { id: 'Airfiles (GDS)', icon: <FileText size={14} /> },
  { id: 'Email / OTA',    icon: <Mail size={14} /> },
  { id: 'Manual',         icon: <PenLine size={14} /> },
];

interface SourceTabsProps {
  active: SourceTab;
  onChange: (tab: SourceTab) => void;
}

export default function SourceTabs({ active, onChange }: SourceTabsProps) {
  return (
    <div className="flex gap-1 border-b border-surface-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            active === tab.id
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700',
          )}
        >
          {tab.icon}
          {tab.id}
        </button>
      ))}
    </div>
  );
}
