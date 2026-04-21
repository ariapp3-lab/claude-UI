import { useState } from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal, Link2, ExternalLink } from 'lucide-react';
import type { Ticket } from '../../data/mockData';
import { StatusBadge, TypeBadge, SourceBadge } from './StatusBadge';
import clsx from 'clsx';

interface DataTableProps {
  tickets: Ticket[];
  total: number;
}

const COL_HEADERS = [
  '# PNR', '# Ticket', 'Office ID', 'IATA', 'Passengers',
  'Route', 'Type', 'Source', 'Airline', 'FOP', 'Amount', 'Date', 'Order', 'Status',
];

export default function DataTable({ tickets, total }: DataTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="card overflow-hidden">
      {/* Table meta */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-border bg-surface-subtle">
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{tickets.length}</span> / {total.toLocaleString()} matching &nbsp;·&nbsp; Page <span className="font-medium text-slate-700">1</span> of 53 &nbsp;·&nbsp; Database <span className="font-medium text-slate-700">{total.toLocaleString()}</span>
        </p>
        <p className="text-xs text-slate-400 hidden lg:block">Use the sticky pager at the bottom to navigate pages</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-subtle border-b border-surface-border">
              <th className="w-8 py-3 pl-4" />
              {COL_HEADERS.map((h) => (
                <th
                  key={h}
                  className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
              <th className="w-10 py-3 pr-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {tickets.map((t) => {
              const isExpanded = expanded.has(t.id);
              return (
                <>
                  <tr
                    key={t.id}
                    className={clsx(
                      'group hover:bg-surface-subtle transition-colors cursor-pointer',
                      isExpanded && 'bg-surface-subtle',
                    )}
                    onClick={() => toggle(t.id)}
                  >
                    {/* Expand toggle */}
                    <td className="pl-4 py-3 text-slate-400">
                      {isExpanded
                        ? <ChevronDown size={14} />
                        : <ChevronRight size={14} className="group-hover:text-slate-600" />}
                    </td>

                    {/* PNR */}
                    <td className="px-3 py-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {t.pnr}
                    </td>

                    {/* Ticket */}
                    <td className="px-3 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {t.ticket ?? <span className="text-slate-300">—</span>}
                    </td>

                    {/* Office ID */}
                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {t.officeId ?? <span className="text-slate-300">—</span>}
                    </td>

                    {/* IATA */}
                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {t.iata ?? <span className="text-slate-300">—</span>}
                    </td>

                    {/* Passengers */}
                    <td className="px-3 py-3 max-w-[160px] truncate text-slate-700 font-medium">
                      {t.passengers}
                    </td>

                    {/* Route */}
                    <td className="px-3 py-3 whitespace-nowrap">
                      {t.route !== '—' ? (
                        <div>
                          <span className="font-semibold text-slate-800">{t.route}</span>
                          {t.routeDate && (
                            <span className="ml-1.5 text-[10px] text-slate-400 font-medium">{t.routeDate}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Type */}
                    <td className="px-3 py-3"><TypeBadge type={t.type} /></td>

                    {/* Source */}
                    <td className="px-3 py-3"><SourceBadge source={t.source} /></td>

                    {/* Airline */}
                    <td className="px-3 py-3 text-xs text-slate-600 whitespace-nowrap max-w-[140px] truncate">
                      {t.airline}
                    </td>

                    {/* FOP */}
                    <td className="px-3 py-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {t.fop ?? <span className="text-slate-300">—</span>}
                    </td>

                    {/* Amount */}
                    <td className="px-3 py-3 font-semibold text-slate-800 whitespace-nowrap text-right">
                      {t.amount > 0 ? `$${t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : <span className="text-slate-300">—</span>}
                    </td>

                    {/* Date */}
                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">{t.date}</td>

                    {/* Order */}
                    <td className="px-3 py-3">
                      {t.order
                        ? <span className="text-brand-700 font-medium text-xs flex items-center gap-1"><ExternalLink size={11} />{t.order}</span>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-3"><StatusBadge status={t.status} /></td>

                    {/* Actions */}
                    <td className="pr-4 py-3 text-slate-300 group-hover:text-slate-500 transition-colors">
                      <button
                        onClick={(e) => { e.stopPropagation(); }}
                        className="p-1 rounded hover:bg-surface-muted"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr key={`${t.id}-detail`} className="bg-slate-50">
                      <td colSpan={16} className="px-8 py-4">
                        <div className="flex items-start gap-6">
                          <div className="flex-1 grid grid-cols-3 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-slate-400 font-medium mb-1">Full PNR</p>
                              <p className="font-mono font-semibold text-slate-800">{t.pnr}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400 font-medium mb-1">Passengers</p>
                              <p className="text-slate-700">{t.passengers}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400 font-medium mb-1">Amount</p>
                              <p className="font-semibold text-slate-800">
                                {t.amount > 0 ? `$${t.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400 font-medium mb-1">Ticket Number</p>
                              <p className="font-mono text-slate-600">{t.ticket ?? '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400 font-medium mb-1">Route</p>
                              <p className="text-slate-700">{t.route} {t.routeDate}</p>
                            </div>
                            <div>
                              <p className="text-xs text-slate-400 font-medium mb-1">FOP</p>
                              <p className="font-mono text-slate-600">{t.fop ?? '—'}</p>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0 pt-1">
                            <button className="btn-primary py-1.5 text-xs">
                              <Link2 size={13} /> Link to Order
                            </button>
                            <button className="btn-secondary py-1.5 text-xs">
                              Create Order
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky pager */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-surface-border bg-surface-subtle">
        <button className="btn-secondary py-1.5 text-xs disabled:opacity-40" disabled>← Previous</button>
        <div className="flex gap-1">
          {[1, 2, 3, '…', 53].map((p, i) => (
            <button
              key={i}
              className={clsx(
                'w-7 h-7 rounded text-xs font-medium transition-colors',
                p === 1 ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-surface-muted',
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <button className="btn-secondary py-1.5 text-xs">Next →</button>
      </div>
    </div>
  );
}
