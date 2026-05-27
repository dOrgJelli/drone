import { describe, expect, test } from 'bun:test';

import { extensionToolName, type AssistantExtensionManifest, type AssistantExtensionToolRoute } from './assistant-extensions.js';
import { ExtensionBridgeRegistry, type ExtensionBridgeSocket } from './extension-bridge.js';

const manifest: AssistantExtensionManifest = {
  id: 'quick-extension',
  name: 'Quick Extension',
  version: '0.1.0',
  tools: [{
    name: 'echo',
    label: 'Echo',
    description: 'Echoes the input.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: true },
    approval: 'never',
    supportedTargets: ['device', 'any_device'],
    defaultTarget: 'device',
  }],
};

const toolName = extensionToolName(manifest.id, 'echo');
const route: AssistantExtensionToolRoute = {
  userId: 'user-1',
  toolName,
  enabled: true,
  targetKind: 'device',
  targetDeviceId: 'device-1',
  updatedAt: new Date(0).toISOString(),
};

function registerSocket(registry: ExtensionBridgeRegistry, socket: ExtensionBridgeSocket): void {
  registry.register(socket, {
    userId: 'user-1',
    deviceId: 'device-1',
    deviceType: 'desktop',
    displayName: 'Desktop',
    manifests: [manifest],
  });
}

describe('extension bridge registry', () => {
  test('handles an immediate extension tool result', async () => {
    const registry = new ExtensionBridgeRegistry();
    const socket: ExtensionBridgeSocket = {
      readyState: 1,
      send(data) {
        const request = JSON.parse(data);
        registry.handleClientMessage('device-1', JSON.stringify({
          type: 'extension_tool_result',
          requestId: request.requestId,
          ok: true,
          result: { args: request.args },
        }));
      },
    };
    registerSocket(registry, socket);

    const result = await registry.executeTool({
      userId: 'user-1',
      toolName,
      args: { text: 'hello' },
      route,
    });

    expect(result).toEqual({ args: { text: 'hello' } });
  });

  test('rejects pending tool calls when a runner disconnects', async () => {
    const registry = new ExtensionBridgeRegistry();
    const socket: ExtensionBridgeSocket = { readyState: 1, send() {} };
    registerSocket(registry, socket);

    const pending = registry.executeTool({
      userId: 'user-1',
      toolName,
      args: {},
      route,
    });
    registry.unregister(socket);

    await expect(pending).rejects.toThrow('extension runner disconnected');
  });
});
