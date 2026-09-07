import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const badgeVariants = cva(
  // @replit
  // Whitespace-nowrap: Badges should never wrap.
  'whitespace-nowrap inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2' +
    ' hover-elevate ',
  {
    variants: {
      variant: {
        default:
          // Soft-UI: a raised violet pill
          'border-transparent bg-primary text-primary-foreground shadow-neu-sm',
        secondary:
          // Soft-UI: pressed-in neutral pill
          'border-transparent bg-card text-foreground shadow-neu-inset',
        destructive:
          // @replit shadow-xs instead of shadow, no hover because we use hover-elevate
          'border-transparent bg-destructive text-destructive-foreground shadow-xs',
        // @replit shadow-xs" - use badge outline variable
        outline: 'text-foreground border-transparent bg-card shadow-neu-inset',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
