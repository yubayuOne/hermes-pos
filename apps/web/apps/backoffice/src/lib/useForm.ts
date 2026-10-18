import { useState } from 'react';
import type { z } from 'zod';
import { fieldErrors } from './schemas';

/**
 * Small form state: values, errors per field (shown under the field with role="alert"), and an error clears
 * as soon as its field changes (DESIGN.md A7).
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  function set<K extends keyof T>(key: K, value: T[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      if (!e[key as string] && !e._) return e;
      const { [key as string]: _, _: __, ...rest } = e;
      return rest;
    });
  }
  /** Validates with the schema; returns the parsed value or null and shows the errors. */
  function check<S extends z.ZodType>(schema: S, value: unknown = values): z.output<S> | null {
    const errs = fieldErrors(schema, value);
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return null;
    }
    return schema.parse(value);
  }
  function fail(error: string, field?: string) {
    setErrors({ [field ?? '_']: error });
  }
  return { values, setValues, set, errors, setErrors, check, fail };
}
