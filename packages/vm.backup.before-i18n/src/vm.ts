export interface VMState {
  pc: number;
  stack: unknown[];
  memory: unknown[];
  constantPool: unknown[];
  bytecode: Uint8Array;
  env: Record<string, unknown>;
  args: unknown[];
  exceptionTable: ExceptionTableEntry[];
  contextThis?: unknown;
}

export type ExceptionTableEntry = {
  startPc: number;
  endPc: number;
  handlerPc: number;
  errorPtr: number;
};

type VMClosure = ((this: unknown, ...args: unknown[]) => unknown) & {
  __vm_closure: true;
  entryPc: number;
  memorySize: number;
  captures: MemoryCell[];
  selfRefPtr: number | null;
  prototype: unknown;
};

type MemoryCell = {
  __vm_cell: true;
  value: unknown;
};

type UnresolvableReference = {
  __vm_unresolvable: true;
  name: PropertyKey;
};

const hostFunctionConstructor = function hostFunctionMarker() {}
  .constructor as FunctionConstructor;
const hostObjectConstructor = hostFunctionConstructor(
  "return Object",
)() as Partial<ObjectConstructor>;
const hostReflectConstructor = hostFunctionConstructor(
  "return Reflect",
)() as typeof Reflect;
const hostArrayConstructor = hostFunctionConstructor(
  "return Array",
)() as ArrayConstructor;
const hostSymbolConstructor = hostFunctionConstructor(
  "return typeof Symbol === 'function' ? Symbol : undefined",
)() as SymbolConstructor | undefined;
const hostTypeErrorConstructor = hostFunctionConstructor(
  "return TypeError",
)() as new (message?: string) => TypeError;
const VM_GLOBAL_THIS_MARKER: PropertyKey =
  typeof hostSymbolConstructor === "function"
    ? hostSymbolConstructor("vm.globalThis")
    : "__experiment_vm_global_this__";
const hostObjectPrototype = hostFunctionConstructor(
  "return ({}).__proto__",
)() as object;
const hostHasOwnProperty = (
  hostObjectPrototype as {
    hasOwnProperty: typeof Object.prototype.hasOwnProperty;
  }
).hasOwnProperty;
const hostObjectCreate = ((prototype: object | null) => {
  if (typeof hostObjectConstructor.create === "function") {
    return hostObjectConstructor.create(prototype);
  }
  if (prototype === null) {
    return {};
  }
  const HostObject = function HostObject() {} as unknown as {
    new (): object;
    prototype: object | null;
  };
  HostObject.prototype = prototype;
  const value = new HostObject();
  HostObject.prototype = null;
  return value;
}) as typeof Object.create;
const hostObjectDefineProperty = (<T>(
  target: T,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
) => {
  if (typeof hostObjectConstructor.defineProperty === "function") {
    return hostObjectConstructor.defineProperty(target, key, descriptor);
  }
  if ("value" in descriptor) {
    (target as Record<PropertyKey, unknown>)[key] = descriptor.value;
  }
  return target;
}) as typeof Object.defineProperty;
const hostObjectDefineProperties = (<T>(
  target: T,
  descriptors: PropertyDescriptorMap,
) => {
  if (typeof hostObjectConstructor.defineProperties === "function") {
    return hostObjectConstructor.defineProperties(target, descriptors);
  }
  for (const key in descriptors) {
    if (hostHasOwn(descriptors, key)) {
      hostObjectDefineProperty(target, key, descriptors[key]);
    }
  }
  return target;
}) as typeof Object.defineProperties;
const hostObjectEntries = ((value: Record<string, unknown>) => {
  if (typeof hostObjectConstructor.entries === "function") {
    return hostObjectConstructor.entries(value);
  }
  const entries: [string, unknown][] = [];
  for (const key in value) {
    if (hostHasOwn(value, key)) {
      entries.push([key, value[key]]);
    }
  }
  return entries;
}) as typeof Object.entries;
const hostObjectGetPrototypeOf = ((value: object) => {
  if (typeof hostObjectConstructor.getPrototypeOf === "function") {
    return hostObjectConstructor.getPrototypeOf(value);
  }
  return (value as { __proto__?: object | null }).__proto__ ?? null;
}) as typeof Object.getPrototypeOf;
const hostObjectSetPrototypeOf = (<T>(value: T, prototype: object | null) => {
  if (typeof hostObjectConstructor.setPrototypeOf === "function") {
    return hostObjectConstructor.setPrototypeOf(value, prototype);
  }
  (value as { __proto__?: object | null }).__proto__ = prototype;
  return value;
}) as typeof Object.setPrototypeOf;
const hostReflectConstruct = hostReflectConstructor.construct.bind(
  hostReflectConstructor,
) as typeof Reflect.construct;
const hostReflectGet = hostReflectConstructor.get.bind(
  hostReflectConstructor,
) as typeof Reflect.get;
const hostReflectGetOwnPropertyDescriptor =
  hostReflectConstructor.getOwnPropertyDescriptor.bind(
    hostReflectConstructor,
  ) as typeof Reflect.getOwnPropertyDescriptor;
