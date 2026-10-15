import { createHash } from "node:crypto";

export class RuntimeTrustError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeTrustError";
  }
}

export type StrictJsonPrimitive = null | boolean | number | string;
export type StrictJsonValue = StrictJsonPrimitive | StrictJsonValue[] | { [key: string]: StrictJsonValue };
export type StrictJsonRecord = { [key: string]: StrictJsonValue };

export interface StrictJsonLimits {
  maxBytes: number;
  maxDepth: number;
  maxKeys: number;
  maxStringLength: number;
}

export const DEFAULT_STRICT_JSON_LIMITS: Readonly<StrictJsonLimits> = Object.freeze({
  maxBytes: 64 * 1024,
  maxDepth: 32,
  maxKeys: 256,
  maxStringLength: 8 * 1024,
});

function fail(code: string, message: string): never {
  throw new RuntimeTrustError(code, message);
}

function assertLimit(name: keyof StrictJsonLimits, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("STRICT_JSON_LIMITS_INVALID", `${name} must be a non-negative safe integer.`);
  }
  return value;
}

export function resolveStrictJsonLimits(overrides: Partial<StrictJsonLimits> = {}): StrictJsonLimits {
  return {
    maxBytes: assertLimit("maxBytes", overrides.maxBytes ?? DEFAULT_STRICT_JSON_LIMITS.maxBytes),
    maxDepth: assertLimit("maxDepth", overrides.maxDepth ?? DEFAULT_STRICT_JSON_LIMITS.maxDepth),
    maxKeys: assertLimit("maxKeys", overrides.maxKeys ?? DEFAULT_STRICT_JSON_LIMITS.maxKeys),
    maxStringLength: assertLimit("maxStringLength", overrides.maxStringLength ?? DEFAULT_STRICT_JSON_LIMITS.maxStringLength),
  };
}

export function isStrictJsonRecord(value: StrictJsonValue): value is StrictJsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("STRICT_JSON_UNICODE", "String contains an unpaired high surrogate.");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("STRICT_JSON_UNICODE", "String contains an unpaired low surrogate.");
    }
  }
}

