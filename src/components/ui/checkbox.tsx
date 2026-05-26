import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { cn } from '@/lib/utils'

const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root className={cn('ui-checkbox', className)} ref={ref} {...props}>
    <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
      <Check size={12} strokeWidth={2.2} aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))

Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
