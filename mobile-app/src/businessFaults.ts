import {NativeModules} from 'react-native';
import type {DemoRequestMetadata} from './api';
import type {FaultScenario, StoreLanguage} from './types';

export const BUSINESS_FAULT_IDS = {
  detail: 'android_detail_white_screen',
  crash: 'android_checkout_crash',
  loading: 'android_content_loading',
  anr: 'android_detail_anr',
  freeze: 'android_detail_freeze',
} as const;
export type BusinessFaultId = typeof BUSINESS_FAULT_IDS[keyof typeof BUSINESS_FAULT_IDS];
export type FaultPhase = 'armed' | 'triggered' | 'recovered';
export interface BusinessFaultRun {
  id: string;
  scenarioId: BusinessFaultId;
  layer: string;
  phase: FaultPhase;
  startedAt: number;
  triggeredAt?: number;
  recoveredAt?: number;
}

export function isBusinessFault(id: string): id is BusinessFaultId {
  return (Object.values(BUSINESS_FAULT_IDS) as string[]).includes(id);
}

export function faultContext(run: BusinessFaultRun): Record<string, string | number> {
  return {fault_run_id: run.id, fault_id: run.scenarioId, fault_layer: run.layer,
    fault_phase: run.phase, fault_started_at: run.startedAt};
}

export function faultRequestMetadata(
  metadata: DemoRequestMetadata,
  run: BusinessFaultRun | null,
): DemoRequestMetadata {
  return run ? {...metadata, faultRunId: run.id, faultId: run.scenarioId, faultPhase: run.phase} : metadata;
}

