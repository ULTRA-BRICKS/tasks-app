import type { ComponentProps } from 'react';
import { Input as BaseInput } from '@base-ui/react/input';
import { cn } from '../lib/cn';
export function Input({ className, ...props }: BaseInput.Props) {
  return <BaseInput className={cn('input', className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('input textarea', className)} {...props} />;
}
