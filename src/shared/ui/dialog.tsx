import { useRef, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup
            ref={popup}
            initialFocus={() =>
              popup.current?.querySelector<HTMLElement>('[data-autofocus]') ?? true
            }
            className={cn('dialog-popup', className)}
          >
            <div className="dialog-heading">
              <Dialog.Title className="dialog-title">{title}</Dialog.Title>
              <Dialog.Close className="button button-ghost button-icon" aria-label="Close dialog">
                <X size={16} />
              </Dialog.Close>
            </div>
            {description ? (
              <Dialog.Description className="dialog-description">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
