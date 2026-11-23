{{- define "observability-demo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "observability-demo.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "observability-demo.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "observability-demo.labels" -}}
{{- include "observability-demo.projectLabels" (dict "root" . "project" (required "observability.project is required" .Values.observability.project)) -}}
{{- end }}

{{- define "observability-demo.projectLabels" -}}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "observability-demo.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
project: {{ required "project label is required" .project | quote }}
{{- end }}

{{- define "observability-demo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "observability-demo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "observability-demo.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- include "observability-demo.fullname" . -}}
{{- end -}}
{{- end }}

{{- define "observability-demo.image" -}}
{{- printf "%s/%s/observability-demo-%s:%s" $.root.Values.image.registry $.root.Values.image.owner $.service $.root.Values.image.tag -}}
{{- end }}
