import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Meridian', template: '%s · Meridian' },
  description: 'Sales and operations desk for Meridian Facilities, a fictional commercial cleaning company.',
}

export const preferredRegion = 'sin1'

const themeScript = `try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={GeistSans.className}>
        <a className="skip" href="#content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}