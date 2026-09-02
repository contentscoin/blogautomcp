/**
 * MCP 도구 inputSchema(JSON Schema 부분집합) 런타임 검증기.
 * 선언된 스키마 하나가 문서·검증의 단일 소스가 되도록 한다 (수작업 if 검증과의 불일치 제거).
 * 지원: type(object/string/integer/number/boolean/array), enum, const, minLength/maxLength,
 * pattern, minimum/maximum, required, additionalProperties:false, items, default.
 */

export type JsonSchema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  default?: unknown;
  description?: string;
  minItems?: number;
  maxItems?: number;
};

export interface ValidationOutcome {
  ok: boolean;
  errors: string[];
  value: Record<string, unknown>;
}

function validateValue(schema: JsonSchema, value: unknown, path: string, errors: string[]): unknown {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
    return value;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return value;
  }
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') { errors.push(`${path}: must be a string`); return value; }
      const text = value;
      if (schema.minLength !== undefined && text.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && text.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(text)) errors.push(`${path}: does not match ${schema.pattern}`);
      return text;
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
        errors.push(`${path}: must be ${schema.type === 'integer' ? 'an integer' : 'a number'}`);
        return value;
      }
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
      return value;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`${path}: must be a boolean`);
      return value;
    }
    case 'array': {
      if (!Array.isArray(value)) { errors.push(`${path}: must be an array`); return value; }
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
      return schema.items ? value.map((item, index) => validateValue(schema.items as JsonSchema, item, `${path}[${index}]`, errors)) : value;
    }
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: must be an object`); return value; }
      return validateObject(schema, value as Record<string, unknown>, path, errors);
    }
    default:
      return value;
  }
}

function validateObject(schema: JsonSchema, value: Record<string, unknown>, path: string, errors: string[]): Record<string, unknown> {
  const properties = schema.properties || {};
  const output: Record<string, unknown> = {};
  for (const key of schema.required || []) {
    if (value[key] === undefined) errors.push(`${path ? `${path}.` : ''}${key}: required`);
  }
  for (const [key, item] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (schema.additionalProperties === false) errors.push(`${path ? `${path}.` : ''}${key}: unexpected property`);
      continue;
    }
    if (item === undefined) continue;
    output[key] = validateValue(propertySchema, item, `${path ? `${path}.` : ''}${key}`, errors);
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (output[key] === undefined && propertySchema.default !== undefined) output[key] = propertySchema.default;
  }
  return output;
}

export function validateToolArguments(schema: JsonSchema, args: unknown): ValidationOutcome {
  const errors: string[] = [];
  const source = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const value = validateObject(schema, source, '', errors);
  return { ok: errors.length === 0, errors, value };
}
