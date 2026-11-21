import test from 'node:test';
import assert from 'node:assert/strict';
import { isEditableTarget, resolveStudioShortcut } from './studioShortcuts';

test('resolveStudioShortcut maps broadcaster stage keys and theater mode', () => {
  assert.equal(resolveStudioShortcut({ key: 'm' }, { isBroadcaster: true }), 'toggle-mic');
  assert.equal(resolveStudioShortcut({ key: 'V' }, { isBroadcaster: true }), 'toggle-camera');
  assert.equal(resolveStudioShortcut({ key: 'c' }, { isBroadcaster: true }), 'trigger-clip');
  assert.equal(resolveStudioShortcut({ key: 't' }, { isBroadcaster: true }), 'toggle-theater');
  assert.equal(resolveStudioShortcut({ key: 'Escape' }, { isBroadcaster: true }), 'close-overlays');
});

test('resolveStudioShortcut restricts stage actions for viewers while allowing theater mode and Escape', () => {
  assert.equal(resolveStudioShortcut({ key: 'm' }, { isBroadcaster: false }), null);
  assert.equal(resolveStudioShortcut({ key: 'v' }, { isBroadcaster: false }), null);
  assert.equal(resolveStudioShortcut({ key: 'c' }, { isBroadcaster: false }), null);
  assert.equal(resolveStudioShortcut({ key: 't' }, { isBroadcaster: false }), 'toggle-theater');
  assert.equal(resolveStudioShortcut({ key: 'Escape' }, { isBroadcaster: false }), 'close-overlays');
});

test('resolveStudioShortcut ignores typing inside inputs and modifier combos', () => {
  assert.equal(isEditableTarget('input'), true);
  assert.equal(isEditableTarget('TEXTAREA'), true);
  assert.equal(isEditableTarget('div', true), true);
  assert.equal(isEditableTarget('button', false), false);

  assert.equal(
    resolveStudioShortcut({ key: 'm', targetTagName: 'INPUT' }, { isBroadcaster: true }),
    null
  );
  assert.equal(
    resolveStudioShortcut({ key: 't', targetTagName: 'TEXTAREA' }, { isBroadcaster: true }),
    null
  );
  assert.equal(
    resolveStudioShortcut({ key: 'c', metaKey: true }, { isBroadcaster: true }),
    null
  );
  assert.equal(
    resolveStudioShortcut({ key: 'c', ctrlKey: true }, { isBroadcaster: true }),
    null
  );
  // Escape always closes overlays even from inside inputs
  assert.equal(
    resolveStudioShortcut({ key: 'Escape', targetTagName: 'INPUT' }, { isBroadcaster: true }),
    'close-overlays'
  );
});
