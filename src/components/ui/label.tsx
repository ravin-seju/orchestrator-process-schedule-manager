import * as LabelPrimitive from '@radix-ui/react-label'
import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { cn } from '@/lib/utils'

const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root className={cn('ui-label', className)} ref={ref} {...props} />
))

Label.displayName = LabelPrimitive.Root.displayName

export { Label }
