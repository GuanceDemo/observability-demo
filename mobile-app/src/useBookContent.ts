import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BookContentRequestError, type DemoApi, type DemoRequestMetadata} from './api';
import {addError, recordFaultEvent} from './observability';
import type {BookContent, BookContentState} from './types';

export function completeContent(state: BookContentState, event: string, data: BookContent): BookContentState {
  return state.status === 'loading' && event === 'content_ready'
    ? {status: 'ready', bookId: state.bookId, data} : state;
}

export function useBookContent(api: DemoApi, project: string) {
  const [state, setState] = useState<BookContentState>({status: 'idle'});
  const generation = useRef(0);
  const readinessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const attempts = useRef({key: '', count: 0});

  const cancel = useCallback(() => {
    generation.current += 1;
    if (readinessTimer.current) clearTimeout(readinessTimer.current);
    readinessTimer.current = null;
    request.current?.abort();
    request.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const load = useCallback(async (
    bookId: string,
    metadata: DemoRequestMetadata,
    mode: 'normal' | 'slow' | 'timeout' = 'normal',
    mismatchSuccessEvent = false,
  ) => {
    cancel();
    const owner = generation.current;
    const controller = new AbortController();
    request.current = controller;
    const attemptKey = `${bookId}:${metadata.faultRunId ?? 'baseline'}`;
    if (attempts.current.key !== attemptKey) attempts.current = {key: attemptKey, count: 0};
    const properties = {book_id: bookId, fault_run_id: metadata.faultRunId ?? '',
      fault_id: metadata.faultId ?? '', fault_phase: metadata.faultPhase ?? 'baseline',
      attempt: ++attempts.current.count, content_mode: mode};
    setState({status: 'loading', bookId});
    recordFaultEvent('book_content_load_started', properties);
    try {
      const result = await api.bookContent(bookId, project, metadata, mode, controller.signal);
      if (owner !== generation.current || controller.signal.aborted) return;
      const responseContext = {...properties, biz_request_id: result.businessRequestId, duration_ms: result.durationMs};
      recordFaultEvent('book_content_load_succeeded', responseContext);
      // Reproduce a response adapter/state-machine contract mismatch, not a slow request.
      const event = mismatchSuccessEvent ? 'content_loaded' : 'content_ready';
      const next = completeContent({status: 'loading', bookId}, event, result.data);
      setState(next);
      recordFaultEvent('book_content_state_transition', {...responseContext,
        state_event: event, expected_event: 'content_ready', next_state: next.status});
      if (next.status !== 'ready') {
        // Capture the rejected transition now, not the detector timer's call stack.
        // This is diagnostic evidence, not an uncaught application exception.
        const transitionError = new Error('Book content remains loading after a successful response');
        transitionError.name = 'ContentNotReady';
        const transitionContext = {
          stack_origin: 'content_state_transition',
          error_detection: 'readiness_timeout',
          state_before: 'loading',
        };
        readinessTimer.current = setTimeout(() => {
          readinessTimer.current = null;
          if (owner !== generation.current || controller.signal.aborted) return;
          const context = {...responseContext, ...transitionContext, detector: 'content_readiness', wait_after_response_ms: 3000,
            state_event: event, expected_event: 'content_ready', actual_state: next.status};
          recordFaultEvent('book_content_not_ready', context);
          addError(transitionError.name, transitionError.message, context, transitionError).catch(() => undefined);
        }, 3000);
      }
    } catch (error) {
      if (owner !== generation.current || controller.signal.aborted) return;
      const failure = error instanceof BookContentRequestError ? error : null;
      setState({status: 'error', bookId, timeout: failure?.timeout ?? false});
      const context = {...properties, biz_request_id: failure?.businessRequestId ?? '',
        duration_ms: failure?.durationMs ?? 0,
        timeout_source: failure?.timeout ? 'app_deadline' : '',
        request_error_type: failure?.originalName ?? 'unknown'};
      recordFaultEvent('book_content_load_failed', context);
      if (error instanceof Error) addError(error.name, error.message, context, error).catch(() => undefined);
    } finally {
      if (owner === generation.current) request.current = null;
    }
  }, [api, cancel, project]);

  return useMemo(() => ({state, load, cancel}), [state, load, cancel]);
}
