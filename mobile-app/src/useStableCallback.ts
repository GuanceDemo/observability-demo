import {useCallback, useLayoutEffect, useRef} from 'react';

/** Stable UI callback identity, with the latest committed business state. */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; }, [callback]);
  return useCallback((...args: Args) => latest.current(...args), []);
}