const hostReflectSet = hostReflectConstructor.set.bind(
  hostReflectConstructor,
) as typeof Reflect.set;
const hostArraySlice = hostArrayConstructor.prototype.slice;
const hostHasOwn = (target: object, key: PropertyKey) =>
  hostHasOwnProperty.call(target, key);

export enum Opcode {
  // 1. Stack & Constants
  PUSH_CONST = 0x01,
  POP = 0x02,
  DUP = 0x03,
  PUSH_CONST_W = 0x04,

  // 2. Memory Abstraction
  LOAD = 0x10,
  STORE = 0x11,

  // 3. Object & Array Operations
  ALLOC_ARR = 0x20,
  ALLOC_OBJ = 0x21,
  GET_PROP = 0x22,
  SET_PROP = 0x23,

  // 4. Math & Logic
  ADD = 0x30,
  SUB = 0x31,
  MUL = 0x32,
  DIV = 0x33,
  MOD = 0x34,
  BIT_AND = 0x35,
  BIT_OR = 0x36,
  XOR = 0x37,
  SHL = 0x38,
  SHR = 0x39,
  USHR = 0x3a,
  EQ = 0x3b,
  NEQ = 0x3c,
  LOOSE_EQ = 0x3d,
  LOOSE_NEQ = 0x3e,
  LT = 0x3f,
  LTE = 0x40,
  GT = 0x41,
  GTE = 0x42,
  IN = 0x43,
  INSTANCEOF = 0x44,

  NEG = 0x60,
  POS = 0x61,
  NOT = 0x62,
  BIT_NOT = 0x63,
  TYPEOF = 0x64,
  VOID = 0x65,
  DELETE = 0x66,
  THROW = 0x67,

  // 5. Control Flow
  JMP = 0x70,
  JMP_IF = 0x71,
  DISPATCH = 0x72,
  DEBUGGER = 0x73,
  DISPATCH_W = 0x74,
  JMP_W = 0x75,
  JMP_IF_W = 0x76,

  // 6. Execution & Environment
  LOAD_ARGS = 0x54,
  LOAD_THIS = 0x55,
  CALL = 0x80,
  CALL_METHOD = 0x84,
  NEW = 0x85,
  CALL_EVAL = 0x86,
  ALLOC_CLOSURE_W = 0x87,
  SYS_RESOLV = 0x81,
  RET = 0x82,
  ALLOC_CLOSURE = 0x83,
}

export type VMExecutionResult = unknown;

