export type AssistantExtensionTargetKind = 'server' | 'device' | 'any_device';
export type AssistantExtensionApprovalPolicy = 'never' | 'normal_threads' | 'always';

export type AssistantExtensionToolSummary = {
  name: string;
  label: string;
  category: 'extensions';
  description: string;
  approval: AssistantExtensionApprovalPolicy;
};

export type AssistantExtensionToolManifest = {
  name: string;
  label: string;
  description: string;
  category?: string;
  inputSchema: Record<string, unknown>;
  approval?: AssistantExtensionApprovalPolicy;
  supportedTargets: AssistantExtensionTargetKind[];
  defaultTarget: AssistantExtensionTargetKind;
};

export type AssistantExtensionManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  tools: AssistantExtensionToolManifest[];
};

export type AssistantExtensionToolRoute = {
  userId: string;
  toolName: string;
  enabled: boolean;
  targetKind: AssistantExtensionTargetKind;
  targetDeviceId: string | null;
  updatedAt: string;
};

export function extensionToolName(extensionId: string, toolName: string): string {
  return `${safeToolSegment(extensionId)}__${safeToolSegment(toolName)}`;
}

export function extensionToolSummary(manifest: AssistantExtensionManifest, tool: AssistantExtensionToolManifest): AssistantExtensionToolSummary {
  return {
    name: extensionToolName(manifest.id, tool.name),
    label: tool.label || `${manifest.name} ${tool.name}`.trim(),
    category: 'extensions',
    description: tool.description,
    approval: tool.approval ?? 'always',
  };
}

export function extensionToolDefinition(manifest: AssistantExtensionManifest, tool: AssistantExtensionToolManifest): unknown {
  return {
    type: 'function',
    name: extensionToolName(manifest.id, tool.name),
    description: tool.description,
    parameters: normalizeInputSchema(tool.inputSchema),
    strict: true,
  };
}

export function parseAssistantExtensionManifest(raw: unknown): AssistantExtensionManifest {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const id = cleanManifestId(value.id);
  const name = cleanText(value.name, id);
  const version = cleanText(value.version, '0.0.0') || '0.0.0';
  const tools = Array.isArray(value.tools) ? value.tools.map(parseToolManifest).filter(Boolean) as AssistantExtensionToolManifest[] : [];
  if (!id) throw Object.assign(new Error('extension id is required'), { statusCode: 400 });
  if (tools.length === 0) throw Object.assign(new Error('extension must define at least one tool'), { statusCode: 400 });
  return {
    id,
    name,
    version,
    description: cleanText(value.description) || undefined,
    tools,
  };
}

export function cleanTargetKind(raw: unknown, fallback: AssistantExtensionTargetKind = 'device'): AssistantExtensionTargetKind {
  const value = String(raw ?? '').trim();
  if (value === 'server' || value === 'device' || value === 'any_device') return value;
  return fallback;
}

function parseToolManifest(raw: unknown): AssistantExtensionToolManifest | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const name = safeToolSegment(value.name);
  if (!name) return null;
  const supportedTargets = parseTargets(value.supportedTargets ?? value.targets);
  const defaultTarget = cleanTargetKind(value.defaultTarget, supportedTargets[0] ?? 'device');
  const inputSchema = value.inputSchema && typeof value.inputSchema === 'object' && !Array.isArray(value.inputSchema)
    ? value.inputSchema as Record<string, unknown>
    : { type: 'object', properties: {}, required: [], additionalProperties: false };
  const approval = cleanApproval(value.approval);
  return {
    name,
    label: cleanText(value.label, name.replace(/_/g, ' ')) || name,
    description: cleanText(value.description, `${name} extension tool`) || `${name} extension tool`,
    category: cleanText(value.category) || undefined,
    inputSchema,
    approval,
    supportedTargets,
    defaultTarget: supportedTargets.includes(defaultTarget) ? defaultTarget : supportedTargets[0] ?? 'device',
  };
}

function parseTargets(raw: unknown): AssistantExtensionTargetKind[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const targets = values.map(parseTarget).filter(Boolean) as AssistantExtensionTargetKind[];
  return targets.length > 0 ? [...new Set(targets)] : ['device'];
}

function parseTarget(raw: unknown): AssistantExtensionTargetKind | null {
  const value = String(raw ?? '').trim();
  if (value === 'server' || value === 'device' || value === 'any_device') return value;
  return null;
}

function cleanApproval(raw: unknown): AssistantExtensionApprovalPolicy {
  const value = String(raw ?? '').trim();
  if (value === 'never' || value === 'normal_threads' || value === 'always') return value;
  return 'always';
}

function normalizeInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    properties: schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties) ? schema.properties : {},
    required: Array.isArray(schema.required) ? schema.required.map((item) => String(item)).filter(Boolean) : [],
    additionalProperties: schema.additionalProperties === true,
  };
}

function cleanManifestId(raw: unknown): string {
  return safeToolSegment(raw).replace(/_/g, '-');
}

function safeToolSegment(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function cleanText(raw: unknown, fallback = ''): string {
  return String(raw ?? fallback).trim().slice(0, 4000);
}
