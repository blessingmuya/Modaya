import type { Metadata } from 'next';
import './globals.css';
// Self-hosted display serif (roman + italic). Instrument Serif ships these two
// cuts; the italic is a real drawn italic, which is what the headline leans on.
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
