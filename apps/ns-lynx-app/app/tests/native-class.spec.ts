/**
 * `@NativeClass` classes have to reach the device as ES5 constructor functions:
 * the {N} runtimes build the native subclass by reflecting over the prototype,
 * and a real ES6 class throws when the runtime tries to call it without `new`.
 *
 * The bundler does this in two textual passes (native-class-strip-loader marks
 * the class, native-class-downlevel-loader transpiles just that class), so the
 * check that matters is on the code the device actually loads.
 */
import { describe, expect, it } from '@rstest/core';

@NativeClass()
class MarkedClass {
  greet(): string {
    return 'hello';
  }

  get answer(): number {
    return 42;
  }
}

class PlainClass {
  greet(): string {
    return 'hello';
  }
}

describe('@NativeClass downleveling', () => {
  it('emits a constructor function, not an ES6 class', () => {
    expect(Function.prototype.toString.call(MarkedClass).startsWith('function')).toBe(
      true,
    );
  });

  it('leaves every other class in the same file modern', () => {
    expect(Function.prototype.toString.call(PlainClass).startsWith('class')).toBe(true);
  });

  it('keeps accessors enumerable, which is how the runtime finds them', () => {
    expect(Object.keys(MarkedClass.prototype)).toContain('answer');
  });

  it('still behaves like the class it was written as', () => {
    const instance = new MarkedClass();

    expect(instance.greet()).toBe('hello');
    expect(instance.answer).toBe(42);
  });

  it('removes the decorator instead of leaving it to resolve at runtime', () => {
    expect(Function.prototype.toString.call(MarkedClass)).not.toContain('NativeClass');
  });
});
