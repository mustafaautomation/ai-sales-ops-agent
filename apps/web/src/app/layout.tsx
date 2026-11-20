import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-sans' })
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', variable: '--font-serif' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: { default: 'Meridian Desk', template: '%s · Meridian Desk' },
  description: 'Sales and operations desk for Meridian Facilities, a fictional commercial cleaning company.',
}

const themeScript = `try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip" href="#content">Skip to content</a>
        {children}
      </body>
    </html>
  )
}
