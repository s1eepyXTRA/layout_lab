{{- define "kobra.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kobra.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "kobra.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kobra.labels" -}}
app.kubernetes.io/name: {{ include "kobra.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "kobra.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}

{{- define "kobra.secretName" -}}
{{- if .Values.secrets.existingSecret }}{{ .Values.secrets.existingSecret }}{{ else }}{{ include "kobra.fullname" . }}{{ end -}}
{{- end -}}

{{/* Переменные окружения, общие для сервиса и воркера: один источник правды */}}
{{- define "kobra.env" -}}
- name: KOBRA_DATABASE_URL
  valueFrom:
    secretKeyRef: {name: {{ include "kobra.secretName" . }}, key: databaseUrl}
- name: KOBRA_SECRET_KEY
  valueFrom:
    secretKeyRef: {name: {{ include "kobra.secretName" . }}, key: secretKey}
- name: KOBRA_REDIS_URL
  value: {{ .Values.redis.url | quote }}
{{- range $k, $v := .Values.env }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- end -}}
