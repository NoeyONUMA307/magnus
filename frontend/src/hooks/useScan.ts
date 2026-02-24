import { useEffect, useRef, useState } from "react";
import { getScan, getFindingsByScan, getScanDiff } from "../lib/api";
import type { ScanDiff } from "../lib/api";
import type { Scan, Finding } from "../types/index";

interface UseScanResult {
  scan: Scan | null;
  findings: Finding[];
  diff: ScanDiff | null;
  loading: boolean;
  error: string | null;
  refetchFindings: () => void;
}

export function useScan(scanId: string | null): UseScanResult {
  const [scan, setScan] = useState<Scan | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [diff, setDiff] = useState<ScanDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const diffFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scanId) {
      setScan(null);
      setFindings([]);
      setDiff(null);
      diffFetchedRef.current = null;
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDiff(null);
    diffFetchedRef.current = null;

    function fetchData() {
      Promise.all([getScan(scanId!), getFindingsByScan(scanId!)])
        .then(([scanData, findingsData]) => {
          if (cancelled) return;
          setScan(scanData);
          setFindings(findingsData);
          // Stop polling when scan is done
          if (scanData.status !== "running" && scanData.status !== "pending") {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            // Fetch diff once when scan is complete
            if (diffFetchedRef.current !== scanId) {
              diffFetchedRef.current = scanId;
              getScanDiff(scanId!).then((d) => {
                if (!cancelled) setDiff(d);
              }).catch(() => {});
            }
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Failed to load scan");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    fetchData();

    // Poll every 3s to pick up new findings and status changes
    pollRef.current = setInterval(fetchData, 3000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [scanId]);

  function refetchFindings() {
    if (!scanId) return;
    getFindingsByScan(scanId).then(setFindings).catch(() => {});
  }

  return { scan, findings, diff, loading, error, refetchFindings };
}
