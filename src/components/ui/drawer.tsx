import * as React from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { cn } from '@/lib/utils';

export const Drawer = (props: React.ComponentProps<typeof DrawerPrimitive.Root>) => <DrawerPrimitive.Root {...props} />;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerPortal = DrawerPrimitive.Portal;
export const DrawerClose = DrawerPrimitive.Close;
export const DrawerOverlay = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>>(({ className, ...props }, ref) => <DrawerPrimitive.Overlay ref={ref} className={cn('ui-drawer-overlay', className)} {...props} />);
DrawerOverlay.displayName = 'DrawerOverlay';
export const DrawerContent = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>>(({ className, children, ...props }, ref) => <DrawerPortal><DrawerOverlay /><DrawerPrimitive.Content ref={ref} className={cn('ui-drawer-content', className)} {...props}><div className="ui-drawer-handle" />{children}</DrawerPrimitive.Content></DrawerPortal>);
DrawerContent.displayName = 'DrawerContent';
export const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('ui-drawer-header', className)} {...props} />;
export const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('ui-drawer-footer', className)} {...props} />;
export const DrawerTitle = React.forwardRef<React.ElementRef<typeof DrawerPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>>(({ className, ...props }, ref) => <DrawerPrimitive.Title ref={ref} className={cn('ui-drawer-title', className)} {...props} />);
DrawerTitle.displayName = 'DrawerTitle';
