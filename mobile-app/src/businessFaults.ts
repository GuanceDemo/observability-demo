import {NativeModules} from 'react-native';
import type {DemoRequestMetadata} from './api';
import type {FaultScenario, StoreLanguage} from './types';

export const BUSINESS_FAULT_IDS = {
  detail: 'mobile_detail_render_error',
  addCart: 'mobile_add_cart_no_feedback',
  cartTotal: 'mobile_cart_total_stale',
  uiBlock: 'mobile_checkout_ui_block',
  slow: 'mobile_content_slow',
  timeout: 'mobile_content_timeout',
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

export async function blockCheckoutPreview(): Promise<number> {
  const module = NativeModules.DemoFaults as {blockCheckoutPreview?: () => Promise<number>} | undefined;
  if (!module?.blockCheckoutPreview) throw new Error('Checkout preview requires the updated Android APK');
  return module.blockCheckoutPreview();
}

const COPY: Record<BusinessFaultId, Record<StoreLanguage, {title: string; trigger: string; observation: string}>> = {
  mobile_detail_render_error: {
    zh: {title: '商品详情渲染失败', trigger: '收起面板，打开任意一本图书。', observation: '查看详情错误区域、真实 JS 堆栈与打开商品前后的回放。'},
    en: {title: 'Book detail render failure', trigger: 'Close this panel and open any book.', observation: 'Inspect the error area, real JS stack and the replay around opening the book.'},
  },
  mobile_add_cart_no_feedback: {
    zh: {title: '加购无反馈', trigger: '收起面板，给尚未加入购物车的图书点击加购。', observation: '回放查看连续尝试；业务校验日志对照加购前、预期和实际数量。'},
    en: {title: 'Add to cart has no effect', trigger: 'Close this panel and add a book that is not in your cart.', observation: 'Replay the attempts and compare prior, expected and actual quantities in the business log.'},
  },
  mobile_cart_total_stale: {
    zh: {title: '购物车金额未更新', trigger: '进入购物车，增加一本已选图书的数量。', observation: '对照回放中更新的数量与旧合计；业务校验记录预期和实际金额。'},
    en: {title: 'Cart total does not update', trigger: 'Open your cart and increase a selected book quantity.', observation: 'Compare the changed quantity and stale total in replay, with expected and actual totals in the validation log.'},
  },
  mobile_checkout_ui_block: {
    zh: {title: '结算预览卡顿', trigger: '进入购物车，点击“查看结算明细”。', observation: '查看约 1.8 秒的原生 Long Task、主线程堆栈和结算前后的回放。'},
    en: {title: 'Checkout preview freezes briefly', trigger: 'Open your cart and tap “Review checkout”.', observation: 'Inspect the approximately 1.8-second native Long Task, main-thread stack and replay.'},
  },
  mobile_content_slow: {
    zh: {title: '图书内容加载慢', trigger: '收起面板，打开任意一本图书。', observation: '内容等待约 3.5 秒；对照 Replay、Resource 和服务端 Trace 的实际耗时。'},
    en: {title: 'Book content loads slowly', trigger: 'Close this panel and open any book.', observation: 'Content takes about 3.5 seconds. Compare replay, Resource and server Trace timings.'},
  },
  mobile_content_timeout: {
    zh: {title: '请求超时与重试', trigger: '打开任意图书，等待加载超时，再点击重新加载。', observation: '对照实际请求截止时间、Resource 取消记录，以及回放中的失败和恢复。'},
    en: {title: 'Request timeout and retry', trigger: 'Open any book, wait for the timeout, then reload the content.', observation: 'Compare the real deadline, Resource cancellation and the failure/recovery replay.'},
  },
};

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
