package com.guance.vehicledemo

import android.util.Base64
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.context.Context
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor
import java.time.Duration

/** Uses the existing publisher identity at a dedicated authenticated OTLP proxy. */
class PublishTracing(config: BrokerSettings) : AutoCloseable {
    private val provider = if (BuildConfig.APM_ENABLED) SdkTracerProvider.builder()
        .setResource(Resource.create(Attributes.builder()
            .put("service.name", "vehicle-android-producer")
            .put("service.version", BuildConfig.VERSION_NAME)
            .put("deployment.environment.name", "demo")
            .put("cluster", BuildConfig.VEHICLE_CLUSTER)
            .put("pipeline", "vehicle-telemetry").build()))
        .addSpanProcessor(BatchSpanProcessor.builder(OtlpHttpSpanExporter.builder()
            .setEndpoint("https://${config.uri.rawAuthority}/vehicle-otel/v1/traces")
            .addHeader("Authorization", "Basic " + Base64.encodeToString(
                "${config.username}:${config.password}".toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
            .setTimeout(Duration.ofSeconds(3)).build())
            .setMaxQueueSize(256).setMaxExportBatchSize(32).build()).build() else null

    fun start(event: OutboxEvent, topic: String): Span = provider?.get("vehicle-mqtt")
        ?.spanBuilder("mqtt.publish")?.setParent(Context.root())?.setSpanKind(SpanKind.PRODUCER)
        ?.setAttribute("messaging.system", "mqtt")?.setAttribute("messaging.destination.name", topic)
        ?.setAttribute("messaging.operation.type", "send")?.setAttribute("messaging.message.id", event.eventId)
        ?.setAttribute("vehicle.queue.age_ms", (System.currentTimeMillis() - event.createdAt).coerceAtLeast(0))
        ?.startSpan() ?: Span.getInvalid()

    override fun close() { provider?.close() }

    companion object {
        fun traceparent(span: Span): String? = span.spanContext.takeIf { it.isValid }?.let {
            "00-${it.traceId}-${it.spanId}-${it.traceFlags.asHex()}"
        }
        fun failed(span: Span, failure: Exception) {
            // Transport messages can contain endpoints or credentials.
            span.setStatus(StatusCode.ERROR, "mqtt_publish_failed")
            span.setAttribute("error.type", failure.javaClass.name)
        }
    }
}
