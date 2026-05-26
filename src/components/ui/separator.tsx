import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { cn } from '@/lib/utils'

const Separator = forwardRef<
  ElementRef<typeof SeparatorPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', ...props }, ref) => (
  <SeparatorPrimitive.Root
    className={cn('ui-separator', orientation === 'vertical' && 'ui-separator-vertical', className)}
    orientation={orientation}
    ref={ref}
    {...props}
  />
))

Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
