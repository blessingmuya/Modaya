import type { Metadata } from 'next';
import './globals.css';
// Self-hosted faces, no runtime font CDN:
//  - Plus Jakarta Sans (variable weight) is the UI and headline grotesque.
//  - Instrument Serif ships only a roman and a drawn italic; the italic is what
//    the second line of a headline uses.
import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';

export const metadata: Metadata = {
  title: 'Modaya — edit video by describing the result',
  description:
    'Modaya measures a reference video and applies its rhythm and grade to your footage. Every cut traces back to a number or an explicitly-labelled model guess.',
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
