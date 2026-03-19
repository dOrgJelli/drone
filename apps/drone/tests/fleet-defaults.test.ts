import { describe, expect, test } from 'bun:test';
import { fleetActorConfig } from '../src/hub/fleet-helpers';

describe('fleetActorConfig defaults', () => {
  test('defaults missing capabilities to create, send, and read', () => {
    const config = fleetActorConfig({});
    expect(config.capabilities).toEqual(['drone:create', 'drone:message:send', 'drone:message:read']);
  });

  test('preserves explicit empty capabilities', () => {
    const config = fleetActorConfig({ fleet: { capabilities: [] } });
    expect(config.capabilities).toEqual([]);
  });
});
