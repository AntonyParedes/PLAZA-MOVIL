import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700', {
  variants: { variant: { default: 'bg-teal-800 text-white hover:bg-teal-900', outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50' } },
  defaultVariants: { variant: 'default' },
});
function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, className }))} {...props} />;
}
export { Button, buttonVariants };
