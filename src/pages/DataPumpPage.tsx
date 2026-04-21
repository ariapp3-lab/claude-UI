import { useState } from 'react';
import StatCards from '../components/datapump/StatCards';
import WorkflowBanner from '../components/datapump/WorkflowBanner';
import SourceTabs from '../components/datapump/SourceTabs';
import FilterBar from '../components/datapump/FilterBar';
import DataTable from '../components/datapump/DataTable';
import { mockTickets, stats } from '../data/mockData';
import type { SourceTab } from '../components/datapump/SourceTabs';

export default function DataPumpPage() {
  const [activeTab, setActiveTab] = useState<SourceTab>('All sources');
  const [search, setSearch] = useState('');

  const filtered = mockTickets.filter((t) => {
    const matchesTab =
      activeTab === 'All sources' ||
      (activeTab === 'Airfiles (GDS)' && t.source === 'Airfile') ||
      (activeTab === 'Email / OTA'    && t.source === 'Email') ||
      (activeTab === 'Manual'         && t.source === 'Manual');

    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      t.pnr.toLowerCase().includes(q) ||
      (t.ticket ?? '').toLowerCase().includes(q) ||
      t.passengers.toLowerCase().includes(q) ||
      t.airline.toLowerCase().includes(q) ||
      (t.fop ?? '').toLowerCase().includes(q);

    return matchesTab && matchesSearch;
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1440px] mx-auto px-6 py-6 space-y-5">
        {/* Breadcrumb */}
        <div>
          <p className="text-xs text-slate-400 mb-1">
            <span className="hover:text-brand-600 cursor-pointer">Import Inbox</span>
          </p>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Data Pump</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                GDS airfiles, email / OTA, and manual entries in one queue —{' '}
                <a href="#" className="text-brand-600 hover:underline">link to orders below</a>.
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <StatCards
          total={stats.total}
          pending={stats.pending}
          processed={stats.processed}
          errors={stats.errors}
        />

        {/* Workflow */}
        <WorkflowBanner />

        {/* Table card */}
        <div className="card overflow-hidden">
          {/* Tabs */}
          <div className="px-5 pt-4">
            <SourceTabs active={activeTab} onChange={setActiveTab} />
          </div>

          {/* Filter bar */}
          <div className="px-5 py-3 border-b border-surface-border bg-surface-subtle">
            <FilterBar search={search} onSearch={setSearch} />
          </div>

          {/* Table */}
          <DataTable tickets={filtered} total={stats.total} />
        </div>
      </div>
    </div>
  );
}
