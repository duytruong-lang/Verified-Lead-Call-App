import * as React from 'react';
import { cn } from '@/lib/utils';

function primitive(name: string, base: string) {
  const Component = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn(base, className)} {...props} />);
  Component.displayName = name;
  return Component;
}
export const Card = primitive('Card', 'ui-card');
export const CardHeader = primitive('CardHeader', 'ui-card-header');
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => <h2 ref={ref} className={cn('ui-card-title', className)} {...props} />);
CardTitle.displayName = 'CardTitle';
export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(({ className, ...props }, ref) => <p ref={ref} className={cn('ui-card-description', className)} {...props} />);
CardDescription.displayName = 'CardDescription';
export const CardContent = primitive('CardContent', 'ui-card-content');
export const CardFooter = primitive('CardFooter', 'ui-card-footer');
