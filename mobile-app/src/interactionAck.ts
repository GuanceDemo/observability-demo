import {NativeModules} from 'react-native';

export interface NativeInteractionAckModule {
  acknowledgeInteraction?: (action: string) => void;
}

const nativeInteractionAck = NativeModules.DemoFaults as
  | NativeInteractionAckModule
  | undefined;

export function normalizeInteractionAction(action: string): string {
  return action
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function acknowledgeInteraction(
  action: string,
  nativeModule: NativeInteractionAckModule | undefined = nativeInteractionAck,
): void {
  const normalizedAction = normalizeInteractionAction(action);
  if (!normalizedAction || !nativeModule?.acknowledgeInteraction) return;
  nativeModule.acknowledgeInteraction(normalizedAction);
}
