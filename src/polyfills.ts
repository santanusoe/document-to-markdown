type PromiseWithTry = PromiseConstructor & {
  try?: <T, Arguments extends unknown[]>(
    callback: (...arguments_: Arguments) => T | PromiseLike<T>,
    ...arguments_: Arguments
  ) => Promise<T>;
};

const promiseConstructor = Promise as PromiseWithTry;
if (!promiseConstructor.try) {
  Object.defineProperty(promiseConstructor, 'try', {
    configurable: true,
    writable: true,
    value<T, Arguments extends unknown[]>(
      callback: (...arguments_: Arguments) => T | PromiseLike<T>,
      ...arguments_: Arguments
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        try {
          resolve(callback(...arguments_));
        } catch (error) {
          reject(error);
        }
      });
    },
  });
}

const byteArrayPrototype = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
if (!byteArrayPrototype.toHex) {
  Object.defineProperty(byteArrayPrototype, 'toHex', {
    configurable: true,
    value(this: Uint8Array): string {
      return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
  });
}

const mapPrototype = Map.prototype as Map<unknown, unknown> & {
  getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
};
if (!mapPrototype.getOrInsertComputed) {
  Object.defineProperty(mapPrototype, 'getOrInsertComputed', {
    configurable: true,
    value(this: Map<unknown, unknown>, key: unknown, callback: (key: unknown) => unknown): unknown {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
  });
}
