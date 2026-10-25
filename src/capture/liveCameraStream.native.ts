/** Native capture remains owned by its existing camera module, not a web stream. */
export function prepareLiveCameraHandoff(_scope: string): boolean { return false; }
export function cancelLiveCameraHandoff(_scope: string): void {}
