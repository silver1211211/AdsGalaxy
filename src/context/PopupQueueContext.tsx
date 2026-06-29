"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type QueueItem = {
  id: string;
  dedupeKey: string;
};

type PopupQueueContextValue = {
  register: (item: QueueItem) => void;
  unregister: (id: string) => void;
  activeId: string | null;
};

const PopupQueueContext = createContext<PopupQueueContextValue | null>(null);

export function PopupQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const register = useCallback((item: QueueItem) => {
    setQueue((current) => {
      if (current.some((queued) => queued.id === item.id || queued.dedupeKey === item.dedupeKey)) {
        return current;
      }
      return [...current, item];
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setQueue((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo<PopupQueueContextValue>(() => ({
    register,
    unregister,
    activeId: queue[0]?.id || null,
  }), [queue, register, unregister]);

  return (
    <PopupQueueContext.Provider value={value}>
      {children}
    </PopupQueueContext.Provider>
  );
}

export function usePopupQueue(isOpen: boolean, dedupeKey: string) {
  const queue = useContext(PopupQueueContext);
  const idRef = useRef(`popup-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!queue) return;

    if (isOpen && !registeredRef.current) {
      registeredRef.current = true;
      queue.register({ id: idRef.current, dedupeKey });
    }

    if (!isOpen && registeredRef.current) {
      queue.unregister(idRef.current);
      registeredRef.current = false;
    }
  }, [dedupeKey, isOpen, queue]);

  useEffect(() => {
    return () => {
      if (queue && registeredRef.current) {
        queue.unregister(idRef.current);
        registeredRef.current = false;
      }
    };
  }, [queue]);

  return !queue || (registeredRef.current && queue.activeId === idRef.current);
}
