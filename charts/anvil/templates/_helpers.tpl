{{/* Chart name, overridable. */}}
{{- define "anvil.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name. */}}
{{- define "anvil.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "anvil.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "anvil.labels" -}}
helm.sh/chart: {{ include "anvil.chart" . }}
{{ include "anvil.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "anvil.selectorLabels" -}}
app.kubernetes.io/name: {{ include "anvil.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Redis service name. */}}
{{- define "anvil.redisFullname" -}}
{{- printf "%s-redis" (include "anvil.fullname" .) -}}
{{- end -}}

{{/* REDIS_URL the server and worker connect with. */}}
{{- define "anvil.redisUrl" -}}
{{- if .Values.redis.deploy -}}
{{- printf "redis://%s:%v" (include "anvil.redisFullname" .) .Values.redis.port -}}
{{- else -}}
{{- required "redis.url is required when redis.deploy is false" .Values.redis.url -}}
{{- end -}}
{{- end -}}

{{/* Name of the Secret holding WEBHOOK_SECRET. */}}
{{- define "anvil.secretName" -}}
{{- if .Values.secret.create -}}
{{- printf "%s-webhook" (include "anvil.fullname" .) -}}
{{- else -}}
{{- required "secret.existingSecret is required when secret.create is false" .Values.secret.existingSecret -}}
{{- end -}}
{{- end -}}

{{/* Key inside the Secret holding WEBHOOK_SECRET. */}}
{{- define "anvil.secretKey" -}}
{{- if .Values.secret.create -}}
webhook-secret
{{- else -}}
{{- .Values.secret.existingSecretKey -}}
{{- end -}}
{{- end -}}
