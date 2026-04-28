"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  // Dashboard tokens (--color-ink, --color-bg, --color-surface) only have
  // light values; .dark overrides flip shadcn's --card to dark but leave the
  // dashboard text dark, which produces invisible dark-on-dark text. Force
  // light until the dashboard tokens get a proper dark variant.
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
