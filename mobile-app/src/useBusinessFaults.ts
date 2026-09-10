import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createBusinessFaultRun, faultContext, type BusinessFaultId, type BusinessFaultRun} from './businessFaults';
import {recordFaultEvent, setFaultObservationContext} from './observability';
import type {FaultScenario} from './types';

export function useBusinessFaults() {
  const [run, setRun] = useState<BusinessFaultRun | null>(null);
  const current = useRef<BusinessFaultRun | null>(null);
  const mounted = useRef(true);

  const publish = useCallback(async (next: BusinessFaultRun, properties: object = {}) => {
    current.current = next;
    if (mounted.current) setRun(next);
    await setFaultObservationContext(faultContext(next));
    if (current.current !== next || !mounted.current) return;
    recordFaultEvent(`mobile_fault_${next.phase}`, {...faultContext(next), ...properties});
  }, []);

  const arm = useCallback(async (scenario: FaultScenario) => {
    const next = createBusinessFaultRun(scenario);
    await publish(next);
    return next;
  }, [publish]);

  const enabled = useCallback((id: BusinessFaultId) =>
    current.current?.scenarioId === id && current.current.phase !== 'recovered', []);

  const trigger = useCallback(async (id: BusinessFaultId, properties: object = {}) => {
    const active = current.current;
    if (!active || active.scenarioId !== id || active.phase === 'recovered') return null;
    if (active.phase === 'triggered') return active;
    const next: BusinessFaultRun = {...active, phase: 'triggered', triggeredAt: Date.now()};
    await publish(next, properties);
    return current.current === next ? next : null;
  }, [publish]);

  const recover = useCallback(async (reason = 'manual', properties: object = {}) => {
    const active = current.current;
    if (!active || active.phase === 'recovered') return active;
    const next: BusinessFaultRun = {...active, phase: 'recovered', recoveredAt: Date.now()};
    await publish(next, {recovery_reason: reason, ...properties});
    return next;
  }, [publish]);

  const clearContext = useCallback(async () => {
    await recover('switch_scenario');
    current.current = null;
    await setFaultObservationContext(null);
  }, [recover]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (current.current) setFaultObservationContext(null).catch(() => undefined);
      current.current = null;
    };
  }, []);

  return useMemo(() => ({run, arm, enabled, trigger, recover, clearContext, current}),
    [run, arm, enabled, trigger, recover, clearContext]);
}
