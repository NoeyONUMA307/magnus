import { useEffect, useRef, useState } from "react";
import type { AgentLogEntry } from "../types/index";

const API_URL = import.meta.env.VITE_API_URL || "";

interface UseStreamResult {
  events: AgentLogEntry[];
  connected: boolean;
}

export function useStream(scanId: string | null): UseStreamResult {
  const [events, setEvents] = useState<AgentLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!scanId) {
      setEvents([]);
      setConnected(false);
      return;
    }

    const es = new EventSource(`${API_URL}/api/stream/${scanId}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const entry = JSON.parse(event.data) as AgentLogEntry;
        setEvents((prev) => [...prev, entry]);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [scanId]);

  return { events, connected };
}
