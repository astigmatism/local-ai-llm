export interface ValidationDetail {
  loc: Array<string | number>;
  msg: string;
  type: string;
  input?: unknown;
  ctx: Record<string, unknown>;
}

export interface ValidationErrorResponse {
  detail: ValidationDetail[];
}

export interface ModelLoadRequest {
  model: string;
  make_default: boolean;
}

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export function isValidModelName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 128 && MODEL_NAME_PATTERN.test(value.trim());
}

export function validateModelName(value: unknown, loc: Array<string | number>): ValidationDetail[] {
  if (typeof value !== 'string') {
    return [{
      loc,
      msg: 'Input should be a valid string',
      type: 'string_type',
      input: value,
      ctx: {}
    }];
  }

  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return [{
      loc,
      msg: 'String should have at least 1 character',
      type: 'string_too_short',
      input: value,
      ctx: { min_length: 1 }
    }];
  }

  if (trimmed.length > 128) {
    return [{
      loc,
      msg: 'String should have at most 128 characters',
      type: 'string_too_long',
      input: value,
      ctx: { max_length: 128 }
    }];
  }

  if (!MODEL_NAME_PATTERN.test(trimmed)) {
    return [{
      loc,
      msg: 'Model name may contain letters, numbers, dot, dash, underscore, slash, and colon only, and must start with a letter or number',
      type: 'string_pattern_mismatch',
      input: value,
      ctx: { pattern: MODEL_NAME_PATTERN.source }
    }];
  }

  return [];
}

export function validateModelLoadRequest(body: unknown): { ok: true; value: ModelLoadRequest } | { ok: false; response: ValidationErrorResponse } {
  const details: ValidationDetail[] = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      response: {
        detail: [{
          loc: ['body'],
          msg: 'Input should be a valid object',
          type: 'model_attributes_type',
          input: body,
          ctx: {}
        }]
      }
    };
  }

  const record = body as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'model')) {
    details.push({
      loc: ['body', 'model'],
      msg: 'Field required',
      type: 'missing',
      input: body,
      ctx: {}
    });
  } else {
    details.push(...validateModelName(record.model, ['body', 'model']));
  }

  if (record.make_default !== undefined && typeof record.make_default !== 'boolean') {
    details.push({
      loc: ['body', 'make_default'],
      msg: 'Input should be a valid boolean',
      type: 'bool_type',
      input: record.make_default,
      ctx: {}
    });
  }

  if (details.length > 0) {
    return { ok: false, response: { detail: details } };
  }

  return {
    ok: true,
    value: {
      model: String(record.model).trim(),
      make_default: typeof record.make_default === 'boolean' ? record.make_default : false
    }
  };
}
