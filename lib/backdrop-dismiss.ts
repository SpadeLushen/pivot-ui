interface PointerPress {
  pointerId: number;
  button: number;
  isPrimary: boolean;
}

/** A backdrop click must start and end outside, on the same primary pointer. */
export class BackdropDismissGesture {
  private pressedOutside: number | null = null;
  private releasedOutside = false;

  press(pointer: PointerPress, outside: boolean): void {
    this.cancel();
    if (pointer.isPrimary && pointer.button === 0 && outside) this.pressedOutside = pointer.pointerId;
  }

  release(pointerId: number, outside: boolean): void {
    this.releasedOutside = this.pressedOutside === pointerId && outside;
    this.pressedOutside = null;
  }

  cancel(): void {
    this.pressedOutside = null;
    this.releasedOutside = false;
  }

  consumeClick(): boolean {
    const dismiss = this.releasedOutside;
    this.cancel();
    return dismiss;
  }
}

/** Hit-test the release position: touch pointer capture can retarget events. */
export function isBackdropPoint(surface: HTMLElement, clientX: number, clientY: number): boolean {
  if (surface.ownerDocument.elementFromPoint(clientX, clientY) !== surface) return false;
  if (surface.tagName !== "DIALOG") return true;
  // A native dialog's ::backdrop targets the dialog itself. Its border,
  // padding and scrollbar still belong to the interior, not the backdrop.
  const rect = surface.getBoundingClientRect();
  return clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom;
}
