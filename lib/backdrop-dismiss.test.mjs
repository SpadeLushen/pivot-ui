import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { BackdropDismissGesture, isBackdropPoint } = await createJiti(import.meta.url).import("./backdrop-dismiss.ts");
const primary = { pointerId: 1, button: 0, isPrimary: true };

test("cancellation or loss of focus invalidates a pending gesture", () => {
  const gesture = new BackdropDismissGesture();
  gesture.press(primary, true);
  gesture.cancel();
  gesture.release(primary.pointerId, true);
  assert.equal(gesture.consumeClick(), false);
  gesture.press(primary, true);
  gesture.release(primary.pointerId, true);
  gesture.cancel();
  assert.equal(gesture.consumeClick(), false);
});

test("a new press clears any previous unconsumed backdrop click", () => {
  const gesture = new BackdropDismissGesture();
  gesture.press(primary, true);
  gesture.release(primary.pointerId, true);
  gesture.press(primary, false);
  gesture.release(primary.pointerId, true);
  assert.equal(gesture.consumeClick(), false);
});

test("hit-testing ignores touch capture and never closes a covered parent backdrop", () => {
  let hit;
  const surface = { tagName: "DIV", ownerDocument: { elementFromPoint: () => hit } };
  hit = surface;
  assert.equal(isBackdropPoint(surface, 10, 10), true);
  // The event could still target surface due to implicit pointer capture,
  // but the actual release point is on content, a nested modal or offscreen.
  for (const other of [{ tagName: "INPUT" }, { tagName: "DIALOG" }, null]) {
    hit = other;
    assert.equal(isBackdropPoint(surface, 10, 10), false);
  }
});


test("native dialog backdrop is outside its rectangle, not its own padding or border", () => {
  const dialog = {
    tagName: "DIALOG",
    ownerDocument: { elementFromPoint: () => dialog },
    getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 400 }),
  };
  for (const [x, y] of [[99, 200], [500, 200], [200, 99], [200, 400]]) {
    assert.equal(isBackdropPoint(dialog, x, y), true);
  }
  for (const [x, y] of [[100, 100], [200, 200], [499, 399]]) {
    assert.equal(isBackdropPoint(dialog, x, y), false);
  }
});

for (const [start, end, expected] of [[true, true, true], [true, false, false], [false, true, false], [false, false, false]]) {
  test(`press ${start ? "outside" : "inside"}, release ${end ? "outside" : "inside"}: dismiss=${expected}`, () => {
    const gesture = new BackdropDismissGesture();
    gesture.press(primary, start);
    gesture.release(primary.pointerId, end);
    assert.equal(gesture.consumeClick(), expected);
    assert.equal(gesture.consumeClick(), false, "a click is consumed only once");
  });
}

test("pressing the backdrop does not dismiss until release and click", () => {
  const gesture = new BackdropDismissGesture();
  gesture.press(primary, true);
  assert.equal(gesture.consumeClick(), false);
  gesture.release(primary.pointerId, true);
  assert.equal(gesture.consumeClick(), false, "an orphan release cannot dismiss");
});

test("right clicks, secondary touches and unrelated releases cannot dismiss", () => {
  for (const pointer of [{ ...primary, button: 2 }, { ...primary, isPrimary: false }]) {
    const gesture = new BackdropDismissGesture();
    gesture.press(pointer, true);
    gesture.release(pointer.pointerId, true);
    assert.equal(gesture.consumeClick(), false);
  }
  const gesture = new BackdropDismissGesture();
  gesture.press(primary, true);
  gesture.release(2, true);
  assert.equal(gesture.consumeClick(), false);
});
