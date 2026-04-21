import { Download, Link2, CheckCircle2, ChevronRight } from 'lucide-react';

const steps = [
  {
    num: 1,
    icon: <Download size={16} className="text-blue-600" />,
    bg: 'bg-blue-50 border-blue-200',
    dot: 'bg-blue-500',
    title: 'Import',
    desc: 'GDS airfiles, email/OTA, or manual entry land here automatically.',
  },
  {
    num: 2,
    icon: <Link2 size={16} className="text-amber-600" />,
    bg: 'bg-amber-50 border-amber-200',
    dot: 'bg-amber-500',
    title: 'Review & Link',
    desc: 'Match each ticket to an existing order or create a new one.',
  },
  {
    num: 3,
    icon: <CheckCircle2 size={16} className="text-emerald-600" />,
    bg: 'bg-emerald-50 border-emerald-200',
    dot: 'bg-emerald-500',
    title: 'Processed',
    desc: 'Linked tickets move to the order and are removed from the queue.',
  },
];

export default function WorkflowBanner() {
  return (
    <div className="card px-6 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Workflow</p>
      <div className="flex items-center gap-2">
        {steps.map((step, i) => (
          <>
            <div key={step.num} className={`flex items-center gap-3 flex-1 rounded-lg border px-4 py-3 ${step.bg}`}>
              <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
                {step.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${step.dot}`} />
                  <p className="text-sm font-semibold text-slate-800">{step.title}</p>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{step.desc}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight size={18} className="text-slate-300 shrink-0" key={`arrow-${i}`} />
            )}
          </>
        ))}
      </div>
    </div>
  );
}
