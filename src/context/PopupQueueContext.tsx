"use client";

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";

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
    setQueue((current) => current.some((item) => item.id === id)
      ? current.filter((item) => item.id !== id)
      : current);
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
  const register = queue?.register;
  const unregister = queue?.unregister;
  const activeId = queue?.activeId ?? null;
  const reactId = useId();
  const popupId = `popup-${reactId}`;

  useEffect(() => {
    if (!register || !unregister) return;

    if (!isOpen) {
      unregister(popupId);
      return;
    }

    register({ id: popupId, dedupeKey });
    return () => {
      unregister(popupId);
    };
  }, [dedupeKey, isOpen, popupId, register, unregister]);

  return !queue || (isOpen && activeId === popupId);
}
