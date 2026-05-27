import './globals.css';

export const metadata = {
  title: 'Boat Drive',
  description: '2D boat driving with realistic water physics',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