function codePointLength(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

class StrictJsonParser {
  private index = 0;
  private keys = 0;

  constructor(private readonly input: string, private readonly limits: StrictJsonLimits) {}

  parse(): StrictJsonValue {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.input.length) fail("STRICT_JSON_SYNTAX", "JSON contains trailing data.");
    return value;
  }

  private parseValue(containerDepth: number): StrictJsonValue {
    const current = this.input[this.index];
    if (current === "{") return this.parseObject(containerDepth + 1);
    if (current === "[") return this.parseArray(containerDepth + 1);
    if (current === "\"") return this.parseString();
    if (current === "t") return this.parseLiteral("true", true);
    if (current === "f") return this.parseLiteral("false", false);
    if (current === "n") return this.parseLiteral("null", null);
    if (current === "-" || (current >= "0" && current <= "9")) return this.parseNumber();
    fail("STRICT_JSON_SYNTAX", "JSON value is invalid.");
  }

  private parseObject(depth: number): StrictJsonRecord {
    if (depth > this.limits.maxDepth) fail("STRICT_JSON_DEPTH_LIMIT", "JSON object nesting exceeds the configured limit.");
    this.index += 1;
    this.skipWhitespace();
    const value: StrictJsonRecord = Object.create(null) as StrictJsonRecord;
    const seen = new Set<string>();
    if (this.input[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (true) {
      if (this.input[this.index] !== "\"") fail("STRICT_JSON_SYNTAX", "JSON object key must be a string.");
      const key = this.parseString();
      if (seen.has(key)) fail("STRICT_JSON_DUPLICATE_KEY", "JSON object contains a duplicate key.");
      seen.add(key);
      this.keys += 1;
      if (this.keys > this.limits.maxKeys) fail("STRICT_JSON_KEY_LIMIT", "JSON key count exceeds the configured limit.");
      this.skipWhitespace();
      if (this.input[this.index] !== ":") fail("STRICT_JSON_SYNTAX", "JSON object key is missing a colon.");
      this.index += 1;
      this.skipWhitespace();
      value[key] = this.parseValue(depth);
      this.skipWhitespace();
      const delimiter = this.input[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return value;
      }
      if (delimiter !== ",") fail("STRICT_JSON_SYNTAX", "JSON object is missing a comma or closing brace.");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): StrictJsonValue[] {
    if (depth > this.limits.maxDepth) fail("STRICT_JSON_DEPTH_LIMIT", "JSON array nesting exceeds the configured limit.");
    this.index += 1;
    this.skipWhitespace();
    const value: StrictJsonValue[] = [];
    if (this.input[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (true) {
      value.push(this.parseValue(depth));
      this.skipWhitespace();
      const delimiter = this.input[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return value;
      }
      if (delimiter !== ",") fail("STRICT_JSON_SYNTAX", "JSON array is missing a comma or closing bracket.");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    this.index += 1;
    let value = "";
    while (this.index < this.input.length) {
      const character = this.input[this.index];
      if (character === "\"") {
        this.index += 1;
        assertWellFormedUnicode(value);
        if (codePointLength(value) > this.limits.maxStringLength) {
          fail("STRICT_JSON_STRING_LIMIT", "JSON string exceeds the configured limit.");
        }
        return value;
      }
      if (character === "\\") {
        this.index += 1;
        const escaped = this.input[this.index];
        if (escaped === undefined) fail("STRICT_JSON_TRUNCATED", "JSON string escape is truncated.");
        const escapedValues: Record<string, string> = {
          "\"": "\"",
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (escaped === "u") {
          const hex = this.input.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("STRICT_JSON_SYNTAX", "JSON Unicode escape is invalid or truncated.");
          value += String.fromCharCode(Number.parseInt(hex, 16));
          this.index += 5;
          continue;
        }
        if (!(escaped in escapedValues)) fail("STRICT_JSON_SYNTAX", "JSON string escape is invalid.");
        value += escapedValues[escaped];
        this.index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) fail("STRICT_JSON_SYNTAX", "JSON string contains a control character.");
      value += character;
      this.index += 1;
    }
    fail("STRICT_JSON_TRUNCATED", "JSON string is truncated.");
  }

  private parseLiteral<T extends StrictJsonPrimitive>(literal: string, value: T): T {
    if (this.input.slice(this.index, this.index + literal.length) !== literal) {
      fail("STRICT_JSON_SYNTAX", "JSON literal is invalid.");
    }
    this.index += literal.length;
    return value;
  }

  private parseNumber(): number {
    const remaining = this.input.slice(this.index);
    const match = remaining.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) fail("STRICT_JSON_SYNTAX", "JSON number is invalid.");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("STRICT_JSON_NUMBER", "JSON number is not finite.");
    return value;
  }

  private skipWhitespace(): void {
    while ([" ", "\t", "\n", "\r"].includes(this.input[this.index] ?? "")) this.index += 1;
  }
}

export function parseStrictJsonBytes(input: Uint8Array, overrides: Partial<StrictJsonLimits> = {}): StrictJsonValue {
  const limits = resolveStrictJsonLimits(overrides);
  const bytes = Buffer.from(input);
  if (bytes.byteLength > limits.maxBytes) fail("STRICT_JSON_BYTE_LIMIT", "JSON bytes exceed the configured limit.");
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail("STRICT_JSON_BOM", "UTF-8 BOM is forbidden.");
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("STRICT_JSON_UTF8", "JSON bytes are not valid UTF-8.");
  }
  return new StrictJsonParser(decoded, limits).parse();
}

export function assertStrictJsonValue(value: unknown): asserts value is StrictJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string") assertWellFormedUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("CANONICAL_JSON_NUMBER", "Canonical JSON only permits finite numbers.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertStrictJsonValue(item);
    return;
  }
  if (typeof value === "object" && value !== null) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("CANONICAL_JSON_OBJECT", "Canonical JSON only permits plain objects.");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      fail("CANONICAL_JSON_OBJECT", "Canonical JSON objects may not contain symbol properties.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor)) {
        fail("CANONICAL_JSON_OBJECT", "Canonical JSON objects may not contain accessors.");
      }
      assertWellFormedUnicode(key);
      assertStrictJsonValue(descriptor.value);
    }
    return;
  }
  fail("CANONICAL_JSON_TYPE", "Canonical JSON value contains an unsupported type.");
}

export function canonicalizeJcs(value: StrictJsonValue): string {
  assertStrictJsonValue(value);
  if (value === null || typeof value === "boolean") return value ? "true" : value === false ? "false" : "null";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalizeJcs(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`).join(",")}}`;
}

export function canonicalUtf8(value: StrictJsonValue): Buffer {
  return Buffer.from(canonicalizeJcs(value), "utf8");
}

export function canonicalSha256(value: StrictJsonValue): string {
  return createHash("sha256").update(canonicalUtf8(value)).digest("hex");
}