export function createBusinessFaultRun(scenario: FaultScenario): BusinessFaultRun {
  if (!isBusinessFault(scenario.id)) throw new Error('Not a business-triggered fault');
  const startedAt = Date.now();
  return {id: `fault-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    scenarioId: scenario.id, layer: scenario.layer, phase: 'armed', startedAt};
}

export function checkoutCrashEnabled(): boolean {
  return NativeModules.DemoFaults?.checkoutCrashEnabled === true;
}

export async function crashCheckout(): Promise<void> {
  const module = NativeModules.DemoFaults;
  if (!checkoutCrashEnabled() || !module?.crashCheckout) {
    throw new Error('Checkout crash requires the Android demonstration build');
  }
  await module.crashCheckout();
}

export function nativePerformanceEnabled(): boolean {
  return NativeModules.DemoFaults?.nativePerformanceEnabled === true;
}

export function cancelBookDetailsBlock(): void {
  NativeModules.DemoFaults?.cancelBookDetailsBlock?.();
}

export async function blockBookDetails(kind: 'anr' | 'freeze'): Promise<number> {
  const module = NativeModules.DemoFaults;
  if (!nativePerformanceEnabled() || !module?.blockBookDetails) {
    throw new Error('Native performance faults require the Android demonstration build');
  }
  return module.blockBookDetails(kind);
}

const COPY: Record<BusinessFaultId, Record<StoreLanguage, {title: string; trigger: string; observation: string}>> = {
  android_detail_anr: {
    zh: {title: '图书详情 ANR', trigger: '打开图书后原生主线程阻塞约 20 秒；期间点击页面以触发输入无响应。可能出现系统 ANR 提示，请选择等待。', observation: '在 Error 查看 SDK 实际采集的 anr_error/anr_crash 和主线程堆栈；仅操作记录不代表 ANR 已采集。等待结束后自动恢复。'},
    en: {title: 'Book detail ANR', trigger: 'Open a book to block the native UI thread for 20 seconds. Tap during the stall; choose Wait if Android shows an ANR dialog.', observation: 'Inspect SDK anr_error/anr_crash and main-thread stacks in Error. An action alone does not prove ANR capture. Recovers when the block ends.'},
  },
  android_detail_freeze: {
    zh: {title: '图书详情原生卡顿', trigger: '打开图书后原生主线程阻塞约 2 秒，随后自动恢复；用于演示超过 1 秒阈值的 UI 卡顿。', observation: '在 Long Task 查看 SDK 自动采集的 long_task、持续时间和阻塞堆栈，关联当前 View；卡顿不冒充 Crash Error。'},
    en: {title: 'Book detail native freeze', trigger: 'Open a book to block the native UI thread for 2 seconds, then recover automatically.', observation: 'Inspect SDK long_task duration and blocking stack in Long Task, linked to the current View. A freeze is not a Crash Error.'},
  },
  android_detail_white_screen: {
    zh: {title: '商品详情白屏', trigger: '收起面板，打开任意图书，详情内容将因渲染异常变为空白。', observation: '回放确认打开的商品，结合真实 TypeError 和 JS 堆栈定位缺失字段；恢复基线后重新加载。'},
    en: {title: 'Blank book details', trigger: 'Close this panel and open a book. A render error leaves its content blank.', observation: 'Use replay, the real TypeError and JS stack to locate the missing field. Restore baseline to reload.'},
  },
  android_checkout_crash: {
    zh: {title: '结算闪退', trigger: '进入购物车，点击结算，在 App 内确认后触发真实闪退；不会提交订单。', observation: '重启 App，关联崩溃前回放、原生 Crash 堆栈与本轮标识，定位结算数据异常。'},
    en: {title: 'Checkout crash', trigger: 'Open the cart, check out and confirm in the app. The app crashes before submitting an order.', observation: 'Restart and correlate the preceding replay, native Crash stack and run ID to locate invalid checkout data.'},
  },
  android_content_loading: {
    zh: {title: '请求成功但持续加载', trigger: '收起面板，打开任意图书；接口成功后，详情仍停在加载中。', observation: '对照 HTTP 200 Resource、内容就绪检测和状态转换记录，定位前端未进入 ready 的原因。'},
    en: {title: 'Loading after a successful request', trigger: 'Close this panel and open a book. Loading continues after the request succeeds.', observation: 'Compare the HTTP 200 Resource, content readiness check and state transition to locate the missing ready state.'},
  },
};

// The APK owns its versioned client catalog; the server still owns server faults.
export function androidFaultCatalog(serverScenarios: FaultScenario[], language: StoreLanguage): FaultScenario[] {
  const clients = Object.values(BUSINESS_FAULT_IDS).map(id => {
    const copy = COPY[id][language];
    const performance = id === BUSINESS_FAULT_IDS.anr || id === BUSINESS_FAULT_IDS.freeze;
    const disabled = performance ? !nativePerformanceEnabled() : id === BUSINESS_FAULT_IDS.crash && !checkoutCrashEnabled();
    return {
      id, title: copy.title, layer: 'android', kind: id, service: 'mall-mobile',
      target: id === BUSINESS_FAULT_IDS.crash ? 'checkout' : 'book-detail',
      mode: 'client', ttlSeconds: 0, clientSide: true, execution: 'client' as const,
      platforms: ['android' as const], disabled,
      description: disabled ? (language === 'en' ? 'Requires an enabled Android demonstration build.' : '当前安装包未启用此原生故障，请使用演练构建。') : copy.trigger,
      expectedObservation: copy.observation,
    };
  });
  return [...clients, ...serverScenarios.filter(item => item.execution === 'server')];
}

export function faultLayerGroup(layer: string): string {
  if (['service', 'backend'].includes(layer)) return 'backend';
  if (['dependency', 'jvm', 'infrastructure'].includes(layer)) return 'infrastructure';
  return layer;
}

export function businessFaultCopy(id: string, language: StoreLanguage) {
  return isBusinessFault(id) ? COPY[id][language] : null;
}

export function localizeBusinessFault(scenario: FaultScenario, language: StoreLanguage): FaultScenario {
  const copy = businessFaultCopy(scenario.id, language);
  return copy ? {...scenario, title: copy.title, description: copy.trigger, expectedObservation: copy.observation} : scenario;
}

export function faultPhaseLabel(phase: FaultPhase, language: StoreLanguage): string {
  return language === 'en'
    ? {armed: 'Ready for your next action', triggered: 'Triggered', recovered: 'Baseline restored'}[phase]
    : {armed: '已就绪，等待业务操作', triggered: '已触发', recovered: '已恢复基线'}[phase];
}
