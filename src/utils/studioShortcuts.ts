export type StudioShortcutAction =
  | 'toggle-mic'
  | 'toggle-camera'
  | 'trigger-clip'
  | 'toggle-theater'
  | 'close-overlays';

export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  targetTagName?: string | null;
  targetIsContentEditable?: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableTarget(
  tagName: string | null | undefined,
  isContentEditable?: boolean
): boolean {
  if (isContentEditable) return true;
  if (!tagName) return false;
  return EDITABLE_TAGS.has(tagName.toUpperCase());
}

/**
 * Resolves single-key pro studio shortcuts while ignoring modifier combos and
 * form fields so typing in chat or profile forms never triggers stage actions.
 */
export function resolveStudioShortcut(
  event: ShortcutEventLike,
  options: { isBroadcaster: boolean }
): StudioShortcutAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  if (event.key === 'Escape') {
    return 'close-overlays';
  }

  if (isEditableTarget(event.targetTagName, event.targetIsContentEditable)) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === 't') return 'toggle-theater';
  if (!options.isBroadcaster) return null;
  if (key === 'm') return 'toggle-mic';
  if (key === 'v') return 'toggle-camera';
  if (key === 'c') return 'trigger-clip';
  return null;
}
