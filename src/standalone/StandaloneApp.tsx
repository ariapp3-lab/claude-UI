import { useState } from 'react';
import clsx from 'clsx';
import { Calculator, FileSearch, Receipt, Scale, Ticket } from 'lucide-react';
import ReconciliationPage from '../commission/pages/ReconciliationPage';
import CheckTicketPage from '../commission/pages/CheckTicketPage';
import StatementPage from '../commission/pages/StatementPage';
import TicketsPage from '../commission/pages/TicketsPage';
import ContractPage from '../commission/pages/ContractPage';
import { WorkspaceProvider } from '../commission/workspace';
import { BatchProvider } from '../commission/batch';
import { ErrorBoundary } from '../commission/components/ErrorBoundary';

/**
 * The standalone product.
 *
 * The same pages the CRM embeds, without the CRM around them — for an agency
 * that wants the reconciliation and nothing else. It opens on the consolidator
 * view, because the agency running it standalone is usually the one holding the
 * carrier contracts and doing the week by hand.
 *
 * There is no second copy of anything here: the pages, the engine and the
 * contracts are the same files the embedded build uses. Only the shell differs.
 */
const PAGES = [
  { id: 'reconciliation', label: 'Reconciliation', icon: Calculator,  el: <ReconciliationPage /> },
  { id: 'tickets',        label: 'Tickets',        icon: Ticket,      el: <TicketsPage /> },
  { id: 'statements',     label: 'Statements',     icon: Receipt,     el: <StatementPage /> },
  { id: 'ticket',         label: 'Check a ticket', icon: FileSearch,  el: <CheckTicketPage /> },
  { id: 'contract',       label: 'Contracts',      icon: Scale,       el: <ContractPage /> },
] as const;

export default function StandaloneApp() {
  const [page, setPage] = useState<(typeof PAGES)[number]['id']>('reconciliation');
  const active = PAGES.find((p) => p.id === page) ?? PAGES[0];

  return (
    <WorkspaceProvider defaultView="host">
      <BatchProvider>
      <div className="flex h-screen overflow-hidden bg-surface-subtle">
        <aside className="flex flex-col w-52 shrink-0 bg-sidebar-bg">
          <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-800">
            <div className="w-7 h-7 rounded-lg bg-brand-600 grid place-items-center shrink-0">
              <span className="font-mono text-[11px] font-semibold text-white">%</span>
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-sidebar-textHigh leading-tight">
                Commission Desk
              </p>
              <p className="text-[10px] text-sidebar-text">Agency reconciliation</p>
            </div>
          </div>

          <nav className="flex flex-col gap-0.5 p-2">
            {PAGES.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setPage(id)}
                aria-current={page === id ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-left transition-colors',
                  page === id
                    ? 'bg-sidebar-active text-white'
                    : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-textHigh',
                )}>
                <Icon size={16} />{label}
              </button>
            ))}
          </nav>

          <div className="mt-auto px-4 py-3 border-t border-slate-800">
            <p className="font-mono text-[10px] leading-relaxed text-slate-500">
              engine 0.1.0<br />
              nothing leaves this browser
            </p>
          </div>
        </aside>

        <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <ErrorBoundary key={active.id} label={active.label}>{active.el}</ErrorBoundary>
        </main>
      </div>
      </BatchProvider>
    </WorkspaceProvider>
  );
}
