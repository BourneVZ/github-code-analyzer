import type {Metadata} from 'next';
import './globals.css'; // Global styles
import { AppBootstrap } from '@/components/AppBootstrap';

export const metadata: Metadata = {
  title: 'My Google AI Studio App',
  description: 'My Google AI Studio App',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <AppBootstrap />
        {children}
      </body>
    </html>
  );
}
