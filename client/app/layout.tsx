import type { Metadata } from "next"
import { Google_Sans_Code, Google_Sans_Flex } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Google Sans Flex is the variable-axis version of Google Sans — same
// drawings but with continuous weight/width axes, which gives us crisper
// type and a smaller download than shipping multiple static weights.
const sans = Google_Sans_Flex({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

const mono = Google_Sans_Code({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
})

const TITLE = "Arkiv Search — permissionless semantic search"
const DESCRIPTION =
  "Vector search over Wikipedia, with the corpus and index living on the ARKIV - universal data layer for Ethereum. Everything you see runs in your browser — no backend."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Arkiv Search",
  authors: [{ name: "Arkiv" }],
  icons: {
    icon: [{ url: "/arkiv-logo.svg", type: "image/svg+xml" }],
    shortcut: "/arkiv-logo.svg",
    apple: "/arkiv-logo.svg",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Arkiv Search",
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
}

export const viewport = {
  // Matches the Sand background token so mobile browser chrome blends in.
  themeColor: "#F6F4EF",
  colorScheme: "light" as const,
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
      className={cn("font-sans antialiased", sans.variable, mono.variable)}
    >
      <body>
        <ThemeProvider defaultTheme="light" enableSystem={false}>
          <TooltipProvider delay={350}>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
