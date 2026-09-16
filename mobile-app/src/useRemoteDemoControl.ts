import {useEffect, useRef} from 'react';
import {NativeModules, Platform} from 'react-native';
import {dangerousScenarioIds} from './faults';
import type {FaultScenario} from './types';

interface RemoteModule {
  takeRemoteCommand(): Promise<string | null>;
  publishRemoteState(value: string): void;
  finishRemoteCommand(id: string, status: string): void;
}
export async function executeRemoteCommand(
  command: {action: string; faultId?: string},
  options: {faults: FaultScenario[]; busy: boolean; inject: (fault: FaultScenario) => Promise<void>; recover: () => Promise<void>},
): Promise<void> {
  if (command.action === 'refresh') return;
  if (options.busy) throw new Error('busy');
  if (command.action === 'recover') return options.recover();
  if (command.action !== 'inject') throw new Error('unsupported_command');
  const fault = options.faults.find(item => item.id === command.faultId);
  // Destructive native scenarios retain the APK's explicit confirmation UI.
  if (!options.faults.length) throw new Error('catalog_not_ready');
  if (!fault) throw new Error('unknown_fault');
  if (dangerousScenarioIds.has(fault.id)) throw new Error('use_apk_confirmation');
  await options.inject(fault);
}

export function useRemoteDemoControl(options: {
  faults: FaultScenario[]; busy: boolean; activeId: string; phase: string;
  runId: string; rumUrl: string; traceUrl: string;
  inject: (fault: FaultScenario) => Promise<void>; recover: () => Promise<void>;
}) {
  const latest = useRef(options);
  latest.current = options;
  const native = NativeModules.DemoFaults as RemoteModule | undefined;
  const state = JSON.stringify({
    faults: options.faults.map(({id, title, layer, description}) => ({id, title, layer, description, disabled: dangerousScenarioIds.has(id)})),
    busy: options.busy, activeId: options.activeId, phase: options.phase,
    runId: options.runId, rumUrl: options.rumUrl, traceUrl: options.traceUrl,
  });
  const snapshot = useRef(state);
  snapshot.current = state;
  useEffect(() => {
    if (Platform.OS === 'android') native?.publishRemoteState?.(state);
  }, [native, state]);
  useEffect(() => {
    if (Platform.OS !== 'android' || !native?.takeRemoteCommand) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let ticks = 0;
    const poll = async () => {
      if (ticks++ % 20 === 0) native.publishRemoteState(snapshot.current);
      try {
        const raw = await native.takeRemoteCommand();
        if (raw && !stopped) {
          const command = JSON.parse(raw) as {id: string; action: string; faultId?: string};
          // A command can cold-start an APK stopped by the emulator idle policy.
          // Wait for its own catalog rather than trusting the previous process's snapshot.
          const deadline = Date.now() + 10000;
          while (command.action === 'inject' && !latest.current.faults.length && Date.now() < deadline && !stopped) {
            await new Promise<void>(resolve => setTimeout(resolve, 100));
          }
          if (stopped) return;
          let status = 'completed';
          try { await executeRemoteCommand(command, latest.current); }
          catch (error) { status = error instanceof Error ? error.message : 'failed'; }
          native.finishRemoteCommand(command.id, status);
        }
      } finally {
        if (!stopped) timer = setTimeout(() => { poll().catch(() => {}); }, 500);
      }
    };
    poll().catch(() => {});
    return () => { stopped = true; clearTimeout(timer); };
  }, [native]);
}
