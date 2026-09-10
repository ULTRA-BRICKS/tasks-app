import { AppError } from '../server/core/errors.mjs';
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    value >= '1900-01-01' &&
    value <= '2200-12-31'
  );
}
export function validate(value, schema, path = '$') {
  const fail = (message) => {
    throw new AppError(422, 'VALIDATION_ERROR', `${path}: ${message}`);
  };
  if (schema.anyOf) {
    for (const option of schema.anyOf) {
      try {
        return validate(value, option, path);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
      }
    }
    return fail('invalid value');
  }
  if (schema.type === 'null') {
    if (value !== null) fail('must be null');
    return value;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    const keys = Object.keys(value);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties)
      fail('too many fields');
    for (const k of schema.required ?? []) if (!Object.hasOwn(value, k)) fail(`missing ${k}`);
    for (const k of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) fail('forbidden key');
      const child = schema.properties?.[k];
      if (child) validate(value[k], child, `${path}.${k}`);
      else if (schema.additionalProperties === false) fail(`unknown field ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        validate(value[k], schema.additionalProperties, `${path}.${k}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0))
      fail('invalid item count');
    if (schema.uniqueItems && new Set(value.map((x) => JSON.stringify(x))).size !== value.length)
      fail('duplicate items');
    value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    if (
      value.length > (schema.maxLength ?? Infinity) ||
      value.trim().length < (schema.minLength ?? 0)
    )
      fail('invalid text length');
    if (value.includes('\0')) fail('null bytes are not allowed');
    if (schema.enum && !schema.enum.includes(value)) fail('unknown option');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('invalid format');
    if (
      schema.format === 'uuid' &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    )
      fail('must be a UUID');
    if (schema.format === 'date' && !validDate(value))
      fail('must be a real YYYY-MM-DD date between 1900 and 2200');
    if (schema.format === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      fail('invalid email');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean');
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('must be a finite number');
    if (schema.type === 'integer' && !Number.isSafeInteger(value)) fail('must be an integer');
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))
      fail('out of range');
  }
  return value;
}
