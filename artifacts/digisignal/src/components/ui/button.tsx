import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Soft-UI (neumorphic) buttons: filled actions glow, neutral actions are raised
// from the surface and press into it on :active.
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-linear-to-br from-primary to-primary-deep text-primary-foreground shadow-neu-primary hover:brightness-105",
        destructive:
          "bg-destructive text-destructive-foreground shadow-neu-sm hover:brightness-105",
        outline:
          "bg-card text-foreground shadow-neu-sm hover:text-primary active:shadow-neu-inset",
        secondary:
          "bg-card text-foreground shadow-neu-sm hover:text-primary active:shadow-neu-inset",
        ghost: "text-foreground/80 hover:text-primary hover:shadow-neu-sm",
        link: "text-primary underline-offset-4 hover:underline",
        // Kept for call sites; the signature CTA is now the violet gradient.
        coral:
          "bg-linear-to-br from-primary to-primary-deep text-primary-foreground shadow-neu-primary hover:brightness-105",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-lg px-3.5",
        lg: "h-11 rounded-xl px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
