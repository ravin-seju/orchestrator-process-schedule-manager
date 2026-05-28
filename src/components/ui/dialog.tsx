import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ElementRef } from 'react'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogClose = DialogPrimitive.Close
const DialogDescription = DialogPrimitive.Description
const DialogTitle = DialogPrimitive.Title
const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay className={cn('ui-dialog-overlay', className)} ref={ref} {...props} />
))

DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showClose?: boolean; elevated?: boolean }
>(({ children, className, onOpenAutoFocus, showClose = true, elevated = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay className={elevated ? 'ui-dialog-overlay--elevated' : undefined} />
    <DialogPrimitive.Content
      className={cn('ui-dialog-content', elevated && 'ui-dialog-content--elevated', className)}
      ref={ref}
      onOpenAutoFocus={(event) => {
        if (onOpenAutoFocus) {
          onOpenAutoFocus(event)
          return
        }
        event.preventDefault()
      }}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogPrimitive.Close className="ui-dialog-close" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
))

DialogContent.displayName = DialogPrimitive.Content.displayName

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
