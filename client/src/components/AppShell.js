import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, User, Video, Users, BarChart2,
  Search, Settings, LogOut,
} from 'lucide-react';
import { setToken } from '../api';
import { useAuth, isRole } from '../hooks/useAuth';

// ── Nav definitions ───────────────────────────────────────────────────────────
const NAV_MAIN = [
  { to: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard, roles: null },
  { to: '/me',           label: 'My Profile',   icon: User,            roles: ['employee', 'manager'] },
  { to: '/meetings',     label: 'Meetings',     icon: Video,           roles: null },
  { to: '/team',         label: 'Team',         icon: Users,           roles: ['manager', 'hr', 'admin'] },
  { to: '/reports',      label: 'Reports',      icon: BarChart2,       roles: ['manager', 'hr', 'admin'] },
  { to: '/intelligence', label: 'Intelligence', icon: Search,          roles: null },
];
const NAV_SETTINGS = [
  { to: '/settings', label: 'Settings', icon: Settings, roles: null },
];

function initials(name) {
  if (!name) return 'U';
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// ── NavItem ───────────────────────────────────────────────────────────────────
function NavItem({ item, expanded, active }) {
  const Icon = item.icon;
  return (
    <Link to={item.to} title={!expanded ? item.label : undefined}>
      <div
        className={`relative flex items-center px-3 py-2.5 rounded-lg transition-colors duration-150 cursor-pointer ${
          active
            ? 'bg-amber-500/15 text-amber-300'
            : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'
        }`}
      >
        {/* Active left-bar indicator — only when collapsed */}
        {active && !expanded && (
          <motion.div
            layoutId="activeIndicator"
            className="absolute left-0 w-0.5 h-5 bg-amber-400 rounded-r-full"
          />
        )}
        <Icon size={18} className={`shrink-0 ${active ? 'text-amber-400' : ''}`} />
        <motion.span
          animate={{ opacity: expanded ? 1 : 0 }}
          transition={{ duration: 0.15 }}
          className="ml-3 text-sm font-medium whitespace-nowrap overflow-hidden"
        >
          {item.label}
        </motion.span>
      </div>
    </Link>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────────
function AppShell({ children, title, subtitle }) {
  const navigate     = useNavigate();
  const location     = useLocation();
  const auth         = useAuth();
  const [expanded,   setExpanded]   = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const logout = () => { setToken(null); navigate('/'); };

  const filterNav = (items) =>
    items.filter((item) => !item.roles || isRole(auth, ...item.roles));

  const mainNav     = filterNav(NAV_MAIN);
  const settingsNav = filterNav(NAV_SETTINGS);

  const isActive = (to) =>
    location.pathname === to || location.pathname.startsWith(to + '/');

  return (
    <div className="min-h-screen bg-bg flex">

      {/* ── Desktop sidebar (hover-expand) ──────────────────────────────────── */}
      <motion.aside
        animate={{ width: expanded ? 240 : 64 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className="hidden lg:flex fixed left-0 top-0 h-screen bg-[#0c0a08]
                   border-r border-white/[0.06] flex-col overflow-hidden z-40"
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-white/[0.06] shrink-0">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30
                          flex items-center justify-center shrink-0">
            <span className="text-amber-400 font-bold text-sm">M</span>
          </div>
          <motion.span
            animate={{ opacity: expanded ? 1 : 0, x: expanded ? 0 : -8 }}
            transition={{ duration: 0.15 }}
            className="ml-2.5 font-semibold text-white text-sm whitespace-nowrap"
          >
            MeetingMetric
          </motion.span>
        </div>

        {/* Main nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2">
          {mainNav.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              expanded={expanded}
              active={isActive(item.to)}
            />
          ))}
        </nav>

        {/* Settings + user card */}
        <div className="px-2 pb-3 pt-3 space-y-0.5 border-t border-white/[0.06] shrink-0">
          {settingsNav.map((item) => (
            <NavItem
              key={item.to}
              item={item}
              expanded={expanded}
              active={isActive(item.to)}
            />
          ))}

          {auth && (
            <button
              type="button"
              onClick={logout}
              title={!expanded ? 'Log out' : undefined}
              className="w-full flex items-center gap-2.5 p-2 mt-1 rounded-lg
                         hover:bg-white/5 cursor-pointer transition-colors group"
            >
              <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30
                              flex items-center justify-center text-xs font-medium
                              text-amber-300 shrink-0">
                {initials(auth.fullName || auth.email)}
              </div>
              <motion.div
                animate={{ opacity: expanded ? 1 : 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 min-w-0 text-left overflow-hidden"
              >
                <p className="text-xs font-medium text-zinc-300 truncate whitespace-nowrap">
                  {auth.fullName || auth.email}
                </p>
                <p className="text-[10px] text-zinc-600 capitalize whitespace-nowrap">
                  {auth.role}
                </p>
              </motion.div>
              <motion.div
                animate={{ opacity: expanded ? 1 : 0 }}
                transition={{ duration: 0.15 }}
                className="shrink-0"
              >
                <LogOut
                  size={12}
                  className="text-zinc-600 group-hover:text-zinc-400 transition-colors"
                />
              </motion.div>
            </button>
          )}
        </div>
      </motion.aside>

      {/* ── Mobile sidebar ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="mobile-overlay"
              className="fixed inset-0 bg-black/50 z-30 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              key="mobile-sidebar"
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-0 top-0 h-screen w-60 bg-[#0c0a08]
                         border-r border-white/[0.06] flex flex-col z-40 lg:hidden"
            >
              {/* Logo */}
              <div className="h-14 flex items-center px-4 border-b border-white/[0.06] shrink-0">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30
                                flex items-center justify-center shrink-0">
                  <span className="text-amber-400 font-bold text-sm">M</span>
                </div>
                <span className="ml-2.5 font-semibold text-white text-sm">MeetingMetric</span>
              </div>

              {/* Nav */}
              <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
                {[...mainNav, ...settingsNav].map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                    >
                      <div
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg
                          transition-colors duration-150 ${
                            active
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/5'
                          }`}
                      >
                        <Icon
                          size={18}
                          className={`shrink-0 ${active ? 'text-amber-400' : ''}`}
                        />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {/* User card */}
              {auth && (
                <div className="p-2 border-t border-white/[0.06] shrink-0">
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full flex items-center gap-2.5 p-2 rounded-lg
                               hover:bg-white/5 cursor-pointer transition-colors group"
                  >
                    <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30
                                    flex items-center justify-center text-xs font-medium
                                    text-amber-300 shrink-0">
                      {initials(auth.fullName || auth.email)}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-xs font-medium text-zinc-300 truncate">
                        {auth.fullName || auth.email}
                      </p>
                      <p className="text-[10px] text-zinc-600 capitalize">{auth.role}</p>
                    </div>
                    <LogOut
                      size={12}
                      className="text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors"
                    />
                  </button>
                </div>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 rounded-lg
                   bg-[#0c0a08] border border-white/10"
        aria-label="Toggle navigation"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      {/* ml-16 always — sidebar overlays on hover expand */}
      <main className="flex-1 ml-0 lg:ml-16 min-h-screen">
        {(title || subtitle) && (
          <div className="px-6 md:px-8 pt-6 pb-2">
            {title    && <h1 className="text-2xl font-bold text-white">{title}</h1>}
            {subtitle && <p className="text-muted text-sm mt-0.5">{subtitle}</p>}
          </div>
        )}
        <div className="px-6 md:px-8 py-4">
          {children}
        </div>
      </main>
    </div>
  );
}

export default AppShell;
