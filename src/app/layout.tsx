import type { Metadata } from 'next';
import './globals.css';

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
