import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";

interface NavProps {
  onToggleTheme: () => void;
  onNewScan: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onHelp: () => void;
  activeModel?: string;
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1L2 3.5V7.5C2 10.2 4.2 12.7 7 13.5C9.8 12.7 12 10.2 12 7.5V3.5L7 1Z"
        fill="var(--surface)"
        opacity="0.9"
      />
    </svg>
  );
}

function OverviewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="4.5" height="4.5" rx="1" />
      <rect x="7.5" y="1" width="4.5" height="4.5" rx="1" />
      <rect x="1" y="7.5" width="4.5" height="4.5" rx="1" />
      <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" />
    </svg>
  );
}

function FindingsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="4.5" />
      <line x1="6" y1="4" x2="6" y2="6.5" strokeLinecap="round" />
      <circle cx="6" cy="8.2" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6.5" cy="6.5" r="5" />
      <path d="M6.5 3.5V6.5L8.5 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h6l3 3v7a1 1 0 01-1 1H2a1 1 0 01-1-1V3a1 1 0 011-1z" strokeLinejoin="round" />
      <path d="M8 2v3h3" strokeLinejoin="round" />
      <line x1="3.5" y1="7.5" x2="9.5" y2="7.5" strokeLinecap="round" />
      <line x1="3.5" y1="9.5" x2="7" y2="9.5" strokeLinecap="round" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="2.5" />
      <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.3 3.3l.7.7M10 10l.7.7M10 3.3l-.7.7M3.3 10l-.7.7" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M6.6 1.2h2.8l.4 2 1.5.9 1.9-.7 1.4 2.4-1.5 1.3v1.8l1.5 1.3-1.4 2.4-1.9-.7-1.5.9-.4 2H6.6l-.4-2-1.5-.9-1.9.7-1.4-2.4 1.5-1.3V7.1L1.4 5.8l1.4-2.4 1.9.7 1.5-.9.4-2z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="6" y1="1" x2="6" y2="11" strokeLinecap="round" />
      <line x1="1" y1="6" x2="11" y2="6" strokeLinecap="round" />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="2" y1="4" x2="14" y2="4" strokeLinecap="round" />
      <line x1="2" y1="8" x2="14" y2="8" strokeLinecap="round" />
      <line x1="2" y1="12" x2="14" y2="12" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="4" y1="4" x2="12" y2="12" strokeLinecap="round" />
      <line x1="12" y1="4" x2="4" y2="12" strokeLinecap="round" />
    </svg>
  );
}

const navItems = [
  { to: "/", label: "Overview", icon: <OverviewIcon />, end: true },
  { to: "/findings", label: "Findings", icon: <FindingsIcon />, end: false },
  { to: "/history", label: "History", icon: <HistoryIcon />, end: false },
  { to: "/reports", label: "Reports", icon: <ReportsIcon />, end: false },
];

export function Nav({ onToggleTheme, onNewScan, onSettings, onAbout, onHelp, activeModel }: NavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <nav className="nav">
      <button className="nav-logo" onClick={onAbout} type="button">
        <div className="nav-logo-icon">
          <ShieldIcon />
        </div>
        <span className="nav-logo-name">Magnus</span>
      </button>

      {/* Desktop nav items — hidden on mobile via CSS */}
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
        >
          {item.icon}
          <span className="nav-btn-label">{item.label}</span>
        </NavLink>
      ))}

      <div className="nav-right">
        {/* Desktop-only buttons */}
        <button className="btn btn-ghost nav-desktop-only" onClick={onSettings} aria-label="Settings">
          <SettingsIcon />
          <span className="nav-btn-label">{activeModel || "Settings"}</span>
        </button>
        <button className="nav-help-btn nav-desktop-only" onClick={onHelp} aria-label="Help" title="Getting started">?</button>
        <button className="btn btn-ghost nav-desktop-only" onClick={onToggleTheme} aria-label="Toggle theme">
          <ThemeIcon />
          <span className="nav-btn-label">Theme</span>
        </button>

        {/* Always visible */}
        <button className="btn btn-primary" onClick={onNewScan}>
          <PlusIcon />
          <span className="nav-btn-label">New Scan</span>
        </button>

        {/* Hamburger — mobile only */}
        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          {menuOpen ? <CloseIcon /> : <HamburgerIcon />}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="nav-mobile-menu">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-mobile-link${isActive ? " active" : ""}`}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
          <div className="nav-mobile-divider" />
          <button className="nav-mobile-link" onClick={() => { setMenuOpen(false); onSettings(); }}>
            <SettingsIcon />
            {activeModel || "Settings"}
          </button>
          <button className="nav-mobile-link" onClick={() => { setMenuOpen(false); onHelp(); }}>
            <span style={{ fontSize: "13px", fontWeight: 600 }}>?</span>
            Help
          </button>
          <button className="nav-mobile-link" onClick={() => { setMenuOpen(false); onToggleTheme(); }}>
            <ThemeIcon />
            Toggle Theme
          </button>
        </div>
      )}
    </nav>
  );
}
