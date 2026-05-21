// @vitest-environment happy-dom
/**
 * URL-param broker validation tests.  Default policy: only loopback
 * hosts (localhost, 127.0.0.1, ::1) are accepted from URL params,
 * because a crafted URL pointing at an attacker-controlled broker
 * would silently exfiltrate every chat / dice roll / PC edit through
 * the attacker's signaling.  Opt-in escape hatch
 * `peerDevAllowAnyHost=1` keeps the param flexible for self-hosting
 * scenarios where the user explicitly acknowledges the broker.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPeerjsFactoryFromUrl,
  brokerConfigFromUrl
} from './session-peerjs';

function withUrl(qs: string): void {
  window.history.replaceState({}, '', `/?${qs}`);
}

describe('brokerConfigFromUrl', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('returns null when no peer params are set (cloud default)', () => {
    expect(brokerConfigFromUrl()).toBeNull();
  });

  it('accepts loopback localhost', () => {
    withUrl('peerHost=localhost&peerPort=9000&peerPath=/');
    expect(brokerConfigFromUrl()?.host).toBe('localhost');
    expect(brokerConfigFromUrl()?.port).toBe(9000);
  });

  it('accepts loopback 127.0.0.1', () => {
    withUrl('peerHost=127.0.0.1&peerPort=9000');
    expect(brokerConfigFromUrl()?.host).toBe('127.0.0.1');
  });

  it('accepts loopback ::1', () => {
    withUrl('peerHost=%3A%3A1&peerPort=9000');
    expect(brokerConfigFromUrl()?.host).toBe('::1');
  });

  it('REJECTS a non-loopback host by default and falls back to cloud', () => {
    withUrl('peerHost=attacker.example&peerPort=443');
    expect(brokerConfigFromUrl()).toBeNull();
  });

  it('REJECTS a public IP', () => {
    withUrl('peerHost=8.8.8.8');
    expect(brokerConfigFromUrl()).toBeNull();
  });

  it('REJECTS even when paired with secure flag', () => {
    withUrl('peerHost=attacker.example&peerPort=443&peerSecure=1');
    expect(brokerConfigFromUrl()).toBeNull();
  });

  it('accepts arbitrary host when peerDevAllowAnyHost=1 is explicit', () => {
    withUrl('peerHost=attacker.example&peerPort=443&peerDevAllowAnyHost=1');
    expect(brokerConfigFromUrl()?.host).toBe('attacker.example');
  });

  it('flags non-default broker config so the UI can warn', () => {
    withUrl('peerHost=127.0.0.1&peerPort=9000');
    expect(brokerConfigFromUrl()?.nonDefault).toBe(true);
  });
});

describe('brokerConfigFromUrl — port validation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('drops port out of range (0)', () => {
    withUrl('peerHost=127.0.0.1&peerPort=0');
    expect(brokerConfigFromUrl()?.port).toBeUndefined();
  });

  it('drops port out of range (65536)', () => {
    withUrl('peerHost=127.0.0.1&peerPort=65536');
    expect(brokerConfigFromUrl()?.port).toBeUndefined();
  });

  it('drops port out of range (negative)', () => {
    withUrl('peerHost=127.0.0.1&peerPort=-1');
    expect(brokerConfigFromUrl()?.port).toBeUndefined();
  });

  it('drops non-integer port', () => {
    withUrl('peerHost=127.0.0.1&peerPort=1.5');
    expect(brokerConfigFromUrl()?.port).toBeUndefined();
  });

  it('accepts mixed-case loopback hostnames', () => {
    withUrl('peerHost=LocalHost&peerPort=9000');
    expect(brokerConfigFromUrl()?.host).toBe('LocalHost');
  });
});

describe('createPeerjsFactoryFromUrl — fallback paths', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('returns a factory unchanged when URL is clean', () => {
    const f = createPeerjsFactoryFromUrl();
    expect(typeof f.createHost).toBe('function');
    expect(typeof f.createGuest).toBe('function');
  });

  it('returns a factory when a malicious URL is ignored', () => {
    withUrl('peerHost=attacker.example');
    const f = createPeerjsFactoryFromUrl();
    expect(typeof f.createHost).toBe('function');
  });
});
