import type { ImgHTMLAttributes } from 'react';

type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'src'> & {
  decorative?: boolean;
};

export function BrandLogo({ decorative = false, className, ...props }: BrandLogoProps) {
  const classes = ['brand-logo', className].filter(Boolean).join(' ');
  return (
    <img
      {...props}
      className={classes}
      src="/brand/1990-agency-logo.svg"
      alt={decorative ? '' : '1990 Agency'}
      aria-hidden={decorative || undefined}
      width="597"
      height="150"
      decoding="async"
    />
  );
}
