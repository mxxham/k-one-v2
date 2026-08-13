import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Truck,
  PackageOpen,
  Boxes,
  BookOpen,
  ClipboardCheck,
  ArrowLeftRight,
  FileSpreadsheet,
  Wand2,
  Box,
  Users,
  MapPin,
  BarChart3,
  UserCog,
  History,
  ShieldAlert,
  Warehouse,
  LogOut,
  Menu,
  X,
  Eye,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { roleLabel } from '@/lib/format';
import { LucideIcon } from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavSection {
  section: string;
  writeOnly?: boolean;
  adminOnly?: boolean;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    section: 'Main',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/inbound', label: 'Inbound', icon: Truck },
      { to: '/outbound', label: 'Outbound', icon: PackageOpen },
      { to: '/stock', label: 'Stock', icon: Boxes },
      { to: '/ledger', label: 'Stock Ledger', icon: BookOpen },
      { to: '/stocktake', label: 'Stock Take', icon: ClipboardCheck },
      { to: '/bin-transfer', label: 'Bin Transfer', icon: ArrowLeftRight },
    ],
  },
  {
    section: 'Excel Import',
    writeOnly: true,
    items: [
      { to: '/import', label: 'Import Excel', icon: FileSpreadsheet },
      { to: '/import-auto', label: 'Auto Import', icon: Wand2 },
    ],
  },
  {
    section: 'Master Data',
    writeOnly: true,
    items: [
      { to: '/products', label: 'Products', icon: Box },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/locations', label: 'Locations', icon: MapPin },
    ],
  },
  {
    section: 'Reports & Tools',
    items: [{ to: '/reports', label: 'Reports', icon: BarChart3 }],
  },
  {
    section: 'Admin',
    adminOnly: true,
    items: [
      { to: '/users', label: 'Users', icon: UserCog },
      { to: '/activity-log', label: 'Activity Log', icon: History },
      { to: '/reset-data', label: 'Reset Data', icon: ShieldAlert },
    ],
  },
];

export default function Layout() {
  const { user, canWrite, canAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const pageTitle = (() => {
    const seg = location.pathname.split('/')[1];
    const map: Record<string, string> = {
      '': 'Dashboard',
      inbound: 'Inbound',
      outbound: 'Outbound',
      stock: 'Stock',
      ledger: 'Stock Ledger',
      stocktake: 'Stock Take',
      'bin-transfer': 'Bin Transfer',
      products: 'Products',
      customers: 'Customers',
      locations: 'Locations',
      reports: 'Reports',
      import: 'Import Excel',
      'import-auto': 'Auto Import',
      users: 'Users',
      'activity-log': 'Activity Log',
      'reset-data': 'Reset Data',
    };
    return map[seg] || 'K-one';
  })();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-[98] md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`w-64 bg-[#0d1f1f] text-white flex-shrink-0 overflow-y-auto flex flex-col z-[99] fixed inset-y-0 left-0 transform transition-transform md:relative md:transform-none ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-5 border-b border-brand-500/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center">
              <Warehouse className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <div className="font-bold leading-tight">K-one</div>
              <div className="text-[10px] text-white/45 tracking-wide uppercase">warehouse management</div>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="px-2 py-3 flex-1 flex flex-col gap-0.5">
          {NAV.map((section) => {
            const visibleItems = section.writeOnly
              ? canWrite
                ? section.items
                : []
              : section.adminOnly
                ? canAdmin
                  ? section.items
                  : []
                : section.items;
            if (!visibleItems.length) return null;
            return (
              <div key={section.section}>
                <div className="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-brand-300/50">
                  {section.section}
                </div>
                {visibleItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `sidebar-link flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-white/75 hover:text-white transition-all ${
                        isActive ? 'active' : ''
                      }`
                    }
                  >
                    <item.icon className="w-4 h-4 opacity-80" />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-brand-500/30 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{user?.full_name?.[0]?.toUpperCase() || 'U'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold truncate">{user?.full_name || 'User'}</div>
            <div className="text-[10px] text-white/40">{roleLabel(user?.role || '')}</div>
          </div>
          <button onClick={handleLogout} title="Logout" className="text-white/40 hover:text-white">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-gray-200 px-4 h-14 flex items-center justify-between flex-shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="w-0.5 h-5 bg-gradient-to-b from-brand-500 to-brand-300 rounded" />
            <h2 className="font-bold text-[15px] text-[#0d1f1f] truncate">{pageTitle}</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-brand-50 rounded-lg border border-brand-100">
              <span className="text-xs text-gray-600 font-medium">{user?.full_name}</span>
              <span className="text-[10px] font-bold text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full uppercase">
                {roleLabel(user?.role || '')}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="w-8 h-8 rounded-lg bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 flex items-center justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {user && user.role === 'viewer' && (
          <div className="bg-brand-600 text-white px-4 py-1 text-[11px] font-bold text-center tracking-widest uppercase border-b border-brand-700 flex items-center justify-center gap-1.5">
            <Eye className="w-3 h-3" /> Mode View Only
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
