import { useCallback, useLayoutEffect, useRef } from "react";

export function useEffectEvent<T extends (...args: any[]) => any>(handler: T): T {
  const handlerRef = useRef<T>(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback((...args: Parameters<T>) => handlerRef.current(...args), []) as T;
}
