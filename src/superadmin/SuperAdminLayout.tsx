import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, Building2, PlusSquare, Users, ShieldCheck,
  UserPlus, ClipboardList, HeadphonesIcon, Activity, ArrowLeft, Plane,
} from 'lucide-react';
import clsx from 'clsx';

interface NavItem {
  to: string;
  label: string;
  description: string;
  icon: React.ElementType;
  end?: boolean;
}

const navItems: NavItem[] = [
  {
    to: '/superadmin',
    label: 'Dashboard',
    description: 'Platform overview & KPIs',
    icon: LayoutDashboard,
    end: true,
  },
  {
    to: '/superadmin/tenants',
    label: 'Tenant Analytics',
    description: 'Health scores and revenue metrics',
    icon: BarChart3,
  },
  {
    to: '/superadmin/tenants-list',
    label: 'Manage Tenants',
    description: 'Create, edit, and delete tenants',
    icon: Building2,
  },
  {
    to: '/superadmin/add-tenant',
    label: 'Add Tenant',
    description: 'Create a new workspace',
    icon: PlusSquare,
  },
  {
    to: '/superadmin/users',
    label: 'Users',
    description: 'All platform users',
    icon: Users,
  },
  {
    to: '/superadmin/super-admins',
    label: 'Super Admins',
    description: 'Grant & revoke superadmin access',
    icon: ShieldCheck,
  },
  {
    to: '/superadmin/add-admin',
    label: 'Add User',
    description: 'Create a new platform user',
    icon: UserPlus,
  },
  {
    to: '/superadmin/signup-approvals',
    label: 'Signup Approvals',
    description: 'Review pending registrations',
    icon: ClipboardList,
  },
  {
    to: '/superadmin/support-queue',
    label: 'Support Queue',
    description: 'Auto-detected issues across tenants',
    icon: HeadphonesIcon,
  },
  {
    to: '/superadmin/logs-analytics',
    label: 'Logs & Analytics',
    description: 'API request logs',
    icon: Activity,
  },
];

export default function SuperAdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden bg-surface-subtle">
      {/* Sidebar */}
      <aside className="flex flex-col w-64 min-h-screen bg-sidebar-bg shrink-0 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <ShieldCheck size={15} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-sidebar-textHigh truncate">Super Admin</p>
            <p className="text-[10px] text-sidebar-text">TravelFlow Platform</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all cursor-pointer w-full text-left',
                  isActive
                    ? 'bg-sidebar-active text-white'
                    : 'text-sidebar-text hover:text-sidebar-textHigh hover:bg-sidebar-hover',
                )
              }
            >
              <item.icon size={15} className="shrink-0" />
              <span className="text-sm font-medium truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Back to app */}
        <div className="px-3 pb-4 border-t border-slate-800 pt-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sidebar-text hover:text-sidebar-textHigh hover:bg-sidebar-hover transition-all w-full text-left"
          >
            <ArrowLeft size={15} className="shrink-0" />
            <span className="text-sm font-medium">Back to App</span>
          </button>
          <div className="flex items-center gap-2 mt-3 px-3">
            <Plane size={11} className="text-slate-600" />
            <span className="text-[10px] text-slate-600">TravelFlow · ticket-sum-prod</span>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
