import {
  LayoutDashboard, Briefcase, Users, UserCheck, Inbox, CheckSquare,
  Zap, Ticket, Calculator, ShieldCheck, Settings, LogOut,
  ChevronDown, Plane,
} from 'lucide-react';
import clsx from 'clsx';

interface NavItem {
  icon: React.ReactNode;
  label: string;
  badge?: number;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const sections: NavSection[] = [
    {
      items: [
        { icon: <LayoutDashboard size={16} />, label: 'Dashboard' },
        { icon: <Briefcase size={16} />,       label: 'Workspace' },
      ],
    },
    {
      title: 'CRM',
      items: [
        { icon: <Users size={16} />,       label: 'Leads' },
        { icon: <Briefcase size={16} />,   label: 'Orders' },
        { icon: <UserCheck size={16} />,   label: 'Customers' },
        { icon: <Plane size={16} />,       label: 'Travelers' },
        { icon: <Inbox size={16} />,       label: 'Inbox', badge: 50 },
        { icon: <CheckSquare size={16} />, label: 'Tasks' },
      ],
    },
    {
      title: 'DATA',
      items: [
        { icon: <Zap size={16} />, label: 'Data Pump' },
      ],
    },
    {
      title: 'BOOKINGS',
      items: [
        { icon: <Ticket size={16} />, label: 'All Tickets' },
      ],
    },
  ];

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-white border-r border-surface-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-surface-border">
        <div className="w-8 h-8 rounded-md bg-brand-500 flex items-center justify-center shrink-0">
          <Plane size={15} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">ARON APPEL</p>
          <p className="text-[11px] text-gray-500">Component Library</p>
        </div>
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {sections.map((section, si) => (
          <div key={si}>
            {section.title && (
              <p className="px-3 mb-1 text-[10px] font-semibold tracking-widest uppercase text-gray-400">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.label}>
                  <button
                    onClick={() => onNavigate(item.label)}
                    className={clsx(
                      'w-full text-left',
                      activePage === item.label ? 'nav-item-active' : 'nav-item',
                    )}
                  >
                    {item.icon}
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge !== undefined && (
                      <span className="badge bg-brand-50 text-brand-600">{item.badge}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom utilities */}
      <div className="px-3 pb-4 border-t border-surface-border pt-3 space-y-0.5">
        {[
          { icon: <Calculator size={16} />,  label: 'Calculator' },
          { icon: <ShieldCheck size={16} />, label: 'Super Admin' },
          { icon: <Settings size={16} />,    label: 'UI Settings' },
          { icon: <LogOut size={16} />,      label: 'Logout' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => onNavigate(item.label)}
            className={clsx(
              'w-full text-left',
              activePage === item.label ? 'nav-item-active' : 'nav-item',
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
