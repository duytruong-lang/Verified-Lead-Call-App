# 1990 Agency brand assets

## Logo

The app uses the official 1990 Agency SVG at [`public/brand/1990-agency-logo.svg`](../public/brand/1990-agency-logo.svg). Source: [1990 Agency logo SVG](https://www.1990.agency/wp-content/uploads/2025/01/1990Agency-Logo-150px.svg). Keep the original artwork and aspect ratio; do not redraw, recolor, or crop it. The supplied asset has a `596.98 × 150` viewBox and uses the charcoal `#232323` and red `#ec2024` brand colors.

The logo and 1990 Agency name are brand assets. Use them only to identify the agency product; this repository does not claim ownership of the trademark. Keep the source URL and this attribution with the asset. Do not substitute a text wordmark or the old decorative star for the logo in app entry points.

## Typography

The public website CSS identifies **Montserrat** as the 1990 Agency website font: [official website stylesheet](https://www.1990.agency/wp-content/themes/theme-1990-agency/assets/css/main.css). The app self-hosts the regular Montserrat family through the pinned `@fontsource/montserrat` npm dependency in the lockfile, so the app does not rely on a third-party font CDN. The package’s SIL Open Font License 1.1 notice is included in [`public/licenses/montserrat-OFL.txt`](../public/licenses/montserrat-OFL.txt); keep it with the distributed font files.

Use Montserrat with Vietnamese glyph coverage. The app uses regular 400 for body copy, 500–600 for labels and controls, and 700 for headings. Do not copy `Transforma Sans_Trial` from presentation materials into the app.

## Product styling

The app uses a light workspace background, dark text (`#232323`), and 1990 red (`#ec2024`) for brand accents. Smaller white-on-red controls use the accessible action-red token defined in the UI styles so normal-size labels keep sufficient contrast. Keep interface type sizes and controls practical for operators working through calls; landing-page display typography is not an app sizing spec.
