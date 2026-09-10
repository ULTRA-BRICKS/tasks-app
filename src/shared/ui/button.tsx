import { Button as BaseButton } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';
const variants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
    },
    size: { default: '', sm: 'button-sm', icon: 'button-icon' },
  },
  defaultVariants: { variant: 'secondary', size: 'default' },
});
export type ButtonProps = BaseButton.Props & VariantProps<typeof variants>;
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <BaseButton className={cn(variants({ variant, size }), className)} {...props} />;
}
