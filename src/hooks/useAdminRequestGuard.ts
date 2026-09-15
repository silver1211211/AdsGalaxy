"use client";

import { useCallback, useEffect, useRef } from "react";

export function useAdminRequestGuard() {
  const activeController = useRef<AbortController | null>(null);

  useEffect(() => () => activeController.current?.abort(), []);

  return useCallback(() => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    return controller;
  }, []);
}
