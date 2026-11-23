package com.guance.vehicledemo

import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.SpanContext
import io.opentelemetry.api.trace.TraceFlags
import io.opentelemetry.api.trace.TraceState
import org.junit.Assert.*
import org.junit.Test

class PublishTracingTest {
    @Test fun traceparentPreservesHexPaddingAndSampling() {
        val context = SpanContext.create("000000000000000000000000000000ab", "00000000000000cd",
            TraceFlags.getSampled(), TraceState.getDefault())
        assertEquals("00-000000000000000000000000000000ab-00000000000000cd-01",
            PublishTracing.traceparent(Span.wrap(context)))
        assertNull(PublishTracing.traceparent(Span.getInvalid()))
    }
}
