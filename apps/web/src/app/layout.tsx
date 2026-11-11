import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, Instrument_Serif } from 'next/font/google';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { ThemeScript } from '@/components/layout/ThemeScript';
import '@/styles/globals.css';

const display = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--font-display-face' });
const body = Hanken_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-body-face' });

export const metadata: Metadata = {
  title: { default: 'ONWA. One marketplace. Endless possibilities.', template: '%s | ONWA' },
  description: 'ONWA brings physical products, digital downloads and professional services from independent Nigerian sellers into one marketplace.',
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F7F5F0' }, { media: '(prefers-color-scheme: dark)', color: '#111111' }],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" suppressHydrationWarning className={`${display.variable} ${body.variable}`}>
      <head><ThemeScript /></head>
      <body>
        <a className="skip-link" href="#content">Skip to content</a>
        <SiteHeader />
        <main id="content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
