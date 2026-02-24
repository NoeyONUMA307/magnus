import { useCallback, useEffect, useState } from "react";
import { getFindings } from "../lib/api";
import { FindingsTable } from "../components/FindingsTable";
import type { Finding } from "../types/index";

export function Findings() {
  const [findings, setFindings] = useState<Finding[]>([]);

  const refresh = useCallback(() => {
    getFindings().then(setFindings).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="content">
      <FindingsTable findings={findings} onFindingsChange={refresh} />
    </div>
  );
}
