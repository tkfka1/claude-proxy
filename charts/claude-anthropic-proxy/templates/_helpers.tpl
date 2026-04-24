{{- define "claude-anthropic-proxy.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "claude-anthropic-proxy.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "claude-anthropic-proxy.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "claude-anthropic-proxy.labels" -}}
helm.sh/chart: {{ include "claude-anthropic-proxy.chart" . }}
{{ include "claude-anthropic-proxy.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "claude-anthropic-proxy.selectorLabels" -}}
app.kubernetes.io/name: {{ include "claude-anthropic-proxy.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "claude-anthropic-proxy.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "claude-anthropic-proxy.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "claude-anthropic-proxy.authSecretName" -}}
{{- if .Values.claudeAuth.existingSecret }}
{{- .Values.claudeAuth.existingSecret }}
{{- else }}
{{- printf "%s-claude-auth" (include "claude-anthropic-proxy.fullname" .) }}
{{- end }}
{{- end }}

{{- define "claude-anthropic-proxy.hasClaudeAuth" -}}
{{- if or .Values.claudeAuth.existingSecret .Values.claudeAuth.createSecret }}true{{- end }}
{{- end }}

{{- define "claude-anthropic-proxy.proxyStateClaimName" -}}
{{- if .Values.proxyState.persistence.existingClaim }}
{{- .Values.proxyState.persistence.existingClaim }}
{{- else }}
{{- printf "%s-proxy-state" (include "claude-anthropic-proxy.fullname" .) }}
{{- end }}
{{- end }}