export function executeVM(
  bytecode: Uint8Array,
  constantPool: unknown[],
  entryPc: number,
  env: Record<string, unknown>,
  memorySize?: number,
  args?: unknown[],
  exceptionTable?: ExceptionTableEntry[],
  contextThis?: unknown,
): VMExecutionResult;
export function executeVM(state: VMState): VMExecutionResult;
export function executeVM(
  arg0: Uint8Array | VMState,
  constantPool?: unknown[],
  entryPc = 0,
  env?: Record<string, unknown>,
  memorySize = 512,
  args: unknown[] = [],
  exceptionTable: ExceptionTableEntry[] = [],
  contextThis?: unknown,
): VMExecutionResult {
  const state: VMState =
    arg0 instanceof Uint8Array
      ? {
          pc: entryPc,
          stack: [],
          memory: new hostArrayConstructor(memorySize),
          constantPool: constantPool ?? [],
          bytecode: arg0,
          env: env ?? {},
          args,
          exceptionTable,
          contextThis,
        }
      : arg0;

  if (!state.args) {
    state.args = [];
  }
  if (!state.exceptionTable) {
    state.exceptionTable = [];
  }

  let stack = state.stack;
  let memory = state.memory;
  const pool = state.constantPool;
  const code = state.bytecode;

  try {
    if (!(VM_GLOBAL_THIS_MARKER in state.env)) {
      hostObjectDefineProperty(state.env, VM_GLOBAL_THIS_MARKER, {
        value: true,
        configurable: true,
        enumerable: false,
      });
    }
  } catch {}

  type CallFrame = {
    returnPc: number;
    savedMemory: unknown[];
    savedStack: unknown[];
    savedArgs: unknown[];
    savedContextThis: unknown;
    isConstruct?: boolean;
    constructedObj?: unknown;
  };

  const callStack: CallFrame[] = [];

  const isVmClosure = (value: unknown): value is VMClosure => {
    return (
      (typeof value === "object" || typeof value === "function") &&
      value !== null &&
      (value as VMClosure).__vm_closure === true
    );
  };

  const isObjectLike = (value: unknown): value is object | Function => {
    return (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    );
  };

  const isMemoryCell = (value: unknown): value is MemoryCell => {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as MemoryCell).__vm_cell === true
    );
  };

  const isUnresolvableReference = (
    value: unknown,
  ): value is UnresolvableReference => {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as UnresolvableReference).__vm_unresolvable === true
    );
  };

  const createReferenceError = (name: PropertyKey) => {
    const ErrorCtor =
      typeof state.env.ReferenceError === "function"
        ? (state.env.ReferenceError as new (message?: string) => Error)
        : ReferenceError;
    return new ErrorCtor(`${String(name)} is not defined`);
  };

  const readMemory = (ptr: number): unknown => {
    const slot = memory[ptr];
    return isMemoryCell(slot) ? slot.value : slot;
  };

  const writeMemory = (ptr: number, value: unknown) => {
    const slot = memory[ptr];
    if (isMemoryCell(slot)) {
      slot.value = value;
      return;
    }
    memory[ptr] = value;
  };

  const ensureMemoryCell = (ptr: number): MemoryCell => {
    const slot = memory[ptr];
    if (isMemoryCell(slot)) {
      return slot;
    }
    const cell: MemoryCell = { __vm_cell: true, value: slot };
    memory[ptr] = cell;
    return cell;
  };

  const createEnvCell = (key: PropertyKey): MemoryCell => {
    return {
      __vm_cell: true,
      get value() {
        if (!hostHasOwn(state.env, key)) {
          return {
            __vm_unresolvable: true,
            name: key,
          } satisfies UnresolvableReference;
        }
        return state.env[key as keyof typeof state.env];
      },
      set value(next: unknown) {
        if (!hostHasOwn(state.env, key)) {
          throw createReferenceError(key);
        }
        const updated = hostReflectSet(state.env, key, next);
        if (!updated) {
          throw new TypeError(
            `Cannot assign to read only property '${String(key)}'`,
          );
        }
      },
    };
  };

  const getConstructorPrototype = (closure: VMClosure): object | Function => {
    if (isObjectLike(closure.prototype)) {
      return closure.prototype;
    }
    return typeof state.env.Object === "function"
      ? (state.env.Object as ObjectConstructor).prototype
      : hostObjectPrototype;
  };

  const createClosurePrototype = (closure: VMClosure) => {
    const objectPrototype =
      typeof state.env.Object === "function"
        ? (state.env.Object as ObjectConstructor).prototype
        : hostObjectPrototype;
    const prototype = hostObjectCreate(objectPrototype);
    hostObjectDefineProperty(prototype, "constructor", {
      value: closure,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    return prototype;
  };

  const strictPoisonPill = function strictPoisonPill() {
    const ErrorCtor =
      typeof state.env.TypeError === "function"
        ? (state.env.TypeError as new (message?: string) => Error)
        : TypeError;
    throw new ErrorCtor(
      "'caller', 'callee', and 'arguments' may not be accessed in strict mode",
    );
  };

  const definePoisonAccessor = (target: object, key: PropertyKey) => {
    const descriptor = hostReflectGetOwnPropertyDescriptor(target, key);
    if (descriptor && descriptor.configurable === false) {
      return;
    }
    hostObjectDefineProperty(target, key, {
      get: strictPoisonPill,
      set: strictPoisonPill,
      configurable: false,
      enumerable: false,
    });
  };

  const prepareArgumentsObject = (closureArgs: unknown[]) => {
    const ArrayCtor =
      typeof state.env.Array === "function"
        ? (state.env.Array as ArrayConstructor)
        : hostArrayConstructor;
    const argsObject = new ArrayCtor();
    for (let i = 0; i < closureArgs.length; i += 1) {
      argsObject[i] = closureArgs[i];
    }
    definePoisonAccessor(argsObject, "caller");
    definePoisonAccessor(argsObject, "callee");
    return argsObject;
  };

  const enterVmClosure = (
    closure: VMClosure,
    closureArgs: unknown[],
    thisArg: unknown,
    constructInfo?: { constructedObj: unknown },
  ) => {
    callStack.push({
      returnPc: state.pc,
      savedMemory: memory,
      savedStack: stack,
      savedArgs: state.args,
      savedContextThis: state.contextThis,
      isConstruct: constructInfo !== undefined,
      constructedObj: constructInfo?.constructedObj,
    });

    memory = new hostArrayConstructor(closure.memorySize);
    stack = [];

    for (let i = 0; i < closure.captures.length; i += 1) {
      memory[i * 4] = closure.captures[i];
    }

    if (closure.selfRefPtr !== null) {
      memory[closure.selfRefPtr] = closure;
    }

    state.args = prepareArgumentsObject(closureArgs);
    state.contextThis = thisArg;
    state.pc = closure.entryPc;
    state.memory = memory;
    state.stack = stack;
  };

  const invokeVmClosure = (
    closure: VMClosure,
    closureArgs: unknown[],
    thisArg?: unknown,
  ) => {
    const closureMemory = new hostArrayConstructor(closure.memorySize);

    for (let i = 0; i < closure.captures.length; i += 1) {
      closureMemory[i * 4] = closure.captures[i];
    }

    if (closure.selfRefPtr !== null) {
      closureMemory[closure.selfRefPtr] = closure;
    }

    try {
      return executeVM({
        pc: closure.entryPc,
        stack: [],
        memory: closureMemory,
        constantPool: pool,
        bytecode: code,
        env: state.env,
        args: prepareArgumentsObject(closureArgs),
        exceptionTable: state.exceptionTable,
        contextThis: thisArg,
      });
    } catch (error) {
      throw error;
    }
  };

  const wrapForNative = (value: unknown): unknown => {
    if (isVmClosure(value)) {
      return value;
    }

    return value;
  };

  const materializeEvalScope = (scope: unknown) => {
    if (!isObjectLike(scope)) {
      return undefined;
    }
    const values: Record<string, unknown> = hostObjectCreate(null);
    for (const [name, ptr] of hostObjectEntries(
      scope as Record<string, unknown>,
    )) {
      if (typeof ptr === "number") {
        const value = readMemory(ptr);
        if (!isUnresolvableReference(value)) {
          values[name] = value;
        }
      }
    }
    return values;
  };

  const readU8 = () => code[state.pc++];
  const readU16 = () => {
    const hi = code[state.pc++];
    const lo = code[state.pc++];
    return (hi << 8) | lo;
  };
  const readU32 = () => {
    const b0 = code[state.pc++];
    const b1 = code[state.pc++];
    const b2 = code[state.pc++];
    const b3 = code[state.pc++];
    return (b0 * 0x1000000 + (b1 << 16) + (b2 << 8) + b3) >>> 0;
  };

  const opcodeNames: Record<number, string> = {};
  for (const [key, val] of hostObjectEntries(Opcode)) {
    if (typeof val === "number") {
      opcodeNames[val] = key;
    }
  }

  while (state.pc < code.length) {
    try {
      while (state.pc < code.length) {
        const currentPc = state.pc;
        const opcode = readU8();
        if (
          (state.env as any).__VM_DEBUG__ ||
          (typeof globalThis !== "undefined" &&
            (globalThis as any).__VM_DEBUG__)
        ) {
          console.log(
            `[VM Trace] PC: ${currentPc} | Opcode: 0x${opcode.toString(16)} (${opcodeNames[opcode] || "UNKNOWN"}) | Stack:`,
            stack.map((x) => (typeof x === "function" ? "[Function]" : x)),
          );
        }
        switch (opcode) {
          case Opcode.PUSH_CONST: {
            const index = readU8();
            stack.push(pool[index]);
            break;
          }
          case Opcode.PUSH_CONST_W: {
            const index = readU16();
            stack.push(pool[index]);
            break;
          }
          case Opcode.POP: {
            stack.pop();
            break;
          }
          case Opcode.DUP: {
            stack.push(stack[stack.length - 1]);
            break;
          }
          case Opcode.LOAD: {
            const ptr = stack.pop() as number;
            stack.push(readMemory(ptr));
            break;
          }
          case Opcode.STORE: {
            const ptr = stack.pop() as number;
            const value = stack.pop();
            writeMemory(ptr, value);
            break;
          }
          case Opcode.ALLOC_ARR: {
            const ArrayCtor =
              typeof state.env.Array === "function"
                ? (state.env.Array as ArrayConstructor)
                : hostArrayConstructor;
            stack.push(new ArrayCtor());
            break;
          }
          case Opcode.ALLOC_OBJ: {
            const objectPrototype =
              typeof state.env.Object === "function"
                ? (state.env.Object as ObjectConstructor).prototype
                : hostObjectPrototype;
            stack.push(hostObjectCreate(objectPrototype));
            break;
          }
          case Opcode.GET_PROP: {
            const prop = stack.pop() as PropertyKey;
            const obj = stack.pop();
            if (isUnresolvableReference(obj)) {
              throw createReferenceError(obj.name);
            }
            stack.push((obj as Record<PropertyKey, unknown>)[prop]);
            break;
          }
          case Opcode.SET_PROP: {
            const val = stack.pop();
            const prop = stack.pop() as PropertyKey;
            const obj = stack.pop();
            if (isUnresolvableReference(obj)) {
              throw createReferenceError(obj.name);
            }
            (obj as Record<PropertyKey, unknown>)[prop] = val;
            break;
          }
          case Opcode.LOAD_ARGS: {
            stack.push(state.args);
            break;
          }
          case Opcode.LOAD_THIS: {
            stack.push(state.contextThis);
            break;
          }
          case Opcode.THROW: {
            const val = stack.pop();
            throw val;
          }
          case Opcode.DEBUGGER: {
            debugger;
            break;
          }
          case Opcode.ADD: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a + b);
            break;
          }
          case Opcode.SUB: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a - b);
            break;
          }
          case Opcode.MUL: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a * b);
            break;
          }
          case Opcode.DIV: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a / b);
            break;
          }
          case Opcode.MOD: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a % b);
            break;
          }
          case Opcode.BIT_AND: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push((a as number) & (b as number));
            break;
          }
          case Opcode.BIT_OR: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push((a as number) | (b as number));
            break;
          }
          case Opcode.XOR: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push((a as number) ^ (b as number));
            break;
          }
          case Opcode.SHL: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push((a as number) << (b as number));
            break;
          }
          case Opcode.SHR: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push((a as number) >> (b as number));
            break;
          }
          case Opcode.USHR: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push((a as number) >>> (b as number));
            break;
          }
          case Opcode.EQ: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(a === b);
            break;
          }
          case Opcode.NEQ: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(a !== b);
            break;
          }
          case Opcode.LOOSE_EQ: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(a == b);
            break;
          }
          case Opcode.LOOSE_NEQ: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(a != b);
            break;
          }
          case Opcode.LT: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a < b);
            break;
          }
          case Opcode.LTE: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a <= b);
            break;
          }
          case Opcode.GT: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a > b);
            break;
          }
          case Opcode.GTE: {
            const b = stack.pop() as number;
            const a = stack.pop() as number;
            stack.push(a >= b);
            break;
          }
          case Opcode.IN: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push((a as any) in (b as any));
            break;
          }
          case Opcode.INSTANCEOF: {
            const b = stack.pop();
            const a = stack.pop();
            if (isVmClosure(b)) {
              if (!isObjectLike(b.prototype)) {
                throw new TypeError(
                  "Function has non-object prototype in instanceof check",
                );
              }
              if (!isObjectLike(a)) {
                stack.push(false);
                break;
              }
              let proto = hostObjectGetPrototypeOf(a);
              let found = false;
              while (proto !== null) {
                if (proto === b.prototype) {
                  found = true;
                  break;
                }
                proto = hostObjectGetPrototypeOf(proto);
              }
              stack.push(found);
              break;
            }
            stack.push((a as any) instanceof (b as any));
            break;
          }
          case Opcode.NEG: {
            const a = stack.pop() as number;
            stack.push(-a);
            break;
          }
          case Opcode.POS: {
            const a = stack.pop() as number;
            stack.push(+a);
            break;
          }
          case Opcode.NOT: {
            const a = stack.pop();
            stack.push(!a);
            break;
          }
          case Opcode.BIT_NOT: {
            const a = stack.pop() as number;
            stack.push(~a);
            break;
          }
          case Opcode.TYPEOF: {
            const a = stack.pop();
            stack.push(isUnresolvableReference(a) ? "undefined" : typeof a);
            break;
          }
          case Opcode.VOID: {
            stack.pop();
            stack.push(undefined);
            break;
          }
          case Opcode.DELETE: {
            stack.pop();
            stack.push(true);
            break;
          }
          case Opcode.JMP: {
            const offset = readU16();
            state.pc = offset;
            break;
          }
          case Opcode.JMP_W: {
            const offset = readU32();
            state.pc = offset;
            break;
          }
          case Opcode.JMP_IF: {
            const offset = readU16();
            const cond = stack.pop();
            if (cond) {
              state.pc = offset;
            }
            break;
          }
          case Opcode.JMP_IF_W: {
            const offset = readU32();
            const cond = stack.pop();
            if (cond) {
              state.pc = offset;
            }
            break;
          }
          case Opcode.DISPATCH: {
            // Encoding: u8 caseCount, then caseCount pairs of (u8 poolIndex, u16 offset), then u16 default.
            const discr = stack.pop();
            const caseCount = readU8();
            let target = -1;
            for (let i = 0; i < caseCount; i += 1) {
              const poolIndex = readU8();
              const offset = readU16();
              if (pool[poolIndex] === discr && target === -1) {
                target = offset;
              }
            }
            const defaultOffset = readU16();
            state.pc = target === -1 ? defaultOffset : target;
            break;
          }
          case Opcode.DISPATCH_W: {
            // Encoding: u8 caseCount, then caseCount pairs of (u16 poolIndex, u32 offset), then u32 default.
            const discr = stack.pop();
            const caseCount = readU8();
            let target = -1;
            for (let i = 0; i < caseCount; i += 1) {
              const poolIndex = readU16();
              const offset = readU32();
              if (pool[poolIndex] === discr && target === -1) {
                target = offset;
              }
            }
            const defaultOffset = readU32();
            state.pc = target === -1 ? defaultOffset : target;
            break;
          }
          case Opcode.CALL: {
            const argCount = stack.pop() as number;
            const args: unknown[] = new hostArrayConstructor(argCount);
            for (let i = argCount - 1; i >= 0; i -= 1) {
              args[i] = stack.pop();
            }
            const callee = stack.pop();
            if (isUnresolvableReference(callee)) {
              throw createReferenceError(callee.name);
            }
            if (isVmClosure(callee)) {
              enterVmClosure(callee, args, undefined);
              break;
            }
            if (typeof callee === "function") {
              stack.push(callee.apply(undefined, args.map(wrapForNative)));
              break;
            }
            throw new hostTypeErrorConstructor(
              "Attempted to call a non-function value.",
            );
          }
          case Opcode.CALL_METHOD: {
            const argCount = stack.pop() as number;
            const args: unknown[] = new hostArrayConstructor(argCount);
            for (let i = argCount - 1; i >= 0; i -= 1) {
              args[i] = stack.pop();
            }
            const thisArg = stack.pop();
            const callee = stack.pop();
            if (isUnresolvableReference(callee)) {
              throw createReferenceError(callee.name);
            }
            if (isVmClosure(callee)) {
              enterVmClosure(callee, args, thisArg);
              break;
            }
            if (typeof callee === "function") {
              stack.push(callee.apply(thisArg, args.map(wrapForNative)));
              break;
            }
            throw new hostTypeErrorConstructor(
              "Attempted to call a non-function value.",
            );
          }
          case Opcode.CALL_EVAL: {
            const argCount = stack.pop() as number;
            const args: unknown[] = new hostArrayConstructor(argCount);
            for (let i = argCount - 1; i >= 0; i -= 1) {
              args[i] = stack.pop();
            }
            const callee = stack.pop();
            if (isUnresolvableReference(callee)) {
              throw createReferenceError(callee.name);
            }
            if (isVmClosure(callee)) {
              enterVmClosure(callee, args, undefined);
              break;
            }
            if (typeof callee === "function") {
              if ((callee as { __vmDirectEval?: unknown }).__vmDirectEval) {
                stack.push(
                  callee(
                    args[0],
                    state.contextThis,
                    materializeEvalScope(args[args.length - 1]),
                  ),
                );
                break;
              }
              stack.push(callee.apply(undefined, args.map(wrapForNative)));
              break;
            }
            throw new hostTypeErrorConstructor(
              "Attempted to call a non-function value.",
            );
          }
          case Opcode.NEW: {
            const argCount = stack.pop() as number;
            const args: unknown[] = new hostArrayConstructor(argCount);
            for (let i = argCount - 1; i >= 0; i -= 1) {
              args[i] = stack.pop();
            }
            const callee = stack.pop();
            if (isUnresolvableReference(callee)) {
              throw createReferenceError(callee.name);
            }
            if (isVmClosure(callee)) {
              const instance = hostObjectCreate(
                getConstructorPrototype(callee),
              );
              enterVmClosure(callee, args, instance, {
                constructedObj: instance,
              });
              break;
            }
            if (typeof callee === "function") {
              stack.push(hostReflectConstruct(callee, args.map(wrapForNative)));
              break;
            }
            throw new hostTypeErrorConstructor(
              "Attempted to construct a non-function value.",
            );
          }
          case Opcode.SYS_RESOLV: {
            const key = stack.pop() as PropertyKey;
            stack.push(createEnvCell(key));
            break;
          }
          case Opcode.RET: {
            const retVal = stack.pop();
            if (callStack.length === 0) {
              return retVal;
            }
            const frame = callStack.pop()!;
            state.pc = frame.returnPc;
            memory = frame.savedMemory;
            stack = frame.savedStack;
            state.args = frame.savedArgs;
            state.contextThis = frame.savedContextThis;
            state.memory = memory;
            state.stack = stack;

            if (frame.isConstruct) {
              stack.push(isObjectLike(retVal) ? retVal : frame.constructedObj);
              break;
            }

            stack.push(retVal);
            break;
          }
          case Opcode.ALLOC_CLOSURE: {
            const destPc = readU16();
            const memSize = readU16();
            const capCount = readU8();
            const selfRef = readU16();
            const selfRefNullSentinel = 0xffff;
            const captures: MemoryCell[] = new hostArrayConstructor(capCount);
            for (let i = capCount - 1; i >= 0; i -= 1) {
              const ptr = stack.pop() as number;
              captures[i] = ensureMemoryCell(ptr);
            }
            const closure = function vmClosure() {
              "use strict";
              const nativeThis =
                this === state.env ||
                (isObjectLike(this) &&
                  hostReflectGet(this, VM_GLOBAL_THIS_MARKER) === true)
                  ? undefined
                  : this;
              return invokeVmClosure(
                closure,
                hostArraySlice.call(arguments) as unknown[],
                nativeThis,
              );
            } as VMClosure;
            hostObjectDefineProperties(closure, {
              __vm_closure: {
                value: true,
                configurable: false,
                enumerable: false,
              },
              entryPc: {
                value: destPc,
                writable: true,
                configurable: false,
                enumerable: false,
              },
              memorySize: {
                value: memSize,
                writable: true,
                configurable: false,
                enumerable: false,
              },
              captures: {
                value: captures,
                writable: true,
                configurable: false,
                enumerable: false,
              },
              selfRefPtr: {
                value: selfRef === selfRefNullSentinel ? null : selfRef,
                writable: true,
                configurable: false,
                enumerable: false,
              },
            });
            if (typeof state.env.Function === "function") {
              hostObjectSetPrototypeOf(
                closure,
                (state.env.Function as FunctionConstructor).prototype,
              );
            }
            hostObjectDefineProperty(closure, "bind", {
              value(thisArg: unknown, ...boundArgs: unknown[]) {
                const bound = function vmBoundClosure(
                  this: unknown,
                  ...callArgs: unknown[]
                ) {
                  return invokeVmClosure(
                    closure,
                    [...boundArgs, ...callArgs],
                    thisArg,
                  );
                };
                if (typeof state.env.Function === "function") {
                  hostObjectSetPrototypeOf(
                    bound,
                    (state.env.Function as FunctionConstructor).prototype,
                  );
                }
                definePoisonAccessor(bound, "caller");
                definePoisonAccessor(bound, "arguments");
                return bound;
              },
              writable: true,
              configurable: true,
              enumerable: false,
            });
            hostObjectDefineProperty(closure, "prototype", {
              value: createClosurePrototype(closure),
              writable: true,
              configurable: false,
              enumerable: false,
            });
            definePoisonAccessor(closure, "caller");
            definePoisonAccessor(closure, "arguments");
            stack.push(closure);
            break;
          }
          case Opcode.ALLOC_CLOSURE_W: {
            const destPc = readU32();
            const memSize = readU32();
            const capCount = readU8();
            const selfRef = readU32();
            const selfRefNullSentinel = 0xffffffff;
            const captures: MemoryCell[] = new hostArrayConstructor(capCount);
            for (let i = capCount - 1; i >= 0; i -= 1) {
              const ptr = stack.pop() as number;
              captures[i] = ensureMemoryCell(ptr);
            }
            const closure = function vmClosure() {
              "use strict";
              const nativeThis =
                this === state.env ||
                (isObjectLike(this) &&
                  hostReflectGet(this, VM_GLOBAL_THIS_MARKER) === true)
                  ? undefined
                  : this;
              return invokeVmClosure(
                closure,
                hostArraySlice.call(arguments) as unknown[],
                nativeThis,
              );
            } as VMClosure;
            hostObjectDefineProperties(closure, {
              __vm_closure: {
                value: true,
                configurable: false,
                enumerable: false,
              },
              entryPc: {
                value: destPc,
                writable: true,
                configurable: false,
                enumerable: false,
              },
              memorySize: {
                value: memSize,
                writable: true,
                configurable: false,
                enumerable: false,
              },
              captures: {
                value: captures,
                writable: true,
                configurable: false,
                enumerable: false,
              },
              selfRefPtr: {
                value: selfRef === selfRefNullSentinel ? null : selfRef,
                writable: true,
                configurable: false,
                enumerable: false,
              },
            });
            if (typeof state.env.Function === "function") {
              hostObjectSetPrototypeOf(
                closure,
                (state.env.Function as FunctionConstructor).prototype,
              );
            }
            hostObjectDefineProperty(closure, "bind", {
              value(thisArg: unknown, ...boundArgs: unknown[]) {
                const bound = function vmBoundClosure(
                  this: unknown,
                  ...callArgs: unknown[]
                ) {
                  return invokeVmClosure(
                    closure,
                    [...boundArgs, ...callArgs],
                    thisArg,
                  );
                };
                if (typeof state.env.Function === "function") {
                  hostObjectSetPrototypeOf(
                    bound,
                    (state.env.Function as FunctionConstructor).prototype,
                  );
                }
                definePoisonAccessor(bound, "caller");
                definePoisonAccessor(bound, "arguments");
                return bound;
              },
              writable: true,
              configurable: true,
              enumerable: false,
            });
            hostObjectDefineProperty(closure, "prototype", {
              value: createClosurePrototype(closure),
              writable: true,
              configurable: false,
              enumerable: false,
            });
            definePoisonAccessor(closure, "caller");
            definePoisonAccessor(closure, "arguments");
            stack.push(closure);
            break;
          }
          default: {
            throw new Error(`Unknown opcode: 0x${opcode.toString(16)}`);
          }
        }
      }
    } catch (error) {
      let faultPc = state.pc - 1;
      let handled = false;
      while (true) {
        let foundEntry = null;
        for (const e of state.exceptionTable) {
          if (faultPc >= e.startPc && faultPc < e.endPc) {
            foundEntry = e;
            break;
          }
        }
        if (foundEntry) {
          state.pc = foundEntry.handlerPc;
          memory[foundEntry.errorPtr] = error;
          stack.length = 0;
          state.stack = stack;
          state.memory = memory;
          handled = true;
          break;
        }
        if (callStack.length === 0) break;
        const frame = callStack.pop()!;
        faultPc = frame.returnPc - 1;
        memory = frame.savedMemory;
        stack = frame.savedStack;
        state.args = frame.savedArgs;
        state.contextThis = frame.savedContextThis;
        // Also update the state references for memory and stack so they match the popped frame!
        state.memory = memory;
        state.stack = stack;
      }
      if (!handled) {
        // Clean up call stack and throw
        while (callStack.length > 0) {
          const frame = callStack.pop()!;
          state.pc = frame.returnPc;
        }
        throw error;
      }
    }
  }

  return undefined;
}
