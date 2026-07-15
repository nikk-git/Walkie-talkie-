import './globals.css';

export const metadata = {
  title: 'Walkie-Talkie',
  description: 'P2P Real-time Audio Communication',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
