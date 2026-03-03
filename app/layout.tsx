import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Time Tracker',
  description: 'Track daily hours from TickTick with overtime',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
