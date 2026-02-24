import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Sidebar } from "./components/Sidebar";
import { NewScanModal } from "./components/NewScanModal";
import { SettingsModal } from "./components/SettingsModal";
import { AboutModal } from "./components/AboutModal";
import { Onboarding } from "./components/Onboarding";
import { Overview } from "./pages/Overview";
import { Findings } from "./pages/Findings";
import { History } from "./pages/History";
import { Reports } from "./pages/Reports";
import { Integrations } from "./pages/Integrations";
import { Scheduled } from "./pages/Scheduled";
import { getScans, getFindings, getSettings } from "./lib/api";
import type { Scan, Finding } from "./types/index";

function AppInner() {
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem("magnus-theme");
    return stored === "dark" ? "dark" : "light";
  });
  const [scans, setScans] = useState<Scan[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [showNewScan, setShowNewScan] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [returnToNewScan, setReturnToNewScan] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem("magnus-onboarding-complete");
  });
  const [activeModel, setActiveModel] = useState("");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("magnus-theme", theme);
  }, [theme]);

  const refreshScans = useCallback(() => {
    getScans().then((data) => {
      setScans(data);
      const first = data[0];
      if (first && !activeScanId) {
        setActiveScanId(first.id);
      }
    }).catch(() => {});
  }, [activeScanId]);

  useEffect(() => {
    refreshScans();
  }, [refreshScans]);

  useEffect(() => {
    getFindings().then(setFindings).catch(() => {});
  }, []);

  const refreshSettings = useCallback(() => {
    getSettings().then((s) => {
      if (s.llm_model) setActiveModel(s.llm_model);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  const anyModalOpen = showNewScan || showSettings || showAbout;
  useEffect(() => {
    if (anyModalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [anyModalOpen]);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const handleOpenNewScan = useCallback(() => {
    setShowNewScan(true);
  }, []);

  const handleScanCreated = useCallback((scan: Scan) => {
    setShowNewScan(false);
    setActiveScanId(scan.id);
    setScans((prev) => [scan, ...prev]);
    navigate("/");
  }, [navigate]);

  return (
    <>
      <Nav onToggleTheme={handleToggleTheme} onNewScan={handleOpenNewScan} onSettings={() => setShowSettings(true)} onAbout={() => setShowAbout(true)} onHelp={() => setShowOnboarding(true)} activeModel={activeModel} />
      <div className="app-layout">
        <Sidebar
          scans={scans}
          findingsCount={findings.length}
          activeScanId={activeScanId}
          activeModel={activeModel}
          onNewScan={handleOpenNewScan}
          onSelectScan={(id) => { setActiveScanId(id); navigate("/"); }}
        />
        <main className="main">
          <Routes>
            <Route path="/" element={
              <Overview
                activeScanId={activeScanId}
                onScanCreated={(scan) => {
                  setActiveScanId(scan.id);
                  setScans((prev) => [scan, ...prev]);
                }}
              />
            } />
            <Route path="/findings" element={<Findings />} />
            <Route path="/history" element={<History onSelectScan={(id) => { setActiveScanId(id); navigate("/"); }} />} />
            <Route path="/scheduled" element={<Scheduled />} />
            <Route path="/reports" element={<Reports onSelectScan={(id) => { setActiveScanId(id); navigate("/"); }} />} />
            <Route path="/integrations" element={<Integrations />} />
          </Routes>
        </main>
      </div>
      <NewScanModal
        open={showNewScan}
        activeModel={activeModel}
        onClose={() => setShowNewScan(false)}
        onCreated={handleScanCreated}
        onOpenSettings={() => { setReturnToNewScan(true); setShowSettings(true); }}
      />
      <SettingsModal
        open={showSettings}
        onClose={() => {
          setShowSettings(false);
          refreshSettings();
          if (returnToNewScan) {
            setReturnToNewScan(false);
            setShowNewScan(true);
          }
        }}
      />
      <AboutModal
        open={showAbout}
        onClose={() => setShowAbout(false)}
        activeModel={activeModel}
      />
      <Onboarding
        open={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onNewScan={handleOpenNewScan}
      />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
