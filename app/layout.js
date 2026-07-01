import './globals.css';

export const metadata = {
  title: 'Boat Drive',
  description: '2D boat driving with realistic water physics',
};

// Lock the viewport for a game/HUD: fill the screen, disable pinch- and
// double-tap zoom (so dragging the throttle/helm never zooms the page), and
// extend under notches / rounded corners.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#06283d',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
