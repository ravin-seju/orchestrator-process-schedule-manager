import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      default: 'ui-button-default',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      danger: 'ui-button-danger',
    },
    size: {
      default: 'ui-button-size-default',
      compact: 'ui-button-size-compact',
      icon: 'ui-button-size-icon',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
})

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild = false, className, size, variant, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'

    return <Comp className={cn(buttonVariants({ size, variant }), className)} ref={ref} {...props} />
  },
)

Button.displayName = 'Button'

export { Button }
