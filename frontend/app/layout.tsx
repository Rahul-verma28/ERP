import type { Metadata, Viewport } from "next"
import { DM_Sans, Geist_Mono, IBM_Plex_Sans, Inter, Lato, Manrope, Nunito_Sans, Open_Sans, Poppins, Public_Sans, Roboto, Source_Sans_3, Work_Sans } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/lib/auth"
import { SITE } from "@/lib/site"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })
// Font choices (Settings › Appearance, Settings › Branding); only the ones shown are downloaded
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", preload: false })
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex", preload: false })
const sourceSans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source", preload: false })
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", preload: false })
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-open-sans", preload: false })
const lato = Lato({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-lato", preload: false })
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins", preload: false })
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", preload: false })
const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-public-sans", preload: false })
const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-work-sans", preload: false })
const nunitoSans = Nunito_Sans({ subsets: ["latin"], variable: "--font-nunito-sans", preload: false })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: "%s · AHEAD ERP" },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  authors: [{ name: SITE.name, url: SITE.url }],
  creator: SITE.name,
  publisher: SITE.name,
  category: "Business software",
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: SITE.locale,
    url: "/",
    title: SITE.title,
    description: SITE.description,
  },
  twitter: { card: "summary_large_image", title: SITE.title, description: SITE.description },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfcfe" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", inter.variable, manrope.variable, plex.variable, sourceSans.variable, roboto.variable, openSans.variable, lato.variable, poppins.variable, dmSans.variable, publicSans.variable, workSans.variable, nunitoSans.variable)}
    >
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
