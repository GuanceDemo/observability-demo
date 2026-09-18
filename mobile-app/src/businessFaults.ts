import {NativeModules} from 'react-native';
import type {DemoRequestMetadata} from './api';
import type {FaultScenario, StoreLanguage} from './types';

export const BUSINESS_FAULT_IDS = {
  detail: 'android_detail_white_screen',
  crash: 'android_checkout_crash',
  nativeCrash: 'android_checkout_native_crash',
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

export function nativeCrashEnabled(): boolean {
  return NativeModules.DemoFaults?.nativeCrashEnabled === true;
}

export async function crashNativeCheckout(): Promise<void> {
  const module = NativeModules.DemoFaults;
  if (!nativeCrashEnabled() || !module?.crashNativeCheckout) {
    throw new Error('C/C++ crash requires the Android demonstration build');
  }
  await module.crashNativeCheckout();
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
    zh: {title: '图书详情 ANR', trigger: '打开图书后阻塞原生主线程（最多 120 秒）。点击页面触发系统 ANR，在系统弹窗选择“关闭应用”，再重新打开 App；不要用强制停止代替。', observation: 'Android 11 及以上由 SDK 在重启后读取 ANR 退出记录并上报 anr_crash。Replay 仅显示应用内操作，不能录制系统 ANR 弹窗。选择等待或恢复基线不保证产生 ANR 错误。'},
    en: {title: 'Book detail ANR', trigger: 'Open a book to block the UI thread for up to 120 seconds. Tap to trigger the system ANR dialog, choose Close app, then reopen the app. Do not use force-stop.', observation: 'On Android 11+, the SDK reads the ANR exit record after restart and reports anr_crash. Replay captures app content, not the system ANR dialog. Waiting or recovering does not guarantee an ANR error.'},
  },
  android_detail_freeze: {
    zh: {title: '图书详情原生卡顿', trigger: '打开图书后显示“正在展开图书内容”，原生主线程阻塞约 4 秒，恢复后显示“图书内容展开完成”。', observation: '在 View 的 Long Tasks 查看 SDK 自动采集的耗时和消息处理器信息，结合操作及回放定位卡顿阶段；当前 SDK 不提供完整阻塞堆栈。回放请关闭“跳过不活跃”。'},
    en: {title: 'Book detail native freeze', trigger: 'Open a book: Expanding book content → a 4-second native UI stall → Book content expanded.', observation: 'Inspect duration and message handler in the View’s Long Tasks, correlated with actions and Replay. The current SDK does not provide a full blocking stack. Turn off Skip inactivity in Replay.'},
  },
  android_detail_white_screen: {
    zh: {title: '图书详情 JS 未捕获异常', trigger: '打开图书时，缺失字段在异步内容准备中触发 TypeError；页面可能空白或应用退出，需要重启。', observation: '检查 SDK 自动采集的 reactnative_crash、原始 JS 堆栈和崩溃前回放；重启关联本轮标识。'},
    en: {title: 'Uncaught book detail JS error', trigger: 'Open a book: a missing field throws TypeError during asynchronous content preparation. The page may go blank or the app may exit; restart afterward.', observation: 'Inspect SDK-collected reactnative_crash, the original JS stack and preceding replay. Correlate the run after restarting.'},
  },
  android_checkout_native_crash: {
    zh: {title: '结算 C/C++ 崩溃', trigger: '进入购物车并点击结算，在 App 内确认后，JNI 结算校验触发真实 SIGABRT；不会提交订单。', observation: '重启后查看 SDK 的 native_crash、信号及原生堆栈，关联崩溃前回放；C/C++ 符号定位需匹配本次构建的原生符号文件。'},
    en: {title: 'Checkout C/C++ crash', trigger: 'Check out from the cart and confirm in the app. JNI checkout validation triggers SIGABRT before placing an order.', observation: 'Restart and inspect SDK native_crash, signal and native stack with preceding replay. C/C++ symbolication requires matching native build symbols.'},
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
    const disabled = id === BUSINESS_FAULT_IDS.nativeCrash ? !nativeCrashEnabled() : performance ? !nativePerformanceEnabled() : id === BUSINESS_FAULT_IDS.crash && !checkoutCrashEnabled();
    return {
      id, title: copy.title, layer: 'android', kind: id, service: 'mall-mobile',
      target: (id === BUSINESS_FAULT_IDS.crash || id === BUSINESS_FAULT_IDS.nativeCrash) ? 'checkout' : 'book-detail',
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
