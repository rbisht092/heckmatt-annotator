import './globals.css'

export const metadata = {
  title: 'Heckmatt Annotator',
  description: 'USG muscle annotation tool for Heckmatt grading',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
