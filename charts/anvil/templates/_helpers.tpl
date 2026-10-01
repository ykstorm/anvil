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

{{/* Whether Redis auth (requirepass) is in play. */}}
{{- define "anvil.redisAuthEnabled" -}}
{{- if or .Values.redis.password .Values.redis.existingSecret -}}true{{- end -}}
{{- end -}}

{{/* Name of the Secret holding the Redis password. */}}
{{- define "anvil.redisSecretName" -}}
{{- if .Values.redis.existingSecret -}}
{{- .Values.redis.existingSecret -}}
{{- else -}}
{{- printf "%s-redis" (include "anvil.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Key inside the Redis Secret holding the password. */}}
{{- define "anvil.redisSecretKey" -}}
{{- if .Values.redis.existingSecret -}}
{{- .Values.redis.existingSecretKey -}}
{{- else -}}
redis-password
{{- end -}}
{{- end -}}

{{/*
REDIS_URL the server and worker connect with. For the in-cluster Redis the
password, when set, is injected at runtime via the $(REDIS_PASSWORD) env var
(defined before REDIS_URL in each container), so the secret never appears in the
rendered manifest. For an external Redis (deploy=false) pass the full redis.url.
*/}}
{{- define "anvil.redisUrl" -}}
{{- if .Values.redis.deploy -}}
{{- if include "anvil.redisAuthEnabled" . -}}
{{- printf "redis://:$(REDIS_PASSWORD)@%s:%v" (include "anvil.redisFullname" .) .Values.redis.port -}}
{{- else -}}
{{- printf "redis://%s:%v" (include "anvil.redisFullname" .) .Values.redis.port -}}
{{- end -}}
{{- else -}}
{{- required "redis.url is required when redis.deploy is false" .Values.redis.url -}}
{{- end -}}
{{- end -}}

{{/*
Resolve a component image "repo:tag". Call as (list . <component image repo>).
The repo defaults to image.repository; both being empty is an error, since the
project publishes no image.
*/}}
{{- define "anvil.image" -}}
{{- $root := index . 0 -}}
{{- $override := index . 1 -}}
{{- $repo := $override | default $root.Values.image.repository -}}
{{- if not $repo -}}
{{- fail "image.repository is required: the project publishes no image, so build apps/server/Dockerfile and apps/worker/Dockerfile, push them, and set image.repository (or server.image.repository / worker.image.repository). See charts/anvil/README.md." -}}
{{- end -}}
{{- printf "%s:%s" $repo $root.Values.image.tag -}}
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
